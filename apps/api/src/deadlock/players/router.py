from hashlib import sha256
from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert

from deadlock.core.errors import error_response
from deadlock.core.rate_limit import enforce_rate_limit
from deadlock.jobs.service import request_refresh
from deadlock.matches.models import Match, MatchPlayer
from deadlock.players.models import Player
from deadlock.players.schemas import ApiMeta, Envelope, PlayerCandidateOut, PlayerOut, RefreshAccepted
from deadlock.players.schemas import ErrorEnvelope
from deadlock.matches.schemas import MatchHistoryItem
from deadlock.players.service import get_player
from deadlock.providers.deadlock_api import ProviderBadResponse, ProviderNotFound, ProviderUnavailable
from deadlock.providers.limiter import RateLimitDeferred, RateLimitUnavailable
from deadlock.providers.schemas import normalize_account_id


router = APIRouter(prefix="/players", tags=["players"])


def _account_id(value: str) -> int:
    try:
        account_id = normalize_account_id(value)
        if not 0 < account_id <= 4_294_967_295:
            raise ValueError
        return account_id
    except (ValueError, TypeError, OverflowError):
        raise ValueError("invalid account identifier") from None


def _limited(request: Request, bucket: str, limit: int):
    return enforce_rate_limit(request, bucket=bucket, limit=limit, window_seconds=60)


def _candidate(row):
    return {"account_id": str(row.account_id), "personaname": row.personaname,
            "avatar_url": row.avatar_url}


