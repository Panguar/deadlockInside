from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Barrier
from threading import Thread
from urllib.parse import urlsplit, urlunsplit

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from deadlock.jobs.dispatcher import dispatch_queued_jobs, recover_expired_jobs
from deadlock.jobs.service import request_refresh
from deadlock.jobs.runner import RefreshRetryScheduled, run_refresh_job
from deadlock.providers.deadlock_api import ProviderUnavailable
from deadlock.providers.schemas import ProviderHistoryEntry, ProviderMatch, ProviderMatchPlayer, ProviderPlayer


def seed(db):
    db.execute(text("INSERT INTO players (account_id) VALUES (10001) ON CONFLICT DO NOTHING"))


def reset_player(factory, account_id, match_ids=()):
    with factory.begin() as session:
        session.execute(text("DELETE FROM refresh_jobs WHERE account_id=:id"), {"id": account_id})
        for match_id in match_ids:
            session.execute(text("DELETE FROM match_players WHERE match_id=:id"), {"id": match_id})
            session.execute(text("DELETE FROM matches WHERE match_id=:id"), {"id": match_id})
        session.execute(text("INSERT INTO players (account_id) VALUES (:id) ON CONFLICT DO NOTHING"), {"id": account_id})


def test_concurrent_requests_reuse_active_job_and_cooldown_result(db):
    seed(db)
    first = request_refresh(db, 10001, now=datetime(2026, 10, 19, tzinfo=timezone.utc))
    second = request_refresh(db, 10001, now=datetime(2026, 10, 19, 0, 1, tzinfo=timezone.utc))

    assert second.job_id == first.job_id
    assert db.execute(text("SELECT count(*) FROM refresh_jobs WHERE account_id=10001")).scalar_one() == 1


def test_refresh_after_cooldown_queues_new_job(db):
    seed(db)
    first = request_refresh(db, 10001, now=datetime(2026, 10, 19, tzinfo=timezone.utc))
    db.execute(text("UPDATE refresh_jobs SET status='succeeded', finished_at=:finished WHERE job_id=:job"), {
        "finished": datetime(2026, 10, 19, tzinfo=timezone.utc), "job": first.job_id,
    })
    second = request_refresh(db, 10001, now=datetime(2026, 10, 19, 0, 4, 59, tzinfo=timezone.utc))
    third = request_refresh(db, 10001, now=datetime(2026, 10, 19, 0, 5, tzinfo=timezone.utc))
    assert second.job_id == first.job_id
    assert third.job_id != first.job_id


def test_expired_running_lease_is_requeued_for_dispatch(db):
    seed(db)
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    job = request_refresh(db, 10001, now=now)
    db.execute(text("UPDATE refresh_jobs SET status='running', lease_expires_at=:expired WHERE job_id=:job"), {
        "expired": now - timedelta(seconds=1), "job": job.job_id,
    })
    recovered = recover_expired_jobs(db, now=now)
    assert recovered == 1
    assert db.execute(text("SELECT status, lease_token FROM refresh_jobs WHERE job_id=:job"), {"job": job.job_id}).one() == ("queued", None)


def test_simultaneous_refresh_requests_create_one_active_job(migrated_engine):
    account_id = 10002
    now = datetime(2026, 10, 19, 1, tzinfo=timezone.utc)
    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO players (account_id) VALUES (:id) ON CONFLICT DO NOTHING"), {"id": account_id})
        connection.execute(text("DELETE FROM refresh_jobs WHERE account_id=:id"), {"id": account_id})
    barrier = Barrier(2)

    def request():
        with Session(migrated_engine) as session:
            barrier.wait()
            job = request_refresh(session, account_id, now=now)
            session.commit()
            return job.job_id

    with ThreadPoolExecutor(max_workers=2) as pool:
        job_ids = list(pool.map(lambda _: request(), range(2)))

    assert job_ids[0] == job_ids[1]
    with migrated_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM refresh_jobs WHERE account_id=:id AND status IN ('queued','running')"), {"id": account_id}).scalar_one() == 1


