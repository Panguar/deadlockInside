from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from deadlock.jobs.models import RefreshJob
from deadlock.matches.ingest import ingest_history_entries, ingest_match
from deadlock.matches.models import Match, MatchPlayer
from deadlock.players.models import Player
from deadlock.providers.deadlock_api import ProviderBadResponse, ProviderNotFound, ProviderUnavailable
from deadlock.providers.limiter import RateLimitDeferred, RateLimitUnavailable
from deadlock.providers.schemas import ProviderPlayer


RETRY_DELAYS = (5, 15, 45)
LEASE_DURATION = timedelta(minutes=15)


class RefreshRetryScheduled(RuntimeError):
    def __init__(self, countdown: float):
        self.countdown = countdown
        super().__init__("refresh retry scheduled")


def _finish_failure(session_factory, job_id, token, error, *, retry_count, attempt, now):
    retryable = isinstance(error, (ProviderUnavailable, RateLimitDeferred, RateLimitUnavailable))
    retry = retryable and retry_count < len(RETRY_DELAYS) and attempt < len(RETRY_DELAYS) + 1
    retry_after = getattr(error, "retry_after", None)
    countdown = retry_after if retry_after is not None else RETRY_DELAYS[min(retry_count, len(RETRY_DELAYS) - 1)]
    with session_factory.begin() as session:
        values = {
            "status": "queued" if retry else "failed",
            "available_at": now + timedelta(seconds=countdown) if retry else now,
            "finished_at": None if retry else now,
            "lease_expires_at": None, "lease_token": None, "dispatched_at": None,
            "error_code": type(error).__name__[:100],
        }
        session.execute(update(RefreshJob).where(
            RefreshJob.job_id == job_id, RefreshJob.status == "running", RefreshJob.lease_token == token,
        ).values(**values))
    if retry:
        raise RefreshRetryScheduled(countdown) from error


def _defer_admission(session_factory, job_id, token, error, *, attempt, now):
    countdown = getattr(error, "retry_after", None) or 5
    with session_factory.begin() as session:
        result = session.execute(update(RefreshJob).where(
            RefreshJob.job_id == job_id, RefreshJob.status == "running", RefreshJob.lease_token == token,
        ).values(
            status="queued", available_at=now + timedelta(seconds=countdown),
            attempts=max(attempt - 1, 0), lease_expires_at=None, lease_token=None,
            dispatched_at=None, error_code=type(error).__name__[:100],
        ))
    return result.rowcount == 1


def _renew_lease(session_factory, job_id, token):
    now = datetime.now(timezone.utc)
    with session_factory.begin() as session:
        result = session.execute(update(RefreshJob).where(
            RefreshJob.job_id == job_id, RefreshJob.status == "running",
            RefreshJob.lease_token == token,
        ).values(lease_expires_at=now + LEASE_DURATION))
        if result.rowcount != 1:
            raise LeaseLost("refresh lease no longer belongs to this worker")


class LeaseLost(RuntimeError):
    pass


def _store_profile(session, player: ProviderPlayer, now: datetime) -> None:
    values = {
        "account_id": player.account_id, "personaname": player.personaname or None,
        "avatar_url": player.avatar_url, "rank_badge": player.rank_badge if player.rank_badge else None,
        "profile_updated_at": player.profile_updated_at or now,
    }
    statement = insert(Player).values(**values)
    excluded = statement.excluded
    session.execute(statement.on_conflict_do_update(
        index_elements=[Player.account_id],
        set_={
            "personaname": func.coalesce(excluded.personaname, Player.personaname),
            "avatar_url": func.coalesce(excluded.avatar_url, Player.avatar_url),
            "rank_badge": func.coalesce(excluded.rank_badge, Player.rank_badge),
            "profile_updated_at": func.coalesce(excluded.profile_updated_at, Player.profile_updated_at),
        },
    ))


