from datetime import datetime, timezone

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session, sessionmaker

from deadlock.main import create_app


def _clean(engine):
    with engine.begin() as connection:
        connection.execute(text("DELETE FROM hero_analytics_snapshots WHERE filters->>'from' LIKE '2026-10-0%'"))
        connection.execute(text("DELETE FROM hero_catalog_snapshots WHERE hero_ids @> '[99101]'::jsonb"))
        connection.execute(text("DELETE FROM hero_stats_snapshots WHERE filter_key LIKE 'stage5-%'"))
        connection.execute(text("DELETE FROM match_players WHERE account_id IN (29101, 29102)"))
        connection.execute(text("DELETE FROM matches WHERE match_id BETWEEN 99101 AND 99104"))
        connection.execute(text("DELETE FROM heroes WHERE hero_id BETWEEN 99101 AND 99103"))
        connection.execute(text("DELETE FROM players WHERE account_id IN (29101, 29102)"))


@pytest.fixture(autouse=True)
def clean_stage5_rows(migrated_engine):
    _clean(migrated_engine)
    yield
    _clean(migrated_engine)


def test_player_stats_share_history_filters_and_keep_unknown_outcomes(live_dependencies, migrated_engine):
    _clean(migrated_engine)
    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO players (account_id) VALUES (29101)"))
        connection.execute(text("INSERT INTO heroes (hero_id, name) VALUES (99101, 'Hero Alpha'), (99102, 'Hero Beta')"))
        connection.execute(text("""
            INSERT INTO matches (match_id, started_at, status) VALUES
            (99101, '2026-10-01T00:00:00Z', 'complete'),
            (99102, '2026-10-02T00:00:00Z', 'complete'),
            (99103, '2026-10-03T00:00:00Z', 'complete'),
            (99104, '2026-10-04T00:00:00Z', 'complete')
        """))
        connection.execute(text("""
            INSERT INTO match_players (match_id, account_id, hero_id, kills, deaths, assists, player_match_outcome)
            VALUES (99101, 29101, 99101, 10, 0, 5, 1),
                   (99102, 29101, 99101, 2, 2, 2, 1),
                   (99103, 29101, 99102, 1, 1, 0, 2),
                   (99104, 29101, 99102, 4, 0, 0, 0)
        """))

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/players/29101/stats?from=2026-10-02T00:00:00Z&to=2026-10-05T00:00:00Z&hero_id=99101")

    assert response.status_code == 200
    result = response.json()
    assert result["data"] == {
        "sample_size": 1, "decided_matches": 1, "wins": 1, "win_rate": 1.0, "kda": 2.0,
        "kda_sample_size": 1,
        "heroes": [{"hero_id": "99101", "sample_size": 1, "decided_matches": 1, "wins": 1,
                    "win_rate": 1.0, "kda": 2.0, "kda_sample_size": 1}],
    }
    assert result["meta"]["source"] == "database"


def test_global_stats_use_matching_stale_snapshot_and_503_without_any_match(live_dependencies, migrated_engine):
    _clean(migrated_engine)
    from deadlock.heroes.service import analytics_filter_key

    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    end = datetime(2026, 10, 2, tzinfo=timezone.utc)
    filters = {"from": start.isoformat(), "to": end.isoformat(), "bucket": "start_time_day"}
    filter_key = analytics_filter_key(filters)
    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO heroes (hero_id, name) VALUES (99101, 'Hero Alpha')"))
        connection.execute(text("""
            INSERT INTO hero_analytics_snapshots
            (filter_key, filters, data, source, sample_size, period_start, period_end, fetched_at)
            VALUES (:key, CAST(:filters AS jsonb), CAST(:data AS jsonb), 'deadlock-api', 1, :start, :end, '2026-10-01T00:00:00Z')
        """), {"key": filter_key, "filters": __import__("json").dumps(filters),
              "data": '[{"hero_id":"99101","matches":10,"wins":6,"losses":4,"win_rate":0.6,"kda":2.5,"kda_sample_size":10}]',
              "start": start, "end": end})

    app = create_app()
    app.state.analytics_snapshot_ttl_seconds = 3600
    with TestClient(app) as client:
        matched = client.get("/api/v1/heroes/stats?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z")
        missing = client.get("/api/v1/heroes/stats?from=2026-10-02T00:00:00Z&to=2026-10-03T00:00:00Z")

    assert matched.status_code == 200
    assert matched.json()["data"][0]["hero_id"] == "99101"
    assert matched.json()["meta"]["sample_size"] == 1
    assert matched.json()["meta"]["source"] == "deadlock-api"
    assert matched.json()["meta"]["stale"] is True
    assert missing.status_code == 503
    assert missing.json()["error"]["code"] == "analytics_snapshot_unavailable"


