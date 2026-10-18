import os

from redis import Redis
from sqlalchemy.orm import sessionmaker

from deadlock.core.cache import Cache
from deadlock.core.config import Settings
from deadlock.core.db import build_engine
from deadlock.jobs.celery_app import celery_app
from deadlock.jobs.dispatcher import dispatch_queued_jobs
from deadlock.jobs.runner import RefreshRetryScheduled, run_refresh_job
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
                               limiter=RedisRateLimiter(redis))
    try:
        try:
            return run_refresh_job(
                session_factory, provider, Cache(redis), job_id,
                retry_count=self.request.retries,
            )
        except RefreshRetryScheduled as exc:
            raise self.retry(exc=exc, countdown=exc.countdown)
    finally:
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