@router.get("/search", response_model=Envelope[list[PlayerCandidateOut]], responses={
    422: {"model": ErrorEnvelope}, 429: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def search_players(request: Request, q: str = Query(..., min_length=1, max_length=200)):
    limited = _limited(request, "search", 30)
    if limited:
        return limited
    query = q.strip()
    if not 2 <= len(query) <= 100:
        return error_response(request, 422, "validation_error", "Search text must contain 2 to 100 characters")
    lowered = query.lower()
    if "://" in lowered or "/" in query or "\\" in query:
        return error_response(request, 422, "validation_error", "Profile URLs are not supported")

    digest = sha256(query.casefold().encode("utf-8")).hexdigest()
    cache_key = f"api:search:{digest}"
    try:
        cached = request.app.state.redis.get(cache_key)
    except Exception:
        cached = None
    cached_rows = None
    cached_updated_at = None
    if cached is not None:
        import json
        try:
            cached_value = json.loads(cached)
            if isinstance(cached_value, dict):
                cached_rows = cached_value.get("data")
                cached_updated_at = datetime.fromisoformat(cached_value["updated_at"]) if cached_value.get("updated_at") else None
            else:
                cached_rows = cached_value
        except (ValueError, TypeError, KeyError):
            cached_rows = None
    try:
        parsed_id = _account_id(query) if query.isdecimal() else None
        if parsed_id is not None:
            player = request.app.state.provider.fetch_player(parsed_id)
            candidates = [player]
        else:
            candidates = request.app.state.provider.search_players(query)[:20]
    except ProviderNotFound:
        candidates = []
    except (ProviderUnavailable, ProviderBadResponse, RateLimitDeferred, RateLimitUnavailable, OSError):
        if cached is not None:
            if cached_rows is not None:
                return {"data": cached_rows, "meta": ApiMeta(source="cache", updated_at=cached_updated_at,
                                                                sample_size=len(cached_rows), stale=True)}
        return error_response(request, 503, "provider_unavailable", "Player search is temporarily unavailable")
    except (ValueError, ValidationError):
        return error_response(request, 422, "validation_error", "Search identifier is invalid")

    rows = [_candidate(row) for row in candidates[:20]]
    updated_at = datetime.now(timezone.utc)
    try:
        import json
        request.app.state.redis.set(cache_key, json.dumps({"data": rows, "updated_at": updated_at.isoformat()},
                                                           separators=(",", ":")), ex=300)
    except Exception:
        pass
    return {"data": rows, "meta": ApiMeta(source="deadlock-api", updated_at=updated_at,
                                           sample_size=len(rows), coverage="unknown")}


@router.get("/{account_id}", response_model=Envelope[PlayerOut], responses={
    404: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def read_player(request: Request, account_id: str):
    try:
        normalized = _account_id(account_id)
    except ValueError:
        return error_response(request, 422, "validation_error", "Player identifier is invalid")
    with request.app.state.session_factory() as session:
        result = get_player(session, normalized)
    if result is None:
        return error_response(request, 404, "player_not_found", "Player profile was not found")
    player, sample_size, updated_at = result
    data = {
        "account_id": str(player.account_id), "personaname": player.personaname,
        "avatar_url": player.avatar_url, "rank_badge": player.rank_badge,
        "profile_updated_at": player.profile_updated_at,
    }
    return {"data": data, "meta": ApiMeta(source="database", updated_at=updated_at, sample_size=sample_size,
                                            coverage=player.history_coverage or "unknown", stale=player.history_stale)}


@router.get("/{account_id}/matches", response_model=Envelope[list[MatchHistoryItem]], responses={
    404: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def read_player_matches(
    request: Request,
    account_id: str,
    cursor: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    hero_id: int | None = Query(default=None, gt=0, le=9_223_372_036_854_775_807),
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
):
    try:
        normalized = _account_id(account_id)
    except ValueError:
        return error_response(request, 422, "validation_error", "Player identifier is invalid")
    if from_ is not None and from_.tzinfo is None or to is not None and to.tzinfo is None:
        return error_response(request, 422, "validation_error", "Time filters must include a UTC offset")
    try:
        from_ = from_.astimezone(timezone.utc) if from_ else None
        to = to.astimezone(timezone.utc) if to else None
    except (OverflowError, ValueError):
        return error_response(request, 422, "validation_error", "Time filters are outside the supported range")
    if from_ and to and from_ >= to:
        return error_response(request, 422, "validation_error", "The from filter must be earlier than to")

    fingerprint = f"{normalized}|{hero_id or ''}|{from_.isoformat() if from_ else ''}|{to.isoformat() if to else ''}"
    binding = sha256(fingerprint.encode()).hexdigest()[:16]
    after = None
    if cursor:
        import base64, json
        try:
            payload = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            after = datetime.fromisoformat(payload["started_at"]), int(payload["match_id"])
            if (payload.get("filter") != binding or after[0].tzinfo is None
                    or not 0 < after[1] <= 9_223_372_036_854_775_807):
                raise ValueError
            after = after[0].astimezone(timezone.utc), after[1]
        except (ValueError, TypeError, KeyError, json.JSONDecodeError, OverflowError):
            return error_response(request, 422, "invalid_cursor", "History cursor is invalid for these filters")

    with request.app.state.session_factory() as session:
        player = session.get(Player, normalized)
        if player is None:
            return error_response(request, 404, "player_not_found", "Player profile was not found")
        filters = [MatchPlayer.account_id == normalized]
        if hero_id is not None:
            filters.append(MatchPlayer.hero_id == hero_id)
        if from_ is not None:
            filters.append(Match.started_at >= from_)
        if to is not None:
            filters.append(Match.started_at < to)
        base_filters = list(filters)
        if after is not None:
            filters.append(or_(Match.started_at < after[0], (Match.started_at == after[0]) & (Match.match_id < after[1])))
        query = select(MatchPlayer, Match).join(Match, Match.match_id == MatchPlayer.match_id).where(*filters).order_by(
            Match.started_at.desc(), Match.match_id.desc()).limit(limit + 1)
        rows = session.execute(query).all()
        count_query = select(func.count()).select_from(MatchPlayer).join(
            Match, Match.match_id == MatchPlayer.match_id).where(*base_filters)
        sample_size = session.execute(count_query).scalar_one()

    has_more = len(rows) > limit
    rows = rows[:limit]
    data = [MatchHistoryItem(
        match_id=str(participant.match_id), started_at=match.started_at, duration_s=match.duration_s,
        hero_id=str(participant.hero_id), kills=participant.kills, deaths=participant.deaths,
        assists=participant.assists, net_worth=participant.net_worth, player_damage=participant.player_damage,
        player_match_outcome=participant.player_match_outcome, status=match.status,
    ).model_dump() for participant, match in rows]
    next_cursor = None
    if has_more and rows:
        import base64, json
        tail = rows[-1][1]
        next_cursor = base64.urlsafe_b64encode(json.dumps({"started_at": tail.started_at.isoformat(),
                                                            "match_id": str(tail.match_id), "filter": binding},
                                                           separators=(",", ":")).encode()).decode().rstrip("=")
    return {"data": data, "meta": ApiMeta(source="database", updated_at=player.history_updated_at,
                                            sample_size=sample_size, coverage=player.history_coverage or "unknown",
                                            stale=player.history_stale, next_cursor=next_cursor)}


@router.post("/{account_id}/refresh", status_code=202, response_model=Envelope[RefreshAccepted], responses={
    422: {"model": ErrorEnvelope}, 429: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def refresh_player(request: Request, account_id: str):
    limited = _limited(request, "refresh", 5)
    if limited:
        return limited
    try:
        normalized = _account_id(account_id)
    except ValueError:
        return error_response(request, 422, "validation_error", "Player identifier is invalid")
    with request.app.state.session_factory.begin() as session:
        session.execute(insert(Player).values(account_id=normalized).on_conflict_do_nothing(index_elements=[Player.account_id]))
        job = request_refresh(session, normalized)
        session.flush()
        job_id = str(job.job_id)
        reused = getattr(job, "reused", False)
    return {"data": {"job_id": job_id}, "meta": ApiMeta(source="database", updated_at=datetime.now(timezone.utc),
                                                        sample_size=0, coverage="unknown", reused=reused)}
