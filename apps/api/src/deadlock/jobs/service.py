from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from deadlock.jobs.models import RefreshJob


COOLDOWN = timedelta(minutes=5)


def _job_from_row(row) -> RefreshJob:
    return RefreshJob(
        job_id=row.job_id, account_id=row.account_id, status=row.status, attempts=row.attempts,
        created_at=row.created_at, available_at=row.available_at, started_at=row.started_at,
        finished_at=row.finished_at, lease_expires_at=row.lease_expires_at,
        lease_token=row.lease_token, error_code=row.error_code,
        dispatched_at=getattr(row, "dispatched_at", None),
    )


def request_refresh(session, account_id: int, *, now: datetime | None = None) -> RefreshJob:
    if not 0 < account_id <= 4_294_967_295:
        raise ValueError("account_id is outside the supported range")
    now = now or datetime.now(timezone.utc)
    active = session.execute(
        select(RefreshJob.job_id, RefreshJob.account_id, RefreshJob.status, RefreshJob.attempts,
               RefreshJob.created_at, RefreshJob.available_at, RefreshJob.started_at,
               RefreshJob.finished_at, RefreshJob.lease_expires_at, RefreshJob.lease_token,
               RefreshJob.error_code, RefreshJob.dispatched_at)
        .where(RefreshJob.account_id == account_id, RefreshJob.status.in_(("queued", "running")))
        .order_by(RefreshJob.created_at.desc()).limit(1)
    ).one_or_none()
    if active is not None:
        return _job_from_row(active)

    recent = session.execute(
        select(RefreshJob.job_id, RefreshJob.account_id, RefreshJob.status, RefreshJob.attempts,
               RefreshJob.created_at, RefreshJob.available_at, RefreshJob.started_at,
               RefreshJob.finished_at, RefreshJob.lease_expires_at, RefreshJob.lease_token,
               RefreshJob.error_code, RefreshJob.dispatched_at)
        .where(RefreshJob.account_id == account_id, RefreshJob.status == "succeeded",
               RefreshJob.finished_at > now - COOLDOWN)
        .order_by(RefreshJob.finished_at.desc()).limit(1)
    ).one_or_none()
    if recent is not None:
        return _job_from_row(recent)

    job_id = uuid4()
    statement = insert(RefreshJob).values(
        job_id=job_id, account_id=account_id, status="queued", attempts=0,
        created_at=now, available_at=now,
    ).on_conflict_do_nothing(
        index_elements=[RefreshJob.account_id],
        index_where=text("status IN ('queued','running')"),
    ).returning(RefreshJob.job_id)
    created = session.execute(statement).scalar_one_or_none()
    if created is not None:
        return RefreshJob(job_id=created, account_id=account_id, status="queued", attempts=0,
                          created_at=now, available_at=now)

    active = session.execute(
        select(RefreshJob.job_id, RefreshJob.account_id, RefreshJob.status, RefreshJob.attempts,
               RefreshJob.created_at, RefreshJob.available_at, RefreshJob.started_at,
               RefreshJob.finished_at, RefreshJob.lease_expires_at, RefreshJob.lease_token,
               RefreshJob.error_code, RefreshJob.dispatched_at)
        .where(RefreshJob.account_id == account_id, RefreshJob.status.in_(("queued", "running")))
        .order_by(RefreshJob.created_at.desc()).limit(1)
    ).one()
    return _job_from_row(active)
