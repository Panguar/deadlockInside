from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from deadlock.jobs.models import RefreshJob


COOLDOWN = timedelta(minutes=5)


def _job_from_row(row) -> RefreshJob:
    job = RefreshJob(
        job_id=row.job_id, account_id=row.account_id, status=row.status, attempts=row.attempts,
        created_at=row.created_at, available_at=row.available_at, started_at=row.started_at,
        finished_at=row.finished_at, lease_expires_at=row.lease_expires_at,
        lease_token=row.lease_token, error_code=row.error_code,
        dispatched_at=getattr(row, "dispatched_at", None),
    )
    job.reused = True
    return job


def request_refresh(session, account_id: int, *, now: datetime | None = None) -> RefreshJob:
    if not 0 < account_id <= 4_294_967_295:
        raise ValueError("account_id is outside the supported range")
    now = now or datetime.now(timezone.utc)
    active = session.execute(
        select(RefreshJob.job_id, RefreshJob.account_id, RefreshJob.status, RefreshJob.attempts,
               RefreshJob.created_at, RefreshJob.available_at, RefreshJob.started_at,
               RefreshJob.finished_at, RefreshJob.lease_expires_at, RefreshJob.lease_token,
               RefreshJob.error_code, RefreshJob.dispatched_at)
        .where(RefreshJob.account_id == account_id, RefreshJob.target_match_id.is_(None), RefreshJob.status.in_(("queued", "running")))
        .order_by(RefreshJob.created_at.desc()).limit(1)
    ).one_or_none()
    if active is not None:
        return _job_from_row(active)

    recent = session.execute(
        select(RefreshJob.job_id, RefreshJob.account_id, RefreshJob.status, RefreshJob.attempts,
               RefreshJob.created_at, RefreshJob.available_at, RefreshJob.started_at,
               RefreshJob.finished_at, RefreshJob.lease_expires_at, RefreshJob.lease_token,
               RefreshJob.error_code, RefreshJob.dispatched_at)
        .where(RefreshJob.account_id == account_id, RefreshJob.target_match_id.is_(None), RefreshJob.status == "succeeded",
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
        index_where=text("status IN ('queued','running') AND target_match_id IS NULL"),
    ).returning(RefreshJob.job_id)
    created = session.execute(statement).scalar_one_or_none()
    if created is not None:
        job = RefreshJob(job_id=created, account_id=account_id, status="queued", attempts=0,
                         created_at=now, available_at=now)
        job.reused = False
        return job

    active = session.execute(
        select(RefreshJob.job_id, RefreshJob.account_id, RefreshJob.status, RefreshJob.attempts,
               RefreshJob.created_at, RefreshJob.available_at, RefreshJob.started_at,
               RefreshJob.finished_at, RefreshJob.lease_expires_at, RefreshJob.lease_token,
               RefreshJob.error_code, RefreshJob.dispatched_at)
        .where(RefreshJob.account_id == account_id, RefreshJob.status.in_(("queued", "running")))
        .order_by(RefreshJob.created_at.desc()).limit(1)
    ).one()
    return _job_from_row(active)


def request_match_refresh(session, match_id: int, *, now: datetime | None = None) -> RefreshJob:
    from deadlock.matches.models import Match, MatchPlayer

    now = now or datetime.now(timezone.utc)
    session.execute(select(Match.match_id).where(Match.match_id == match_id).with_for_update()).scalar_one()
    account_id = session.execute(select(MatchPlayer.account_id).where(
        MatchPlayer.match_id == match_id,
    ).order_by(MatchPlayer.account_id).limit(1)).scalar_one_or_none()
    if account_id is None:
        raise ValueError("known match has no saved participant")

    def find(statuses, finished_after=None):
        query = select(RefreshJob.job_id, RefreshJob.account_id, RefreshJob.status, RefreshJob.attempts,
                       RefreshJob.created_at, RefreshJob.available_at, RefreshJob.started_at,
                       RefreshJob.finished_at, RefreshJob.lease_expires_at, RefreshJob.lease_token,
                       RefreshJob.error_code, RefreshJob.dispatched_at).where(
                           RefreshJob.target_match_id == match_id, RefreshJob.status.in_(statuses))
        if finished_after is not None:
            query = query.where(RefreshJob.finished_at > finished_after)
        return session.execute(query.order_by(RefreshJob.created_at.desc()).limit(1)).one_or_none()

    existing = find(("queued", "running")) or find(("succeeded", "failed"), now - COOLDOWN)
    if existing is not None:
        return _job_from_row(existing)
    created = session.execute(insert(RefreshJob).values(
        job_id=uuid4(), account_id=account_id, target_match_id=match_id,
        status="queued", attempts=0, created_at=now, available_at=now,
    ).on_conflict_do_nothing(
        index_elements=[RefreshJob.target_match_id],
        index_where=text("status IN ('queued','running') AND target_match_id IS NOT NULL"),
    ).returning(RefreshJob.job_id)).scalar_one_or_none()
    if created is None:
        existing = find(("queued", "running"))
        if existing is not None:
            return _job_from_row(existing)
        return request_match_refresh(session, match_id, now=now)
    job = RefreshJob(job_id=created, account_id=account_id, target_match_id=match_id,
                     status="queued", attempts=0, created_at=now, available_at=now)
    job.reused = False
    return job
