from datetime import datetime, timezone
import os
from uuid import UUID

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text

from deadlock.main import create_app


def _reset(factory, account_id=29001):
    with factory.begin() as session:
        session.execute(text("DELETE FROM refresh_jobs WHERE account_id=:id"), {"id": account_id})
        session.execute(text("DELETE FROM match_players WHERE account_id=:id"), {"id": account_id})
        session.execute(text("DELETE FROM players WHERE account_id=:id"), {"id": account_id})


@pytest.fixture(autouse=True)
def clean_api_players(migrated_engine):
    yield
    with migrated_engine.begin() as session:
        session.execute(text("DELETE FROM refresh_jobs WHERE account_id BETWEEN 29001 AND 29015 OR account_id BETWEEN 29120 AND 29125"))
        session.execute(text("DELETE FROM match_players WHERE account_id BETWEEN 29001 AND 29015 OR account_id BETWEEN 29120 AND 29125"))
        session.execute(text("DELETE FROM players WHERE account_id BETWEEN 29001 AND 29015 OR account_id BETWEEN 29120 AND 29125"))
    _clear_limit("search")
    _clear_limit("refresh")


class SearchProvider:
    def __init__(self, rows=None, error=None):
        self.rows = rows or []
        self.error = error
        self.queries = []

    def search_players(self, query):
        self.queries.append(query)
        if self.error:
            raise self.error
        return self.rows

    def fetch_player(self, account_id):
        from deadlock.providers.schemas import PlayerCandidate
        if self.error:
            raise self.error
        return PlayerCandidate(account_id=account_id, personaname="Player")


def _clear_limit(bucket):
    from redis import Redis
    redis = Redis.from_url(os.environ["TEST_REDIS_URL"])
    keys = list(redis.scan_iter(match=f"api:rate:{bucket}:*"))
    if keys:
        redis.delete(*keys)
    redis.close()


def test_ambiguous_nickname_returns_candidates_as_string_ids(live_dependencies, migrated_engine):
    from deadlock.providers.schemas import PlayerCandidate

    _clear_limit("search")
    app = create_app()
    candidates = [PlayerCandidate(account_id=value, personaname="Shroud") for value in (29001, 29002)]
    with TestClient(app) as client:
        app.state.provider = SearchProvider(candidates)
        response = client.get("/api/v1/players/search", params={"q": "  shroud  "})

    assert response.status_code == 200
    body = response.json()
    assert [item["account_id"] for item in body["data"]] == ["29001", "29002"]
    assert body["meta"]["source"] == "deadlock-api"


def test_search_normalizes_account_and_steam64_ids_and_rejects_url(live_dependencies, migrated_engine):
    from deadlock.providers.schemas import PlayerCandidate

    _clear_limit("search")
    app = create_app()
    provider = SearchProvider([PlayerCandidate(account_id=29001, personaname="Player")])
    with TestClient(app) as client:
        app.state.provider = provider
        account = client.get("/api/v1/players/search", params={"q": "29001"})
        steam64 = client.get("/api/v1/players/search", params={"q": str(76561197960265728 + 29001)})
        url = client.get("/api/v1/players/search", params={"q": "https://example.com/player/29001"})

    assert account.status_code == steam64.status_code == 200
    assert provider.queries == []
    assert account.json()["data"][0]["account_id"] == steam64.json()["data"][0]["account_id"] == "29001"
    assert url.status_code == 422
    assert "error" in url.json()


def test_invalid_account_id_uses_standard_422_error(live_dependencies, migrated_engine):
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/v1/players/0")

    assert response.status_code == 422
    assert set(response.json()) == {"error"}
    assert response.json()["error"]["request_id"]


def test_missing_profile_returns_404_error_envelope(live_dependencies, migrated_engine):
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/v1/players/29003")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "player_not_found"


def test_profile_returns_nullable_rank_and_stale_history_metadata(live_dependencies, migrated_engine):
    with migrated_engine.begin() as session:
        session.execute(text("INSERT INTO players (account_id, personaname, rank_badge, profile_updated_at, history_coverage, history_stale) VALUES (29008, 'Player', NULL, :updated, 'partial', true) ON CONFLICT (account_id) DO UPDATE SET personaname='Player', rank_badge=NULL, profile_updated_at=:updated, history_coverage='partial', history_stale=true"), {"updated": datetime(2026, 10, 19, tzinfo=timezone.utc)})
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/v1/players/29008")

    assert response.status_code == 200
    assert response.json()["data"]["rank_badge"] is None
    assert response.json()["meta"]["stale"] is True
    assert response.json()["meta"]["coverage"] == "partial"


