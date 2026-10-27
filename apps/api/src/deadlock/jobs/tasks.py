import os
from datetime import datetime, timezone
from uuid import uuid4

from celery.signals import worker_ready
from redis import Redis
from sqlalchemy.orm import sessionmaker

from deadlock.core.cache import Cache
from deadlock.core.config import Settings
from deadlock.core.db import build_engine
from deadlock.jobs.celery_app import celery_app
from deadlock.jobs.dispatcher import dispatch_queued_jobs
from deadlock.jobs.models import RefreshJob
from deadlock.jobs.runner import RefreshRetryScheduled, run_match_metadata_job, run_refresh_job
from deadlock.heroes.service import (
    ANALYTICS_TTL, CATALOG_TTL, analytics_filter_key, analytics_filters,
    default_analytics_period, latest_catalog_update, parse_analytics_filters, refresh_hero_analytics,
    refresh_hero_catalog,
)
from deadlock.heroes.models import HeroAnalyticsSnapshot
from deadlock.providers.deadlock_api import ProviderBadResponse, ProviderUnavailable
from deadlock.providers.limiter import RateLimitDeferred, RateLimitUnavailable
from sqlalchemy import select
from deadlock.providers.deadlock_api import DeadlockProvider
from deadlock.providers.limiter import RedisRateLimiter


def _dependencies():
    settings = Settings()
    engine = build_engine(settings)
    redis = Redis.from_url(settings.redis_url.get_secret_value(), socket_connect_timeout=2, socket_timeout=20)
    return engine, sessionmaker(engine, expire_on_commit=False), redis


@celery_app.task(bind=True, name="deadlock.refresh_player", max_retries=3)
def refresh_player_task(self, job_id: str):
    engine, session_factory, redis = _dependencies()
    provider = DeadlockProvider(os.environ.get("DEADLOCK_API_BASE_URL", "https://api.deadlock-api.com/v1"),
                               limiter=RedisRateLimiter(redis),
                               steam_api_key=Settings().steam_api_key.get_secret_value())
    try:
        try:
            with session_factory() as session:
                is_match_job = session.execute(select(RefreshJob.target_match_id).where(
                    RefreshJob.job_id == job_id,
                )).scalar_one_or_none() is not None
            runner = run_match_metadata_job if is_match_job else run_refresh_job
            return runner(session_factory, provider, Cache(redis), job_id, retry_count=self.request.retries)
        except RefreshRetryScheduled as exc:
            raise self.retry(exc=exc, countdown=exc.countdown)
    finally:
        provider.close()
        redis.close()
        engine.dispose()


@celery_app.task(name="deadlock.dispatch_queued_refreshes")
def dispatch_queued_refreshes_task():
    engine, session_factory, redis = _dependencies()
    try:
        with session_factory.begin() as session:
            return dispatch_queued_jobs(
                session,
                lambda job_id: refresh_player_task.apply_async(args=[job_id], task_id=job_id),
            )
    finally:
        redis.close()
        engine.dispose()


_UNLOCK = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end"


def _under_redis_lock(redis, key, operation, *, expires=1800):
    token = str(uuid4())
    if not redis.set(key, token, nx=True, ex=expires):
        return {"skipped": "already_running"}
    try:
        return operation()
    finally:
        redis.eval(_UNLOCK, 1, key, token)


def _refresh_catalog_if_stale(session_factory, provider, redis):
    def refresh():
        with session_factory() as session:
            updated_at = latest_catalog_update(session)
        if updated_at is not None and datetime.now(timezone.utc) - updated_at <= CATALOG_TTL:
            return {"skipped": "fresh"}
        return {"heroes": refresh_hero_catalog(session_factory, provider)}

    return _under_redis_lock(redis, "deadlock:hero-catalog:refresh", refresh)


@celery_app.task(bind=True, name="deadlock.refresh_hero_catalog", max_retries=3)
def refresh_hero_catalog_task(self):
    engine, session_factory, redis = _dependencies()
    provider = DeadlockProvider(os.environ.get("DEADLOCK_API_BASE_URL", "https://api.deadlock-api.com/v1"),
                               limiter=RedisRateLimiter(redis))
    try:
        try:
            return _refresh_catalog_if_stale(session_factory, provider, redis)
        except (ProviderUnavailable, RateLimitDeferred, RateLimitUnavailable, OSError) as exc:
            raise self.retry(exc=exc, countdown=(5, 15, 45)[min(self.request.retries, 2)])
    finally:
        redis.close()
        engine.dispose()


@celery_app.task(bind=True, name="deadlock.refresh_hero_analytics", max_retries=3)
def refresh_hero_analytics_task(self, filters: dict | None = None):
    engine, session_factory, redis = _dependencies()
    provider = DeadlockProvider(os.environ.get("DEADLOCK_API_BASE_URL", "https://api.deadlock-api.com/v1"),
                               limiter=RedisRateLimiter(redis))
    if filters is None:
        start, end = default_analytics_period()
        filters = analytics_filters(start, end)
    else:
        start, end, minimum, maximum = parse_analytics_filters(filters)
        filters = analytics_filters(start, end, min_average_badge=minimum,
                                    max_average_badge=maximum)

    def refresh():
        with session_factory() as session:
            snapshot = session.execute(select(HeroAnalyticsSnapshot).where(
                HeroAnalyticsSnapshot.filter_key == analytics_filter_key(filters),
            ).order_by(HeroAnalyticsSnapshot.fetched_at.desc()).limit(1)).scalar_one_or_none()
            if snapshot and datetime.now(timezone.utc) - snapshot.fetched_at <= ANALYTICS_TTL:
                return {"skipped": "fresh", "sample_size": snapshot.sample_size}
        _refresh_catalog_if_stale(session_factory, provider, redis)
        return refresh_hero_analytics(
            session_factory, provider, start=start, end=end,
            min_average_badge=filters.get("min_average_badge"),
            max_average_badge=filters.get("max_average_badge"),
        )

    try:
        try:
            return _under_redis_lock(
                redis, f"deadlock:hero-analytics:refresh:{analytics_filter_key(filters)}", refresh,
            )
        except (ProviderUnavailable, RateLimitDeferred, RateLimitUnavailable, OSError) as exc:
            raise self.retry(exc=exc, countdown=(5, 15, 45)[min(self.request.retries, 2)])
    finally:
        redis.close()
        engine.dispose()


def dispatch_hero_bootstrap(redis, enqueue):
    token = str(uuid4())
    key = "deadlock:hero-analytics:bootstrap"
    if not redis.set(key, token, nx=True, ex=3600):
        return False
    try:
        enqueue()
        return True
    except Exception:
        redis.eval(_UNLOCK, 1, key, token)
        raise


def dispatch_hero_analytics_refresh(redis, filters: dict, enqueue):
    key = f"deadlock:hero-analytics:queued:{analytics_filter_key(filters)}"
    if not redis.set(key, "queued", nx=True, ex=600):
        return False
    try:
        enqueue(kwargs={"filters": filters})
        return True
    except Exception:
        redis.delete(key)
        raise


@worker_ready.connect(weak=False)
def bootstrap_hero_analytics(sender=None, **kwargs):
    engine, _, redis = _dependencies()
    try:
        dispatch_hero_bootstrap(redis, refresh_hero_analytics_task.apply_async)
    except Exception:
        return
    finally:
        redis.close()
        engine.dispose()
