from collections import defaultdict
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from deadlock.heroes.models import Hero, HeroAnalyticsSnapshot, HeroCatalogSnapshot
from deadlock.providers.schemas import ProviderHeroStats


CATALOG_TTL = timedelta(hours=24)
ANALYTICS_TTL = timedelta(hours=1)
ANALYTICS_MAX_PERIOD = timedelta(days=31)


def default_analytics_period(now: datetime | None = None) -> tuple[datetime, datetime]:
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    end = current.replace(hour=0, minute=0, second=0, microsecond=0)
    return end - timedelta(days=30), end


def analytics_filter_key(filters: dict, *, prefix: str = "") -> str:
    canonical = json.dumps(filters, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return prefix + sha256(canonical.encode("utf-8")).hexdigest()[:64 - len(prefix)]


def analytics_filters(
    start: datetime, end: datetime, *, min_average_badge: int | None = None,
    max_average_badge: int | None = None,
) -> dict:
    bucket = "start_time_day" if start.hour == end.hour == 0 else "start_time_hour"
    filters = {"from": start.isoformat(), "to": end.isoformat(), "bucket": bucket}
    if min_average_badge is not None:
        filters["min_average_badge"] = min_average_badge
    if max_average_badge is not None:
        filters["max_average_badge"] = max_average_badge
    return filters


def validate_analytics_period(start: datetime | None, end: datetime | None, *, now: datetime | None = None):
    if start is None and end is None:
        return default_analytics_period(now)
    if start is None or end is None:
        raise ValueError("both from and to are required")
    try:
        start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    except (OverflowError, OSError, ValueError) as exc:
        raise ValueError("global analytics period is outside the supported range") from exc
    if any((value.minute, value.second, value.microsecond) != (0, 0, 0) for value in (start, end)):
        raise ValueError("global analytics boundaries must align to a UTC hour")
    if start >= end or end - start > ANALYTICS_MAX_PERIOD:
        raise ValueError("global analytics period must be positive and no longer than 31 days")
    return start, end


def latest_catalog_update(session):
    snapshot = latest_catalog_snapshot(session)
    return snapshot.fetched_at if snapshot else None


def latest_catalog_snapshot(session):
    return session.execute(select(HeroCatalogSnapshot).order_by(
        HeroCatalogSnapshot.fetched_at.desc(), HeroCatalogSnapshot.id.desc(),
    ).limit(1)).scalar_one_or_none()


def refresh_hero_catalog(session_factory, provider):
    heroes = provider.fetch_heroes()
    now = datetime.now(timezone.utc)
    with session_factory.begin() as session:
        for hero in heroes:
            statement = insert(Hero).values(
                hero_id=hero.hero_id, name=hero.name, class_name=hero.class_name,
                client_version=hero.client_version, updated_at=now,
            )
            excluded = statement.excluded
            session.execute(statement.on_conflict_do_update(
                index_elements=[Hero.hero_id],
                set_={"name": excluded.name, "class_name": excluded.class_name,
                      "client_version": excluded.client_version, "updated_at": now},
            ))
        session.add(HeroCatalogSnapshot(source="deadlock-api", sample_size=len(heroes),
                                        hero_ids=[hero.hero_id for hero in heroes]))
    return len(heroes)


def _sum_known(rows, field):
    values = [getattr(row, field) for row in rows]
    return sum(values) if values and all(value is not None for value in values) else None


def aggregate_hero_buckets(rows: list[ProviderHeroStats], *, start: datetime, end: datetime) -> list[dict]:
    start_epoch, end_epoch = int(start.timestamp()), int(end.timestamp())
    in_period = [row for row in rows if row.bucket is not None and start_epoch <= row.bucket < end_epoch]
    grouped = defaultdict(list)
    for row in in_period:
        grouped[row.hero_id].append(row)
    result = []
    for hero_id, hero_rows in sorted(grouped.items()):
        wins = _sum_known(hero_rows, "wins")
        losses = _sum_known(hero_rows, "losses")
        matches = _sum_known(hero_rows, "matches")
        kda_rows = [row for row in hero_rows if row.matches is not None and row.total_kills is not None
                    and row.total_deaths is not None and row.total_assists is not None]
        kills = sum(row.total_kills for row in kda_rows) if kda_rows else None
        deaths = sum(row.total_deaths for row in kda_rows) if kda_rows else None
        assists = sum(row.total_assists for row in kda_rows) if kda_rows else None
        decided = wins + losses if wins is not None and losses is not None else None
        result.append({
            "hero_id": str(hero_id), "matches": matches, "wins": wins, "losses": losses,
            "win_rate": wins / decided if decided else None,
            "kda": (kills + assists) / max(deaths, 1) if kills is not None and assists is not None and deaths is not None else None,
            "kda_sample_size": sum(row.matches for row in kda_rows),
        })
    return result


def parse_analytics_filters(filters: dict) -> tuple[datetime, datetime, int | None, int | None]:
    if not isinstance(filters, dict) or set(filters) - {
        "from", "to", "bucket", "min_average_badge", "max_average_badge",
    }:
        raise ValueError("analytics filters are invalid")
    try:
        start = datetime.fromisoformat(filters["from"])
        end = datetime.fromisoformat(filters["to"])
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        raise ValueError("analytics filters are invalid") from exc
    if start.tzinfo is None or end.tzinfo is None:
        raise ValueError("analytics filters must include timezone offsets")
    start, end = validate_analytics_period(start, end)
    minimum = filters.get("min_average_badge")
    maximum = filters.get("max_average_badge")
    for value in (minimum, maximum):
        if value is not None and (type(value) is not int or not 0 <= value <= 65_535):
            raise ValueError("average badge filters must be between 0 and 65535")
    if minimum is not None and maximum is not None and minimum > maximum:
        raise ValueError("minimum average badge cannot exceed maximum")
    if analytics_filters(start, end, min_average_badge=minimum,
                         max_average_badge=maximum) != filters:
        raise ValueError("analytics filters are not canonical")
    return start, end, minimum, maximum


def refresh_hero_analytics(
    session_factory, provider, *, start: datetime | None = None, end: datetime | None = None,
    min_average_badge: int | None = None, max_average_badge: int | None = None,
):
    start, end = validate_analytics_period(start, end)
    filters = analytics_filters(start, end, min_average_badge=min_average_badge,
                                 max_average_badge=max_average_badge)
    bucket = filters["bucket"]
    provider_filters = {key: filters[key] for key in ("min_average_badge", "max_average_badge") if key in filters}
    raw = provider.fetch_hero_stats(
        start_timestamp=int(start.timestamp()), end_timestamp=int(end.timestamp()), bucket=bucket,
        **provider_filters,
    )
    aggregates = aggregate_hero_buckets(raw, start=start, end=end)
    filter_key = analytics_filter_key(filters)
    with session_factory.begin() as session:
        snapshot = HeroAnalyticsSnapshot(
            filter_key=filter_key, filters=filters, data=aggregates, source="deadlock-api",
            sample_size=sum(
                row.matches or 0 for row in raw
                if row.bucket is not None and int(start.timestamp()) <= row.bucket < int(end.timestamp())
            ),
            period_start=start, period_end=end,
        )
        session.add(snapshot)
        session.flush()
        fetched_at = snapshot.fetched_at
    return {"filter_key": filter_key, "sample_size": snapshot.sample_size, "fetched_at": fetched_at}


def get_snapshot(session, filters: dict):
    key = analytics_filter_key(filters)
    return session.execute(select(HeroAnalyticsSnapshot).where(
        HeroAnalyticsSnapshot.filter_key == key,
    ).order_by(HeroAnalyticsSnapshot.fetched_at.desc()).limit(1)).scalar_one_or_none()