def test_dispatcher_leaves_job_queued_when_broker_is_unavailable(db):
    seed(db)
    job = request_refresh(db, 10001, now=datetime(2026, 10, 19, tzinfo=timezone.utc))

    def unavailable(_job_id):
        raise ConnectionError("broker offline")

    try:
        dispatch_queued_jobs(db, unavailable, now=datetime(2026, 10, 19, tzinfo=timezone.utc))
    except ConnectionError:
        pass

    assert db.execute(text("SELECT status, dispatched_at FROM refresh_jobs WHERE job_id=:job"), {"job": job.job_id}).one() == ("queued", None)


def test_dispatcher_publishes_saved_queued_job_and_records_dispatch(db):
    seed(db)
    now = datetime(2026, 10, 19, tzinfo=timezone.utc)
    job = request_refresh(db, 10001, now=now)
    sent = []

    assert dispatch_queued_jobs(db, sent.append, now=now) == 1
    assert sent == [str(job.job_id)]
    assert db.execute(text("SELECT status, dispatched_at FROM refresh_jobs WHERE job_id=:job"), {"job": job.job_id}).one() == ("queued", now)


def test_duplicate_delivery_does_not_repeat_provider_work_and_invalidates_after_commit(migrated_engine):
    from sqlalchemy.orm import sessionmaker

    now = datetime(2026, 10, 19, 2, tzinfo=timezone.utc)
    account_id = 10003
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id, (92001,))
    with factory.begin() as session:
        job = request_refresh(session, account_id, now=now)
        job_id = job.job_id

    history = ProviderHistoryEntry(account_id=account_id, match_id=92001, hero_id=58,
                                   started_at=now - timedelta(hours=1), kills=3)

    class Provider:
        last_history_stale = False

        def __init__(self):
            self.player_calls = self.history_calls = self.match_calls = 0

        def fetch_player(self, _account_id):
            self.player_calls += 1
            return ProviderPlayer(account_id=account_id, personaname="Example", rank_badge=None)

        def fetch_match_history(self, _account_id):
            self.history_calls += 1
            return [history]

        def fetch_match(self, _match_id):
            self.match_calls += 1
            return ProviderMatch(match_id=92001, started_at=history.started_at, duration_s=1000,
                                 winning_team=1, players=[ProviderMatchPlayer(account_id=account_id, hero_id=58, kills=3)], status="complete")

    class CommitCheckingCache:
        invalidations = 0

        def invalidate_refresh(self, checked_id, match_ids, participant_ids):
            with factory() as session:
                row = session.execute(text("SELECT status FROM refresh_jobs WHERE job_id=:id"), {"id": job_id}).one()
                assert row.status == "succeeded"
                assert session.execute(text("SELECT count(*) FROM matches WHERE match_id=92001")).scalar_one() == 1
            assert checked_id == account_id
            assert 92001 in match_ids
            assert account_id in participant_ids
            self.invalidations += 1

    provider = Provider()
    cache = CommitCheckingCache()

    assert run_refresh_job(factory, provider, cache, job_id, now=now) == "succeeded"
    assert run_refresh_job(factory, provider, cache, job_id, now=now + timedelta(seconds=1)) == "succeeded"

    assert (provider.player_calls, provider.history_calls, provider.match_calls) == (1, 1, 1)
    assert cache.invalidations == 1
    reset_player(factory, account_id, (92001,))
    with factory.begin() as session:
        session.execute(text("DELETE FROM players WHERE account_id=:id"), {"id": account_id})


def test_retryable_provider_failure_persists_queued_job_and_retry_after(migrated_engine):
    from sqlalchemy.orm import sessionmaker

    account_id = 10004
    now = datetime(2026, 10, 19, 3, tzinfo=timezone.utc)
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id)
    with factory.begin() as session:
        job_id = request_refresh(session, account_id, now=now).job_id

    class Provider:
        def fetch_player(self, _account_id):
            raise ProviderUnavailable("busy", retry_after=12)

    with pytest.raises(RefreshRetryScheduled) as caught:
        run_refresh_job(factory, Provider(), None, job_id, retry_count=0, now=now)

    assert caught.value.countdown == 12
    with factory() as session:
        row = session.execute(text("SELECT status, attempts, available_at FROM refresh_jobs WHERE job_id=:id"), {"id": job_id}).one()
    assert row.status == "queued"
    assert row.attempts == 1
    assert row.available_at == now + timedelta(seconds=12)


