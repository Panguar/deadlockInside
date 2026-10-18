from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from deadlock.jobs.models import RefreshJob


def recover_expired_jobs(session, *, now: datetime | None = None) -> int:
    now = now or datetime.now(timezone.utc)
    result = session.execute(
        update(RefreshJob).where(
            RefreshJob.status == "running", RefreshJob.lease_expires_at <= now,
            RefreshJob.attempts < 4,
        ).values(
            status="queued", lease_token=None, lease_expires_at=None, available_at=now,
            dispatched_at=None,
        )
    )
    recovered = result.rowcount or 0
    failed = session.execute(update(RefreshJob).where(
        RefreshJob.status == "running", RefreshJob.lease_expires_at <= now,
        RefreshJob.attempts >= 4,
    ).values(
        status="failed", lease_token=None, lease_expires_at=None, finished_at=now,
        error_code="lease_expired",
    ))
    return recovered + (failed.rowcount or 0)


def dispatch_queued_jobs(session, enqueue, *, now: datetime | None = None, limit: int = 100) -> int:
    now = now or datetime.now(timezone.utc)
    recover_expired_jobs(session, now=now)
    rows = session.execute(
        select(RefreshJob.job_id).where(
            RefreshJob.status == "queued", RefreshJob.available_at <= now,
            (RefreshJob.dispatched_at.is_(None)) | (RefreshJob.dispatched_at <= now - timedelta(minutes=1)),
        ).order_by(RefreshJob.created_at).limit(limit).with_for_update(skip_locked=True)
    ).scalars().all()
    dispatched = 0
    for job_id in rows:
        enqueue(str(job_id))
        session.execute(update(RefreshJob).where(
            RefreshJob.job_id == job_id, RefreshJob.status == "queued",
        ).values(dispatched_at=now))
        dispatched += 1
    return dispatched
