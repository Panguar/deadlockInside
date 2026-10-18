from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from deadlock.core.errors import error_response
from deadlock.core.rate_limit import enforce_rate_limit
from deadlock.heroes.models import Hero
from deadlock.heroes.schemas import HeroDetailOut, HeroGlobalStatsOut, HeroOut
from deadlock.heroes.service import (
    ANALYTICS_TTL, CATALOG_TTL, analytics_filters, default_analytics_period,
    get_snapshot, latest_catalog_snapshot, validate_analytics_period,
)
from deadlock.players.schemas import ApiMeta, Envelope, ErrorEnvelope


router = APIRouter(prefix="/heroes", tags=["heroes"])


def _hero_id(value: str) -> int:
    if not value.isdecimal():
        raise ValueError
    hero_id = int(value)
    if not 0 < hero_id <= 9_223_372_036_854_775_807:
        raise ValueError
    return hero_id


def _is_stale(updated_at, ttl) -> bool:
    return updated_at is None or datetime.now(timezone.utc) - updated_at > ttl


def _snapshot_rows(session, snapshot):
    catalog = latest_catalog_snapshot(session)
    catalog_ids = catalog.hero_ids if catalog else []
    heroes = {hero.hero_id: hero for hero in session.execute(select(Hero).where(
        Hero.hero_id.in_(catalog_ids),
    )).scalars()} if catalog_ids else {}
    result = []
    for row in snapshot.data:
        hero = heroes.get(int(row["hero_id"]))
        result.append(HeroGlobalStatsOut(
            **row, name=hero.name if hero else None, class_name=hero.class_name if hero else None,
        ))
    result.sort(key=lambda row: (row.matches is not None, row.matches or -1, -int(row.hero_id)), reverse=True)
    return result


@router.get("/stats", response_model=Envelope[list[HeroGlobalStatsOut]], responses={
    422: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def read_hero_stats(
    request: Request,
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    min_average_badge: int | None = Query(default=None, ge=0, le=65_535),
    max_average_badge: int | None = Query(default=None, ge=0, le=65_535),
):
    limited = enforce_rate_limit(request, bucket="hero-stats", limit=30, window_seconds=60)
    if limited is not None:
        return limited
    if (from_ is not None and from_.tzinfo is None) or (to is not None and to.tzinfo is None):
        return error_response(request, 422, "validation_error", "Time filters must include a UTC offset")
    try:
        start, end = validate_analytics_period(from_, to)
    except (ValueError, OverflowError, OSError):
        return error_response(request, 422, "validation_error", "Global analytics requires an hour-aligned period of at most 31 days")
    if min_average_badge is not None and max_average_badge is not None and min_average_badge > max_average_badge:
        return error_response(request, 422, "validation_error", "Minimum average badge cannot exceed maximum")
    filters = analytics_filters(start, end, min_average_badge=min_average_badge,
                                max_average_badge=max_average_badge)
    with request.app.state.session_factory() as session:
        snapshot = get_snapshot(session, filters)
        stale = snapshot is None or _is_stale(snapshot.fetched_at, ANALYTICS_TTL)
        if snapshot is not None:
            data = _snapshot_rows(session, snapshot)
    if stale:
        try:
            from deadlock.jobs.tasks import dispatch_hero_analytics_refresh, refresh_hero_analytics_task

            dispatch_hero_analytics_refresh(
                request.app.state.redis, filters,
                lambda **kwargs: refresh_hero_analytics_task.apply_async(**kwargs),
            )
        except Exception:
            if snapshot is None:
                return error_response(request, 503, "analytics_snapshot_unavailable", "Hero analytics is not available yet")
    if snapshot is None:
        return error_response(request, 503, "analytics_snapshot_unavailable", "Hero analytics refresh has been queued")
    return {"data": data, "meta": ApiMeta(
        source=snapshot.source, updated_at=snapshot.fetched_at, sample_size=snapshot.sample_size,
        coverage="unknown", stale=stale,
    )}


@router.get("", response_model=Envelope[list[HeroOut]], responses={
    503: {"model": ErrorEnvelope},
})
def read_heroes(request: Request):
    with request.app.state.session_factory() as session:
        catalog = latest_catalog_snapshot(session)
        if catalog is None:
            return error_response(request, 503, "hero_catalog_unavailable", "Hero catalog is not available yet")
        heroes = session.execute(select(Hero).where(Hero.hero_id.in_(catalog.hero_ids)).order_by(Hero.hero_id)).scalars().all() if catalog.hero_ids else []
    if catalog is None:
        return error_response(request, 503, "hero_catalog_unavailable", "Hero catalog is not available yet")
    data = [HeroOut(hero_id=str(hero.hero_id), name=hero.name, class_name=hero.class_name,
                    client_version=hero.client_version) for hero in heroes]
    return {"data": data, "meta": ApiMeta(
        source=catalog.source, updated_at=catalog.fetched_at, sample_size=catalog.sample_size, coverage="unknown",
        stale=_is_stale(catalog.fetched_at, CATALOG_TTL),
    )}


@router.get("/{hero_id}", response_model=Envelope[HeroDetailOut], responses={
    404: {"model": ErrorEnvelope}, 422: {"model": ErrorEnvelope}, 503: {"model": ErrorEnvelope},
})
def read_hero(request: Request, hero_id: str):
    try:
        normalized = _hero_id(hero_id)
    except ValueError:
        return error_response(request, 422, "validation_error", "Hero identifier is invalid")
    start, end = default_analytics_period()
    filters = analytics_filters(start, end)
    with request.app.state.session_factory() as session:
        catalog = latest_catalog_snapshot(session)
        catalog_updated_at = catalog.fetched_at if catalog else None
        member = catalog is not None and normalized in catalog.hero_ids
        hero = session.get(Hero, normalized) if member else None
        snapshot = get_snapshot(session, filters) if hero else None
        snapshot_rows = {int(row["hero_id"]): row for row in snapshot.data} if snapshot else {}
    catalog_stale = _is_stale(catalog_updated_at, CATALOG_TTL)
    if catalog is None:
        return error_response(request, 503, "hero_catalog_unavailable", "Hero catalog is not available yet")
    if hero is None:
        if catalog_stale:
            return error_response(request, 503, "hero_catalog_stale", "Hero catalog may be out of date")
        return error_response(request, 404, "hero_not_found", "Hero was not found")
    stats = None
    if snapshot and normalized in snapshot_rows:
        stats = HeroGlobalStatsOut(
            **snapshot_rows[normalized], name=hero.name, class_name=hero.class_name,
        )
    updated_at = snapshot.fetched_at if snapshot else catalog_updated_at
    return {"data": HeroDetailOut(
        hero_id=str(hero.hero_id), name=hero.name, class_name=hero.class_name,
        client_version=hero.client_version, stats=stats,
    ), "meta": ApiMeta(
        source=snapshot.source if snapshot else "deadlock-api", updated_at=updated_at,
        sample_size=snapshot.sample_size if snapshot else 0, coverage="unknown",
        stale=catalog_stale or (snapshot is not None and _is_stale(snapshot.fetched_at, ANALYTICS_TTL)),
    )}