def test_placeholder_profile_returns_nullable_personaname(live_dependencies, migrated_engine):
    with migrated_engine.begin() as session:
        session.execute(text("INSERT INTO players (account_id, personaname) VALUES (29009, NULL) ON CONFLICT (account_id) DO UPDATE SET personaname=NULL"))
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/players/29009")

    assert response.status_code == 200
    assert response.json()["data"]["personaname"] is None


def test_refresh_returns_202_and_reuses_active_job(live_dependencies, migrated_engine):
    _clear_limit("refresh")
    _reset(migrated_engine, 29004)
    app = create_app()
    with TestClient(app) as client:
        first = client.post("/api/v1/players/29004/refresh")
        second = client.post("/api/v1/players/29004/refresh")

    assert first.status_code == second.status_code == 202
    job_id = first.json()["data"]["job_id"]
    assert UUID(job_id)
    assert second.json()["data"]["job_id"] == job_id
    assert second.json()["meta"]["reused"] is True


def test_refresh_rate_limit_is_five_per_minute(live_dependencies, migrated_engine):
    _clear_limit("refresh")
    app = create_app()
    with TestClient(app) as client:
        responses = [client.post(f"/api/v1/players/{29120 + index}/refresh") for index in range(6)]

    assert [response.status_code for response in responses].count(202) == 5
    assert responses[-1].status_code == 429
    assert responses[-1].json()["error"]["code"] == "rate_limit_exceeded"


def test_job_status_returns_persisted_status(live_dependencies, migrated_engine):
    _clear_limit("refresh")
    _reset(migrated_engine, 29005)
    app = create_app()
    with TestClient(app) as client:
        created = client.post("/api/v1/players/29005/refresh")
        response = client.get(f"/api/v1/refresh-jobs/{created.json()['data']['job_id']}")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "queued"
    data = response.json()["data"]
    assert data["attempts"] == 0
    assert set(data) == {"job_id", "status", "attempts", "created_at", "updated_at", "error_code"}


def test_untrusted_forwarded_header_does_not_bypass_search_limit(live_dependencies, migrated_engine):
    from deadlock.providers.schemas import PlayerCandidate

    _clear_limit("search")
    app = create_app()
    with TestClient(app) as client:
        app.state.provider = SearchProvider([PlayerCandidate(account_id=29006, personaname="Player")])
        responses = [client.get("/api/v1/players/search", params={"q": "player"},
                                headers={"X-Forwarded-For": f"198.51.100.{index}"}) for index in range(31)]

    assert [response.status_code for response in responses].count(429) == 1
    assert responses[-1].json()["error"]["code"] == "rate_limit_exceeded"


def test_source_failure_without_saved_search_data_returns_503(live_dependencies, migrated_engine):
    from deadlock.providers.deadlock_api import ProviderUnavailable

    _clear_limit("search")
    app = create_app()
    with TestClient(app) as client:
        app.state.provider = SearchProvider(error=ProviderUnavailable("provider down"))
        response = client.get("/api/v1/players/search", params={"q": "unknown"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"
    assert "provider down" not in response.text


def test_source_failure_uses_saved_search_candidates_as_stale(live_dependencies, migrated_engine):
    from deadlock.providers.deadlock_api import ProviderUnavailable
    from deadlock.providers.schemas import PlayerCandidate

    _clear_limit("search")
    app = create_app()
    with TestClient(app) as client:
        app.state.provider = SearchProvider([PlayerCandidate(account_id=29007, personaname="Cached")])
        first = client.get("/api/v1/players/search", params={"q": "cached query"})
        app.state.provider = SearchProvider(error=ProviderUnavailable("provider down"))
        second = client.get("/api/v1/players/search", params={"q": "cached query"})

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["meta"]["stale"] is True
    assert second.json()["data"][0]["account_id"] == "29007"


def test_openapi_exposes_public_ids_as_strings(live_dependencies, migrated_engine):
    schema = create_app().openapi()
    components = schema["components"]["schemas"]
    assert components["PlayerCandidateOut"]["properties"]["account_id"]["type"] == "string"
    assert components["RefreshAccepted"]["properties"]["job_id"]["type"] == "string"
    assert components["MatchOut"]["properties"]["match_id"]["type"] == "string"
    personaname_schema = components["PlayerOut"]["properties"]["personaname"]
    assert {"type": "string"} in personaname_schema["anyOf"]
    assert {"type": "null"} in personaname_schema["anyOf"]
    assert components["JobOut"]["properties"]["attempts"]["type"] == "integer"
    assert "progress" not in components["JobOut"]["properties"]
    item_schema = components["MatchItemOut"]["properties"]["item_id"]
    assert {"type": "string"} in item_schema["anyOf"]
    assert schema["paths"]["/api/v1/matches/{match_id}"]["get"]["parameters"][0]["schema"]["type"] == "string"
