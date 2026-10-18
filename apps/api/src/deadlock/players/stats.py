from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass

from deadlock.players.schemas import PlayerHeroStatsOut, PlayerStatsOut


@dataclass(frozen=True)
class PlayerMatchRow:
    hero_id: int
    outcome: int | None
    kills: int | None
    deaths: int | None
    assists: int | None


def _summary(rows: Sequence[PlayerMatchRow], hero_id: int | None = None):
    wins = sum(row.outcome == 1 for row in rows)
    decided = sum(row.outcome in (1, 2) for row in rows)
    complete_kda = [row for row in rows if row.kills is not None and row.deaths is not None and row.assists is not None]
    kda = None
    if complete_kda:
        kills_assists = sum(row.kills + row.assists for row in complete_kda)
        deaths = sum(row.deaths for row in complete_kda)
        kda = kills_assists / max(deaths, 1)
    return {
        "hero_id": str(hero_id) if hero_id is not None else None,
        "sample_size": len(rows),
        "decided_matches": decided,
        "wins": wins,
        "win_rate": wins / decided if decided else None,
        "kda": kda,
        "kda_sample_size": len(complete_kda),
    }


def calculate_player_stats(rows: Sequence[PlayerMatchRow]) -> PlayerStatsOut:
    grouped = defaultdict(list)
    for row in rows:
        grouped[row.hero_id].append(row)
    summary = _summary(rows)
    return PlayerStatsOut(
        **summary,
        heroes=[PlayerHeroStatsOut(**_summary(group, hero_id)) for hero_id, group in sorted(grouped.items())],
    )