def test_catalog_route_returns_database_catalog_and_hero_route(live_dependencies, migrated_engine):
    _clean(migrated_engine)
    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO heroes (hero_id, name, class_name) VALUES (99101, 'Hero Alpha', 'hero_alpha'), (99102, 'Hero 99102', NULL)"))
        connection.execute(text("""
            INSERT INTO hero_catalog_snapshots (source, sample_size, hero_ids)
            VALUES ('stage5-test', 1, '[99101]'::jsonb)
        """))

    with TestClient(create_app()) as client:
        catalog = client.get("/api/v1/heroes")
        hero = client.get("/api/v1/heroes/99101")
        outside_catalog = client.get("/api/v1/heroes/99102")

    assert catalog.status_code == 200
    assert any(row["hero_id"] == "99101" for row in catalog.json()["data"])
    assert hero.status_code == 200
    assert hero.json()["data"]["name"] == "Hero Alpha"
    assert outside_catalog.status_code == 404


def test_placeholder_heroes_do_not_make_a_cold_catalog_look_fresh(live_dependencies, migrated_engine):
    _clean(migrated_engine)
    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO heroes (hero_id, name) VALUES (99103, 'Hero 99103') ON CONFLICT DO NOTHING"))

    with TestClient(create_app()) as client:
        response = client.get("/api/v1/heroes")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "hero_catalog_unavailable"


def test_global_period_requires_utc_hour_alignment(live_dependencies, migrated_engine):
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/heroes/stats?from=2026-10-01T00:30:00Z&to=2026-10-02T00:00:00Z")

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_global_period_rejects_timezone_overflow_as_validation_error(live_dependencies, migrated_engine):
    with TestClient(create_app()) as client:
        response = client.get(
            "/api/v1/heroes/stats?from=0001-01-01T00:00:00%2B23:59&to=0001-01-02T00:00:00Z"
        )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_global_rank_filters_validate_and_are_canonical(live_dependencies, migrated_engine):
    with TestClient(create_app()) as client:
        invalid = client.get("/api/v1/heroes/stats?min_average_badge=10&max_average_badge=9")
        too_high = client.get("/api/v1/heroes/stats?min_average_badge=65536")

    assert invalid.status_code == 422
    assert too_high.status_code == 422


def test_global_stats_read_limit_bounds_refresh_requests(live_dependencies, migrated_engine):
    import os
    from redis import Redis

    redis = Redis.from_url(os.environ["TEST_REDIS_URL"])
    key = "api:rate:hero-stats:127.0.0.1"
    redis.set(key, 30, ex=60)
    try:
        with TestClient(create_app()) as client:
            response = client.get("/api/v1/heroes/stats")
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "rate_limit_exceeded"
    finally:
        redis.delete(key)
        redis.close()


