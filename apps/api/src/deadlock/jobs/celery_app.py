import os

from celery import Celery


broker_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
celery_app = Celery("deadlock", broker=broker_url, backend=broker_url, include=["deadlock.jobs.tasks"])
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "dispatch-saved-refresh-jobs": {
            "task": "deadlock.dispatch_queued_refreshes",
            "schedule": 10.0,
        },
        "refresh-hero-analytics-hourly": {
            "task": "deadlock.refresh_hero_analytics",
            "schedule": 3600.0,
        },
        "refresh-hero-catalog-daily": {
            "task": "deadlock.refresh_hero_catalog",
            "schedule": 86400.0,
        },
    },
)
