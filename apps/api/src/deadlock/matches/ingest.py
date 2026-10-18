from datetime import datetime, timezone

from sqlalchemy import case, func, null
from sqlalchemy.dialects.postgresql import insert

from deadlock.heroes.models import Hero
from deadlock.matches.models import Match, MatchPlayer
from deadlock.players.models import Player
from deadlock.providers.schemas import ProviderHistoryEntry, ProviderMatch


def _insert_match(session, match: ProviderMatch) -> None:
    statement = insert(Match).values(
        match_id=match.match_id, started_at=match.started_at, duration_s=match.duration_s,
        game_mode=match.game_mode, match_mode=match.match_mode, winning_team=match.winning_team,
        status=match.status,
        metadata_updated_at=func.now() if match.status == "complete" else None,
    )
    excluded = statement.excluded
    session.execute(statement.on_conflict_do_update(
        index_elements=[Match.match_id],
        set_={
            "started_at": func.coalesce(excluded.started_at, Match.started_at),
            "duration_s": func.coalesce(excluded.duration_s, Match.duration_s),
            "game_mode": func.coalesce(excluded.game_mode, Match.game_mode),
            "match_mode": func.coalesce(excluded.match_mode, Match.match_mode),
            "winning_team": func.coalesce(excluded.winning_team, Match.winning_team),
            "status": case((excluded.status == "complete", "complete"), else_=Match.status),
            "metadata_updated_at": func.coalesce(excluded.metadata_updated_at, Match.metadata_updated_at),
        },
    ))


def _ingest_participants(session, match_id: int, participants) -> None:
    for participant in participants:
        session.execute(insert(Player).values(account_id=participant.account_id).on_conflict_do_nothing(
            index_elements=[Player.account_id],
        ))
        session.execute(insert(Hero).values(hero_id=participant.hero_id, name=f"Hero {participant.hero_id}").on_conflict_do_nothing(
            index_elements=[Hero.hero_id],
        ))
        statement = insert(MatchPlayer).values(
            match_id=match_id, account_id=participant.account_id, hero_id=participant.hero_id,
            team=participant.team, kills=participant.kills, deaths=participant.deaths,
            assists=participant.assists, net_worth=participant.net_worth,
            player_damage=participant.player_damage,
            player_match_outcome=participant.player_match_outcome,
            # SQL NULL lets COALESCE preserve previously known JSONB purchases.
            items=participant.items if participant.items is not None else null(),
            stats_at_seconds=participant.stats_at_seconds,
        )
        excluded = statement.excluded
        session.execute(statement.on_conflict_do_update(
            index_elements=[MatchPlayer.match_id, MatchPlayer.account_id],
            set_={column: func.coalesce(excluded[column], MatchPlayer.__table__.c[column])
                  for column in ("hero_id", "team", "kills", "deaths", "assists", "net_worth",
                                 "player_damage", "player_match_outcome", "items", "stats_at_seconds")},
        ))


def ingest_match(session, match: ProviderMatch) -> int:
    """Upsert match data atomically inside a savepoint owned by this import."""
    with session.begin_nested():
        _insert_match(session, match)
        _ingest_participants(session, match.match_id, match.players)
    return len(match.players)


def ingest_history_entries(session, account_id: int, entries: list[ProviderHistoryEntry], *, stale: bool) -> int:
    ordered = sorted(entries, key=lambda row: (row.started_at, row.match_id), reverse=True)
    retained = ordered[:100]
    with session.begin_nested():
        for row in retained:
            partial = ProviderMatch(
                match_id=row.match_id, started_at=row.started_at, duration_s=row.duration_s,
                game_mode=row.game_mode, match_mode=row.match_mode, status="partial",
                players=[{
                    "account_id": account_id, "hero_id": row.hero_id, "team": row.team,
                    "kills": row.kills, "deaths": row.deaths, "assists": row.assists,
                    "net_worth": row.net_worth, "player_match_outcome": row.player_match_outcome,
                }],
            )
            _insert_match(session, partial)
            _ingest_participants(session, row.match_id, partial.players)
        session.execute(
            Player.__table__.update().where(Player.account_id == account_id).values(
                history_updated_at=datetime.now(timezone.utc),
                history_coverage="partial" if len(ordered) > 100 else "unknown",
                history_stale=stale,
            )
        )
    return len(retained)