def test_custom_analytics_filter_enqueues_once_worker_persists_and_get_returns_snapshot(
    live_dependencies, migrated_engine, monkeypatch,
):
    import os
    from redis import Redis
    from deadlock.jobs import tasks
    from deadlock.jobs import tasks
    from deadlock.heroes.service import analytics_filter_key
    from deadlock.providers.schemas import ProviderHeroStats

    _clean(migrated_engine)
    start = datetime(2026, 10, 8, tzinfo=timezone.utc)
    end = datetime(2026, 10, 10, tzinfo=timezone.utc)
    filters = {
        "from": start.isoformat(), "to": end.isoformat(), "bucket": "start_time_day",
        "min_average_badge": 12, "max_average_badge": 20,
    }
    test_redis = Redis.from_url(os.environ["TEST_REDIS_URL"])
    queue_key = f"deadlock:hero-analytics:queued:{analytics_filter_key(filters)}"
    test_redis.delete(queue_key, "api:rate:hero-stats:127.0.0.1")
    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO heroes (hero_id, name) VALUES (99101, 'Hero Alpha')"))
        connection.execute(text("""
            INSERT INTO hero_catalog_snapshots (source, sample_size, hero_ids)
            VALUES ('stage5-test', 1, '[99101]'::jsonb)
        """))

    queued = []
    worker_task = tasks.refresh_hero_analytics_task
    monkeypatch.setattr(
        tasks, "refresh_hero_analytics_task",
        type("Task", (), {"apply_async": staticmethod(lambda **kwargs: queued.append(kwargs))}),
    )
    with TestClient(create_app()) as client:
        first = client.get(
            "/api/v1/heroes/stats?from=2026-10-08T00:00:00Z&to=2026-10-10T00:00:00Z"
            "&min_average_badge=12&max_average_badge=20"
        )
        second = client.get(
            "/api/v1/heroes/stats?from=2026-10-08T00:00:00Z&to=2026-10-10T00:00:00Z"
            "&min_average_badge=12&max_average_badge=20"
        )

    assert first.status_code == second.status_code == 503
    assert len(queued) == 1, first.json()
    assert queued[0]["kwargs"] == {"filters": filters}

    class FilterAwareProvider:
        def __init__(self, **kwargs):
            self.request = None

        def fetch_hero_stats(self, **request):
            self.request = request
            assert request["min_average_badge"] == 12
            assert request["max_average_badge"] == 20
            return [ProviderHeroStats(hero_id=99101, bucket=int(start.timestamp()),
                                      wins=3, losses=1, matches=4)]

    provider = FilterAwareProvider()
    monkeypatch.setattr(tasks, "DeadlockProvider", lambda *args, **kwargs: provider)
    monkeypatch.setattr(tasks, "_dependencies", lambda: (
        migrated_engine, sessionmaker(migrated_engine, expire_on_commit=False),
        Redis.from_url(os.environ["TEST_REDIS_URL"]),
    ))
    result = worker_task.apply(kwargs={"filters": filters}, throw=True).get()
    assert result["filter_key"] == analytics_filter_key(filters)

    with TestClient(create_app()) as client:
        response = client.get(
            "/api/v1/heroes/stats?from=2026-10-08T00:00:00Z&to=2026-10-10T00:00:00Z"
            "&min_average_badge=12&max_average_badge=20"
        )
    assert response.status_code == 200
    assert response.json()["meta"]["sample_size"] == 4
    assert response.json()["data"][0]["matches"] == 4
    test_redis.delete(queue_key, "api:rate:hero-stats:127.0.0.1")
    test_redis.close()


def test_refresh_persists_empty_snapshot_and_exact_bucketed_aggregates(live_dependencies, migrated_engine):
    from deadlock.heroes.service import refresh_hero_analytics
    from deadlock.providers.schemas import ProviderHeroStats

    class AnalyticsProvider:
        def __init__(self, rows):
            self.rows = rows
            self.request = None

        def fetch_hero_stats(self, **request):
            self.request = request
            return self.rows

    start = datetime(2026, 10, 5, 1, tzinfo=timezone.utc)
    end = datetime(2026, 10, 5, 3, tzinfo=timezone.utc)
    start_epoch, end_epoch = int(start.timestamp()), int(end.timestamp())
    provider = AnalyticsProvider([
        ProviderHeroStats(hero_id=99101, bucket=start_epoch, wins=1, losses=0, matches=1,
                          total_kills=10, total_deaths=0, total_assists=5),
        ProviderHeroStats(hero_id=99101, bucket=start_epoch + 3600, wins=1, losses=1, matches=2,
                          total_kills=2, total_deaths=2, total_assists=1),
        ProviderHeroStats(hero_id=99101, bucket=end_epoch, wins=100, losses=0, matches=100,
                          total_kills=1000, total_deaths=1, total_assists=0),
    ])
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    summary = refresh_hero_analytics(factory, provider, start=start, end=end)

    assert provider.request == {"start_timestamp": start_epoch, "end_timestamp": end_epoch,
                               "bucket": "start_time_hour"}
    assert summary["sample_size"] == 3
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/heroes/stats?from=2026-10-05T01:00:00Z&to=2026-10-05T03:00:00Z")
    assert response.status_code == 200
    assert response.json()["data"][0]["matches"] == 3
    assert response.json()["data"][0]["wins"] == 2
    assert response.json()["data"][0]["losses"] == 1
    assert response.json()["data"][0]["win_rate"] == 2 / 3
    assert response.json()["data"][0]["kda"] == 9.0
    assert response.json()["data"][0]["kda_sample_size"] == 3
    assert response.json()["meta"]["sample_size"] == 3

    empty_provider = AnalyticsProvider([])
    empty_start = datetime(2026, 10, 6, tzinfo=timezone.utc)
    empty_end = datetime(2026, 10, 7, tzinfo=timezone.utc)
    empty = refresh_hero_analytics(factory, empty_provider, start=empty_start, end=empty_end)
    assert empty["sample_size"] == 0
    with TestClient(create_app()) as client:
        empty_response = client.get("/api/v1/heroes/stats?from=2026-10-06T00:00:00Z&to=2026-10-07T00:00:00Z")
    assert empty_response.status_code == 200
    assert empty_response.json()["data"] == []
    assert empty_response.json()["meta"]["sample_size"] == 0
    assert empty_response.json()["meta"]["updated_at"] is not None