def test_retry_budget_marks_job_failed_after_three_retries(migrated_engine):
    from sqlalchemy.orm import sessionmaker

    account_id = 10005
    now = datetime(2026, 10, 19, 4, tzinfo=timezone.utc)
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id)
    with factory.begin() as session:
        job_id = request_refresh(session, account_id, now=now).job_id

    class Provider:
        def fetch_player(self, _account_id):
            raise ProviderUnavailable("busy")

    assert run_refresh_job(factory, Provider(), None, job_id, retry_count=3, now=now) == "failed"
    with factory() as session:
        assert session.execute(text("SELECT status, attempts FROM refresh_jobs WHERE job_id=:id"), {"id": job_id}).one() == ("failed", 1)


def test_crash_recovery_stops_after_four_total_attempts(db):
    seed(db)
    now = datetime(2026, 10, 19, 5, tzinfo=timezone.utc)
    job = request_refresh(db, 10001, now=now)

    for attempt in range(1, 5):
        db.execute(text("UPDATE refresh_jobs SET status='running', attempts=:attempt, lease_expires_at=:expired WHERE job_id=:job"), {
            "attempt": attempt, "expired": now - timedelta(seconds=1), "job": job.job_id,
        })
        assert recover_expired_jobs(db, now=now) == 1
        row = db.execute(text("SELECT status, attempts FROM refresh_jobs WHERE job_id=:job"), {"job": job.job_id}).one()
        assert row.status == ("failed" if attempt == 4 else "queued")


def test_worker_does_not_reclaim_expired_job_after_crash_budget(migrated_engine):
    from sqlalchemy.orm import sessionmaker

    account_id = 10007
    now = datetime.now(timezone.utc)
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id)
    with factory.begin() as session:
        job_id = request_refresh(session, account_id, now=now).job_id
        session.execute(text("UPDATE refresh_jobs SET status='running', attempts=4, lease_expires_at=:expired WHERE job_id=:id"),
                        {"expired": now - timedelta(seconds=1), "id": job_id})

    class Provider:
        calls = 0

        def fetch_player(self, _account_id):
            self.calls += 1
            raise AssertionError("expired exhausted job must not be claimed")

    provider = Provider()
    assert run_refresh_job(factory, provider, None, job_id, now=now) == "failed"
    assert provider.calls == 0
    with factory() as session:
        assert session.execute(text("SELECT status, attempts FROM refresh_jobs WHERE job_id=:id"), {"id": job_id}).one() == ("failed", 4)


def test_retry_schedule_uses_actual_failure_time(migrated_engine):
    from sqlalchemy.orm import sessionmaker

    account_id = 10008
    started = datetime.now(timezone.utc) - timedelta(minutes=10)
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id)
    with factory.begin() as session:
        job_id = request_refresh(session, account_id, now=started).job_id

    class Provider:
        def fetch_player(self, _account_id):
            raise ProviderUnavailable("busy", retry_after=12)

    with pytest.raises(RefreshRetryScheduled):
        run_refresh_job(factory, Provider(), None, job_id, now=started, clock=lambda: datetime.now(timezone.utc))
    with factory() as session:
        available_at = session.execute(text("SELECT available_at FROM refresh_jobs WHERE job_id=:id"), {"id": job_id}).scalar_one()
    assert available_at >= datetime.now(timezone.utc) + timedelta(seconds=11)

    failed_account = 10011
    reset_player(factory, failed_account)
    with factory.begin() as session:
        failed_job_id = request_refresh(session, failed_account, now=started).job_id

    class MissingProvider:
        def fetch_player(self, _account_id):
            from deadlock.providers.deadlock_api import ProviderNotFound
            raise ProviderNotFound("missing")

    failure_time = datetime.now(timezone.utc)
    assert run_refresh_job(factory, MissingProvider(), None, failed_job_id, now=started,
                           clock=lambda: datetime.now(timezone.utc)) == "failed"
    with factory() as session:
        finished_at = session.execute(text("SELECT finished_at FROM refresh_jobs WHERE job_id=:id"),
                                      {"id": failed_job_id}).scalar_one()
    assert finished_at >= failure_time


