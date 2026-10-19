from datetime import datetime, timedelta, timezone
import base64
import json

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text

from deadlock.main import create_app


BASE = datetime(2026, 10, 19, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def clean_api_matches(migrated_engine):
    yield
    with migrated_engine.begin() as session:
        session.execute(text("DELETE FROM refresh_jobs WHERE target_match_id BETWEEN 92100 AND 92304 OR account_id IN (29101, 29102, 29110, 29111)"))
        session.execute(text("DELETE FROM match_players WHERE account_id IN (29101, 29102, 29110, 29111)"))
        session.execute(text("DELETE FROM matches WHERE match_id BETWEEN 92100 AND 92304"))
        session.execute(text("DELETE FROM players WHERE account_id IN (29101, 29102, 29110, 29111)"))


def _seed_matches(engine, account_id=29101):
    with engine.begin() as session:
        session.execute(text("DELETE FROM refresh_jobs WHERE account_id=:id"), {"id": account_id})
        session.execute(text("DELETE FROM match_players WHERE account_id=:id"), {"id": account_id})
        session.execute(text("DELETE FROM matches WHERE match_id BETWEEN 92100 AND 92120"))
        session.execute(text("DELETE FROM players WHERE account_id=:id"), {"id": account_id})
        session.execute(text("INSERT INTO players (account_id, history_updated_at, history_coverage, history_stale) VALUES (:id, :updated, 'unknown', false)"),
                        {"id": account_id, "updated": BASE})
        session.execute(text("INSERT INTO heroes (hero_id, name) VALUES (58, 'Hero 58') ON CONFLICT DO NOTHING"))
        for match_id, started_at in ((92101, BASE), (92102, BASE), (92103, BASE - timedelta(days=1)), (92104, BASE + timedelta(seconds=1))):
            session.execute(text("INSERT INTO matches (match_id, started_at, duration_s, status) VALUES (:id, :started, 1200, 'complete')"),
                            {"id": match_id, "started": started_at})
            session.execute(text("INSERT INTO match_players (match_id, account_id, hero_id, kills) VALUES (:match, :account, 58, 3)"),
                            {"match": match_id, "account": account_id})


def test_history_has_stable_cursor_for_tied_timestamps_and_filter_binding(live_dependencies, migrated_engine):
    _seed_matches(migrated_engine)
    app = create_app()
    with TestClient(app) as client:
        params = {"limit": 1, "to": (BASE + timedelta(seconds=1)).isoformat()}
        first = client.get("/api/v1/players/29101/matches", params=params)
        second = client.get("/api/v1/players/29101/matches", params={**params, "cursor": first.json()["meta"]["next_cursor"]})
        changed_filter = client.get("/api/v1/players/29101/matches", params={**params, "hero_id": 58, "cursor": first.json()["meta"]["next_cursor"]})

    assert first.status_code == second.status_code == 200
    assert first.json()["data"][0]["match_id"] == "92102"
    assert second.json()["data"][0]["match_id"] == "92101"
    assert changed_filter.status_code == 422


def test_history_validates_cursor_limits_and_half_open_time_bounds(live_dependencies, migrated_engine):
    _seed_matches(migrated_engine)
    app = create_app()
    with TestClient(app) as client:
        malformed = client.get("/api/v1/players/29101/matches", params={"cursor": "nope"})
        too_many = client.get("/api/v1/players/29101/matches", params={"limit": 101})
        bounded = client.get("/api/v1/players/29101/matches", params={"from": BASE.isoformat(), "to": (BASE + timedelta(seconds=1)).isoformat()})

    assert malformed.status_code == too_many.status_code == 422
    assert bounded.status_code == 200
    assert [row["match_id"] for row in bounded.json()["data"]] == ["92102", "92101"]


def test_history_rejects_identifiers_above_bigint_range(live_dependencies, migrated_engine):
    _seed_matches(migrated_engine)
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        first = client.get("/api/v1/players/29101/matches", params={"limit": 1})
        cursor = first.json()["meta"]["next_cursor"]
        payload = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        payload["match_id"] = str(2**63)
        oversized_cursor = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
        bad_cursor = client.get("/api/v1/players/29101/matches", params={"cursor": oversized_cursor})
        bad_hero = client.get("/api/v1/players/29101/matches", params={"hero_id": 2**63})

    assert bad_cursor.status_code == 422
    assert bad_cursor.json()["error"]["code"] == "invalid_cursor"
    assert bad_hero.status_code == 422
    assert bad_hero.json()["error"]["code"] == "validation_error"


def test_history_rejects_time_bounds_that_overflow_during_utc_normalization(live_dependencies, migrated_engine):
    _seed_matches(migrated_engine)
    app = create_app()
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/players/29101/matches", params={"from": "0001-01-01T00:00:00+23:00"})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_history_defaults_to_twenty_and_caps_at_one_hundred(live_dependencies, migrated_engine):
    account_id = 29102
    with migrated_engine.begin() as session:
        session.execute(text("DELETE FROM refresh_jobs WHERE account_id=:id"), {"id": account_id})
        session.execute(text("DELETE FROM match_players WHERE account_id=:id"), {"id": account_id})
        session.execute(text("DELETE FROM matches WHERE match_id BETWEEN 92200 AND 92304"))
        session.execute(text("DELETE FROM players WHERE account_id=:id"), {"id": account_id})
        session.execute(text("INSERT INTO players (account_id, history_updated_at) VALUES (:id, :updated)"), {"id": account_id, "updated": BASE})
        session.execute(text("INSERT INTO heroes (hero_id, name) VALUES (60, 'Hero 60') ON CONFLICT DO NOTHING"))
        matches = [{"id": 92200 + index, "started": BASE - timedelta(seconds=index)} for index in range(105)]
        session.execute(text("INSERT INTO matches (match_id, started_at, status) VALUES (:id, :started, 'complete')"), matches)
        participants = [{"match": row["id"], "account": account_id} for row in matches]
        session.execute(text("INSERT INTO match_players (match_id, account_id, hero_id) VALUES (:match, :account, 60)"), participants)
    app = create_app()
    with TestClient(app) as client:
        default_page = client.get(f"/api/v1/players/{account_id}/matches")
        max_page = client.get(f"/api/v1/players/{account_id}/matches", params={"limit": 100})

    assert len(default_page.json()["data"]) == 20
    assert len(max_page.json()["data"]) == 100
    assert max_page.json()["meta"]["next_cursor"]


def test_match_detail_returns_partial_metadata_and_null_fields(live_dependencies, migrated_engine):
    finished_at = datetime.now(timezone.utc)
    with migrated_engine.begin() as session:
        session.execute(text("DELETE FROM matches WHERE match_id=92110"))
        session.execute(text("INSERT INTO players (account_id) VALUES (29110) ON CONFLICT DO NOTHING"))
        session.execute(text("INSERT INTO heroes (hero_id, name) VALUES (59, 'Hero 59') ON CONFLICT DO NOTHING"))
        session.execute(text("INSERT INTO matches (match_id, started_at, status) VALUES (92110, :started, 'partial')"), {"started": BASE})
        session.execute(text("INSERT INTO match_players (match_id, account_id, hero_id, kills, items) VALUES (92110, 29110, 59, 2, CAST(:items AS jsonb))"), {"items": json.dumps([{"item_id": 1234567890123, "game_time_s": 10, "sold_time_s": None, "flags": 0}])})
        session.execute(text("INSERT INTO refresh_jobs (job_id, account_id, target_match_id, status, attempts, created_at, available_at, finished_at) VALUES (gen_random_uuid(), 29110, 92110, 'succeeded', 1, :started, :started, :finished)"), {"started": BASE, "finished": finished_at})
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/v1/matches/92110")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "partial"
    assert response.json()["data"]["players"][0]["deaths"] is None
    assert response.json()["data"]["players"][0]["items"][0]["item_id"] == "1234567890123"
    assert response.json()["data"]["players"][0]["items"][0]["game_time_s"] == 10


def test_saved_partial_match_with_metadata_timestamp_returns_payload_and_queues_enrichment(live_dependencies, migrated_engine):
    with migrated_engine.begin() as session:
        session.execute(text("DELETE FROM refresh_jobs WHERE target_match_id=92111 OR account_id=29111"))
        session.execute(text("DELETE FROM match_players WHERE match_id=92111"))
        session.execute(text("DELETE FROM matches WHERE match_id=92111"))
        session.execute(text("INSERT INTO players (account_id) VALUES (29111) ON CONFLICT DO NOTHING"))
        session.execute(text("INSERT INTO heroes (hero_id, name) VALUES (61, 'Hero 61') ON CONFLICT DO NOTHING"))
        session.execute(text("INSERT INTO matches (match_id, started_at, status, metadata_updated_at) VALUES (92111, :started, 'partial', :updated)"), {"started": BASE, "updated": BASE})
        session.execute(text("INSERT INTO match_players (match_id, account_id, hero_id, kills) VALUES (92111, 29111, 61, 4)"))
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/v1/matches/92111")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "partial"
    assert response.json()["data"]["players"][0]["kills"] == 4
    with migrated_engine.connect() as session:
        assert session.execute(text("SELECT count(*) FROM refresh_jobs WHERE target_match_id=92111")).scalar_one() == 1


def test_unknown_match_is_404_and_known_cold_match_queues_deduplicated_metadata_job(live_dependencies, migrated_engine):
    _seed_matches(migrated_engine)
    with migrated_engine.begin() as session:
        session.execute(text("UPDATE matches SET status='partial', metadata_updated_at=NULL WHERE match_id=92101"))
    app = create_app()
    with TestClient(app) as client:
        unknown = client.get("/api/v1/matches/92120")
        first = client.get("/api/v1/matches/92101")
        second = client.get("/api/v1/matches/92101")

    assert unknown.status_code == 404
    assert first.status_code == second.status_code == 202
    job_id = first.json()["data"]["job_id"]
    assert second.json()["data"]["job_id"] == job_id


def test_target_match_worker_loads_only_requested_match(live_dependencies, migrated_engine):
    from sqlalchemy.orm import sessionmaker

    from deadlock.jobs.runner import run_match_metadata_job
    from deadlock.providers.schemas import ProviderMatch, ProviderMatchPlayer

    _seed_matches(migrated_engine)
    with migrated_engine.begin() as session:
        session.execute(text("UPDATE matches SET status='partial', metadata_updated_at=NULL WHERE match_id=92103"))
    app = create_app()
    with TestClient(app) as client:
        queued = client.get("/api/v1/matches/92103")
    assert queued.status_code == 202
    job_id = queued.json()["data"]["job_id"]

    class Provider:
        before_request = None
        calls = []

        def fetch_match(self, match_id):
            self.calls.append(match_id)
            return ProviderMatch(match_id=match_id, started_at=BASE - timedelta(days=1),
                                 duration_s=1300, winning_team=1, status="complete",
                                 players=[ProviderMatchPlayer(account_id=29101, hero_id=58, kills=6)])

        def fetch_player(self, _account_id):
            raise AssertionError("targeted match metadata job fetched a player profile")

        def fetch_match_history(self, _account_id):
            raise AssertionError("targeted match metadata job fetched player history")

    class Cache:
        def invalidate_refresh(self, account_id, match_ids, participant_ids):
            assert account_id == 29101
            assert match_ids == [92103]
            assert participant_ids == {29101}

    provider = Provider()
    assert run_match_metadata_job(sessionmaker(migrated_engine, expire_on_commit=False), provider,
                                  Cache(), job_id) == "succeeded"
    assert provider.calls == [92103]
    with TestClient(app) as client:
        loaded = client.get("/api/v1/matches/92103")
    assert loaded.status_code == 200
    assert loaded.json()["data"]["status"] == "complete"


def test_distinct_match_metadata_jobs_do_not_block_player_refresh(live_dependencies, migrated_engine):
    from deadlock.jobs.service import request_match_refresh, request_refresh

    _seed_matches(migrated_engine)
    with migrated_engine.begin() as session:
        first = request_match_refresh(session, 92101)
        second = request_match_refresh(session, 92103)
        player_job = request_refresh(session, 29101)

    assert first.job_id != second.job_id
    assert first.target_match_id == 92101
    assert second.target_match_id == 92103
    assert player_job.target_match_id is None


def test_player_history_stale_metadata_reflects_saved_source_fallback(live_dependencies, migrated_engine):
    _seed_matches(migrated_engine)
    with migrated_engine.begin() as session:
        session.execute(text("UPDATE players SET history_stale=true WHERE account_id=29101"))
    app = create_app()
    with TestClient(app) as client:
        response = client.get("/api/v1/players/29101/matches")

    assert response.status_code == 200
    assert response.json()["meta"]["stale"] is True