def test_catalog_refresh_and_match_ingest_preserve_real_hero_name(live_dependencies, migrated_engine):
    from deadlock.heroes.service import refresh_hero_catalog
    from deadlock.providers.schemas import ProviderHero, ProviderMatch, ProviderMatchPlayer
    from deadlock.matches.ingest import ingest_match

    class CatalogProvider:
        def fetch_heroes(self):
            return [ProviderHero(hero_id=99101, name="Real Hero Name", class_name="hero_real")]

    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO heroes (hero_id, name) VALUES (99101, 'Hero 99101') ON CONFLICT DO NOTHING"))
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    assert refresh_hero_catalog(factory, CatalogProvider()) == 1
    match = ProviderMatch(
        match_id=99101, started_at=datetime(2026, 10, 1, tzinfo=timezone.utc), status="complete",
        players=[ProviderMatchPlayer(account_id=29102, hero_id=99101)],
    )
    with factory.begin() as session:
        ingest_match(session, match)
    with factory() as session:
        from deadlock.heroes.models import Hero
        assert session.get(Hero, 99101).name == "Real Hero Name"


def test_snapshot_write_rolls_back_as_one_transaction(live_dependencies, migrated_engine):
    from contextlib import contextmanager
    from deadlock.heroes.service import refresh_hero_analytics
    from deadlock.providers.schemas import ProviderHeroStats

    class OneRowProvider:
        def fetch_hero_stats(self, **kwargs):
            return [ProviderHeroStats(hero_id=99103, bucket=int(kwargs["start_timestamp"]),
                                      wins=1, losses=0, matches=1)]

    class FailingFactory:
        @contextmanager
        def begin(self):
            with migrated_engine.connect() as connection:
                transaction = connection.begin()
                with Session(bind=connection) as session:
                    try:
                        yield session
                        raise RuntimeError("simulated transaction failure")
                    finally:
                        transaction.rollback()

    start = datetime(2026, 10, 7, tzinfo=timezone.utc)
    end = datetime(2026, 10, 8, tzinfo=timezone.utc)
    with migrated_engine.connect() as connection:
        before = connection.execute(text("SELECT count(*) FROM hero_analytics_snapshots WHERE filters->>'from'=:start"),
                                    {"start": start.isoformat()}).scalar_one()
    try:
        refresh_hero_analytics(FailingFactory(), OneRowProvider(), start=start, end=end)
    except RuntimeError as exc:
        assert str(exc) == "simulated transaction failure"
    else:
        raise AssertionError("expected simulated write failure")
    with migrated_engine.connect() as connection:
        after = connection.execute(text("SELECT count(*) FROM hero_analytics_snapshots WHERE filters->>'from'=:start"),
                                   {"start": start.isoformat()}).scalar_one()
    assert after == before


def test_startup_hero_bootstrap_dispatch_is_distributed_and_deduplicated(live_dependencies):
    import os
    from redis import Redis
    from deadlock.jobs.tasks import dispatch_hero_bootstrap

    redis = Redis.from_url(os.environ["TEST_REDIS_URL"])
    redis.delete("deadlock:hero-analytics:bootstrap")
    calls = []
    try:
        assert dispatch_hero_bootstrap(redis, lambda: calls.append("queued")) is True
        assert dispatch_hero_bootstrap(redis, lambda: calls.append("duplicate")) is False
    finally:
        redis.delete("deadlock:hero-analytics:bootstrap")
        redis.close()
    assert calls == ["queued"]