def run_refresh_job(session_factory, provider, cache, job_id, *, retry_count: int = 0,
                    now: datetime | None = None, clock=None) -> str:
    clock = clock or ((lambda: now) if now is not None else lambda: datetime.now(timezone.utc))
    now = now or clock()
    token = uuid4()
    with session_factory.begin() as session:
        job = session.execute(select(RefreshJob).where(RefreshJob.job_id == job_id).with_for_update()).scalar_one_or_none()
        if job is None:
            return "missing"
        if job.status in ("succeeded", "failed"):
            return job.status
        if job.status == "queued" and job.available_at > now:
            return "queued"
        if job.status == "running" and job.lease_expires_at and job.lease_expires_at > now:
            return "running"
        if job.status == "running" and job.lease_expires_at and job.lease_expires_at <= now and job.attempts >= 4:
            job.status = "failed"
            job.finished_at = now
            job.lease_expires_at = None
            job.lease_token = None
            job.error_code = "lease_expired"
            return "failed"
        if job.status == "queued" and job.attempts >= 4:
            job.status = "failed"
            job.finished_at = now
            job.error_code = "retry_budget_exhausted"
            return "failed"
        claimed = session.execute(update(RefreshJob).where(
            RefreshJob.job_id == job_id,
            ((RefreshJob.status == "queued") & (RefreshJob.available_at <= now)) |
            ((RefreshJob.status == "running") & (RefreshJob.lease_expires_at <= now) & (RefreshJob.attempts < 4)),
            RefreshJob.attempts < 4,
        ).values(
            status="running", attempts=RefreshJob.attempts + 1, started_at=now,
            finished_at=None, lease_expires_at=now + LEASE_DURATION, lease_token=token,
            dispatched_at=None,
        ).returning(RefreshJob.account_id, RefreshJob.attempts, RefreshJob.progress)).one_or_none()
        if claimed is None:
            return "running"
        account_id, attempt, progress = claimed

    try:
        if hasattr(provider, "before_request"):
            provider.before_request = lambda: _renew_lease(session_factory, job_id, token)
        if not progress.get("profile_fetched"):
            player = provider.fetch_player(account_id)
            progress = {**progress, "profile_fetched": True}
            with session_factory.begin() as session:
                owner = session.execute(select(RefreshJob.status, RefreshJob.lease_token).where(
                    RefreshJob.job_id == job_id,
                ).with_for_update()).one_or_none()
                if owner is None or owner.status != "running" or owner.lease_token != token:
                    return "superseded"
                _store_profile(session, player, clock())
                session.execute(update(RefreshJob).where(RefreshJob.job_id == job_id, RefreshJob.lease_token == token).values(progress=progress))

        if not progress.get("history_fetched"):
            history = provider.fetch_match_history(account_id)
            newest = sorted(history, key=lambda row: (row.started_at, row.match_id), reverse=True)[:100]
            match_ids = [row.match_id for row in newest]
            progress = {**progress, "history_fetched": True, "history_match_ids": match_ids}
            with session_factory.begin() as session:
                owner = session.execute(select(RefreshJob.status, RefreshJob.lease_token).where(
                    RefreshJob.job_id == job_id,
                ).with_for_update()).one_or_none()
                if owner is None or owner.status != "running" or owner.lease_token != token:
                    return "superseded"
                ingest_history_entries(session, account_id, history, stale=getattr(provider, "last_history_stale", False))
                session.execute(update(RefreshJob).where(RefreshJob.job_id == job_id, RefreshJob.lease_token == token).values(progress=progress))
        else:
            match_ids = progress.get("history_match_ids", [])

        with session_factory() as session:
            complete = set(session.execute(select(Match.match_id).where(
                Match.match_id.in_(match_ids), Match.status == "complete",
            )).scalars()) if match_ids else set()
        missing = [match_id for match_id in match_ids if match_id not in complete][:20]
        for match_id in missing:
            match = provider.fetch_match(match_id)
            with session_factory.begin() as session:
                owner = session.execute(select(RefreshJob.status, RefreshJob.lease_token).where(
                    RefreshJob.job_id == job_id,
                ).with_for_update()).one_or_none()
                if owner is None or owner.status != "running" or owner.lease_token != token:
                    return "superseded"
                ingest_match(session, match)

        with session_factory.begin() as session:
            owner = session.execute(select(RefreshJob.status, RefreshJob.lease_token).where(
                RefreshJob.job_id == job_id,
            ).with_for_update()).one_or_none()
            if owner is None or owner.status != "running" or owner.lease_token != token:
                return "superseded"
            participant_ids = set(session.execute(select(MatchPlayer.account_id).where(
                MatchPlayer.match_id.in_(match_ids),
            )).scalars()) if match_ids else set()
            session.execute(update(RefreshJob).where(
                RefreshJob.job_id == job_id, RefreshJob.lease_token == token,
            ).values(
                status="succeeded", finished_at=clock(), lease_expires_at=None,
                lease_token=None, error_code=None,
            ))
        try:
            cache.invalidate_refresh(account_id, match_ids, participant_ids)
        except Exception:
            # Cache failure must not repeat completed remote work or roll back committed data.
            pass
        return "succeeded"
    except LeaseLost:
        return "superseded"
    except (RateLimitDeferred, RateLimitUnavailable) as exc:
        _defer_admission(session_factory, job_id, token, exc, attempt=attempt, now=clock())
        return "queued"
    except (ProviderUnavailable, ProviderNotFound, ProviderBadResponse) as exc:
        _finish_failure(session_factory, job_id, token, exc, retry_count=retry_count, attempt=attempt, now=clock())
        return "failed"
    except Exception as exc:
        _finish_failure(session_factory, job_id, token, exc, retry_count=retry_count, attempt=attempt, now=clock())
        raise