def test_rate_limit_deferral_does_not_consume_provider_retry_budget(migrated_engine):
    from sqlalchemy.orm import sessionmaker
    from deadlock.providers.limiter import RateLimitDeferred

    account_id = 10009
    now = datetime.now(timezone.utc)
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id)
    with factory.begin() as session:
        job_id = request_refresh(session, account_id, now=now).job_id

    class Provider:
        def fetch_player(self, _account_id):
            raise RateLimitDeferred(60)

    assert run_refresh_job(factory, Provider(), None, job_id, now=now) == "queued"
    with factory() as session:
        status, attempts, available_at = session.execute(text(
            "SELECT status, attempts, available_at FROM refresh_jobs WHERE job_id=:id"), {"id": job_id}).one()
    assert status == "queued"
    assert attempts == 0
    assert available_at >= now + timedelta(seconds=60)


def test_retry_after_metadata_failure_resumes_without_refetching_history(migrated_engine):
    from sqlalchemy.orm import sessionmaker

    account_id = 10010
    now = datetime.now(timezone.utc)
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id, (93001,))
    with factory.begin() as session:
        job_id = request_refresh(session, account_id, now=now).job_id
    entry = ProviderHistoryEntry(account_id=account_id, match_id=93001, hero_id=58, started_at=now)

    class Provider:
        last_history_stale = False

        def __init__(self):
            self.history_calls = 0
            self.match_calls = 0

        def fetch_player(self, _account_id):
            return ProviderPlayer(account_id=account_id, personaname="Resume", rank_badge=None)

        def fetch_match_history(self, _account_id):
            self.history_calls += 1
            return [entry]

        def fetch_match(self, match_id):
            self.match_calls += 1
            if self.match_calls == 1:
                raise ProviderUnavailable("metadata busy")
            return ProviderMatch(match_id=match_id, started_at=now, duration_s=100,
                                 winning_team=1, players=[ProviderMatchPlayer(account_id=account_id, hero_id=58)], status="complete")

    provider = Provider()
    with pytest.raises(RefreshRetryScheduled):
        run_refresh_job(factory, provider, None, job_id, now=now)
    assert run_refresh_job(factory, provider, None, job_id, now=now + timedelta(seconds=5)) == "succeeded"
    assert provider.history_calls == 1
    reset_player(factory, account_id, (93001,))
    with factory.begin() as session:
        session.execute(text("DELETE FROM players WHERE account_id=:id"), {"id": account_id})


def test_refresh_fetches_metadata_for_only_twenty_newest_missing_matches(migrated_engine):
    from sqlalchemy.orm import sessionmaker

    account_id = 10006
    now = datetime(2026, 10, 19, 6, tzinfo=timezone.utc)
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    reset_player(factory, account_id)
    with factory.begin() as session:
        job_id = request_refresh(session, account_id, now=now).job_id
    entries = [ProviderHistoryEntry(
        account_id=account_id, match_id=94000 + index, hero_id=58,
        started_at=now - timedelta(minutes=index), kills=index,
    ) for index in range(25)]

    class Provider:
        last_history_stale = False

        def __init__(self):
            self.match_ids = []

        def fetch_player(self, _account_id):
            return ProviderPlayer(account_id=account_id, personaname="Batch", rank_badge=0)

        def fetch_match_history(self, _account_id):
            return entries

        def fetch_match(self, match_id):
            self.match_ids.append(match_id)
            row = next(entry for entry in entries if entry.match_id == match_id)
            return ProviderMatch(match_id=match_id, started_at=row.started_at, duration_s=100,
                                 winning_team=1, players=[ProviderMatchPlayer(account_id=account_id, hero_id=58)], status="complete")

    provider = Provider()
    assert run_refresh_job(factory, provider, None, job_id, now=now) == "succeeded"

    assert len(provider.match_ids) == 20
    assert set(provider.match_ids) == {94000 + index for index in range(20)}
    with factory() as session:
        assert session.execute(text("SELECT count(*) FROM matches WHERE match_id BETWEEN 94000 AND 94024 AND status='complete'")).scalar_one() == 20
    reset_player(factory, account_id, range(94000, 94025))
    with factory.begin() as session:
        session.execute(text("DELETE FROM players WHERE account_id=:id"), {"id": account_id})