def run_match_metadata_job(session_factory, provider, cache, job_id, *, retry_count: int = 0,
                           now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    token = uuid4()
    with session_factory.begin() as session:
        job = session.execute(select(RefreshJob).where(RefreshJob.job_id == job_id).with_for_update()).scalar_one_or_none()
        if job is None or job.target_match_id is None:
            return "missing"
        if job.status in ("succeeded", "failed"):
            return job.status
        if job.status == "queued" and job.available_at > now:
            return "queued"
        if job.status == "running" and job.lease_expires_at and job.lease_expires_at <= now and job.attempts >= 4:
            job.status = "failed"
            job.finished_at = now
            job.lease_expires_at = None
            job.lease_token = None
            job.error_code = "lease_expired"
            return "failed"
        if job.status == "queued" and job.attempts >= 4:
            job.status = "failed"
            job.finished_at = now
            job.error_code = "retry_budget_exhausted"
            return "failed"
        claimed = session.execute(update(RefreshJob).where(
            RefreshJob.job_id == job_id,
            ((RefreshJob.status == "queued") & (RefreshJob.available_at <= now)) |
            ((RefreshJob.status == "running") & (RefreshJob.lease_expires_at <= now)),
            RefreshJob.attempts < 4,
        ).values(status="running", attempts=RefreshJob.attempts + 1, started_at=now,
                 finished_at=None, lease_expires_at=now + LEASE_DURATION,
                 lease_token=token, dispatched_at=None).returning(
                     RefreshJob.account_id, RefreshJob.target_match_id, RefreshJob.attempts)).one_or_none()
        if claimed is None:
            return "running"
        account_id, match_id, attempt = claimed
    try:
        if hasattr(provider, "before_request"):
            provider.before_request = lambda: _renew_lease(session_factory, job_id, token)
        match = provider.fetch_match(match_id)
        with session_factory.begin() as session:
            owner = session.execute(select(RefreshJob.status, RefreshJob.lease_token).where(
                RefreshJob.job_id == job_id,
            ).with_for_update()).one_or_none()
            if owner is None or owner.status != "running" or owner.lease_token != token:
                return "superseded"
            ingest_match(session, match)
            participant_ids = set(session.execute(select(MatchPlayer.account_id).where(
                MatchPlayer.match_id == match_id,
            )).scalars())
            session.execute(update(RefreshJob).where(RefreshJob.job_id == job_id, RefreshJob.lease_token == token).values(
                status="succeeded", finished_at=now, lease_expires_at=None, lease_token=None, error_code=None,
            ))
        try:
            cache.invalidate_refresh(account_id, [match_id], participant_ids)
        except Exception:
            pass
        return "succeeded"
    except LeaseLost:
        return "superseded"
    except (RateLimitDeferred, RateLimitUnavailable) as exc:
        _defer_admission(session_factory, job_id, token, exc, attempt=attempt, now=now)
        return "queued"
    except (ProviderUnavailable, ProviderNotFound, ProviderBadResponse) as exc:
        _finish_failure(session_factory, job_id, token, exc, retry_count=retry_count, attempt=attempt, now=now)
        return "failed"
    except Exception as exc:
        _finish_failure(session_factory, job_id, token, exc, retry_count=retry_count, attempt=attempt, now=now)
        raise