def test_celery_worker_processes_duplicate_delivery_with_real_redis_and_local_provider(migrated_engine, monkeypatch):
    from celery.contrib.testing.worker import start_worker
    from redis import Redis
    from sqlalchemy.orm import sessionmaker

    fixture_root = Path(__file__).parents[1] / "fixtures" / "provider"
    profile = json.loads((fixture_root / "profile.json").read_text())
    rank = json.loads((fixture_root / "rank-unranked.json").read_text())
    history = json.loads((fixture_root / "history.json").read_text())[:1]
    metadata = json.loads((fixture_root / "match-metadata.json").read_text())
    for participant in metadata["match_info"]["players"]:
        participant["hero_id"] += 10_000
    participant_ids = [row["account_id"] for row in metadata["match_info"]["players"]]
    served = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            served.append(self.path)
            if self.path.startswith("/v1/players/steam?"):
                payload = profile
            elif self.path == "/v1/players/10001/rank":
                payload = rank
            elif self.path == "/v1/players/10001/match-history":
                payload = history
            elif self.path.startswith("/v1/matches/90001/metadata"):
                payload = metadata
            else:
                self.send_error(404)
                return
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server_thread = Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    monkeypatch.setenv("DEADLOCK_API_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    test_redis_url = os.environ.get("TEST_REDIS_URL")
    if not test_redis_url:
        pytest.fail("Set TEST_REDIS_URL to an isolated test Redis instance")
    redis_parts = urlsplit(test_redis_url)
    isolated_redis_url = urlunsplit(redis_parts._replace(path="/15"))
    monkeypatch.setenv("REDIS_URL", isolated_redis_url)
    redis = Redis.from_url(isolated_redis_url)
    redis.flushdb()
    factory = sessionmaker(migrated_engine, expire_on_commit=False)
    now = datetime.now(timezone.utc)
    reset_player(factory, 10001, (90001,))
    with factory.begin() as session:
        job_id = request_refresh(session, 10001, now=now).job_id

    try:
        from deadlock.jobs.celery_app import celery_app
        from deadlock.jobs.tasks import refresh_player_task
        celery_app.conf.update(broker_url=isolated_redis_url, result_backend=isolated_redis_url)

        with start_worker(celery_app, pool="solo", loglevel="WARNING", perform_ping_check=False):
            first = refresh_player_task.apply_async(args=[str(job_id)])
            assert first.get(timeout=30) == "succeeded"
            duplicate = refresh_player_task.apply_async(args=[str(job_id)])
            assert duplicate.get(timeout=30) == "succeeded"
        with factory() as session:
            assert session.execute(text("SELECT status FROM refresh_jobs WHERE job_id=:id"), {"id": job_id}).scalar_one() == "succeeded"
            assert session.execute(text("SELECT count(*) FROM matches WHERE match_id=90001")).scalar_one() == 1
            assert session.execute(text("SELECT count(*) FROM match_players WHERE match_id=90001")).scalar_one() == 12
        assert len(served) == 4
        assert any("disable_steam=true" in path for path in served)
    finally:
        server.shutdown()
        server.server_close()
        with factory.begin() as session:
            session.execute(text("DELETE FROM refresh_jobs WHERE account_id = ANY(:ids)"), {"ids": participant_ids})
            session.execute(text("DELETE FROM match_players WHERE match_id=90001"))
            session.execute(text("DELETE FROM matches WHERE match_id=90001"))
            session.execute(text("DELETE FROM players WHERE account_id=10001"))
        redis.close()
