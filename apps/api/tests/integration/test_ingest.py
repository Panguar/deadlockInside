import json
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from deadlock.matches.ingest import ingest_history_entries, ingest_match
from deadlock.providers.schemas import ProviderHistoryEntry, ProviderMatch, ProviderMatchPlayer

FIXTURE = Path(__file__).parents[1] / "fixtures" / "provider" / "match-metadata.json"


def provider_match():
    raw = json.loads(FIXTURE.read_text())["match_info"]
    return ProviderMatch(
        match_id=90001,
        started_at=datetime.fromtimestamp(raw["start_time"], timezone.utc),
        duration_s=raw["duration_s"],
        game_mode=raw["game_mode"],
        match_mode=raw["match_mode"],
        winning_team=raw["winning_team"],
        players=[ProviderMatchPlayer.from_provider(row) for row in raw["players"]],
    )


def seed(db):
    db.execute(text("INSERT INTO heroes (hero_id, name) VALUES (58, 'Hero') ON CONFLICT DO NOTHING"))
    db.execute(text("INSERT INTO heroes (hero_id, name) VALUES (86, 'Hero') ON CONFLICT DO NOTHING"))
    for account_id in range(10001, 10016):
        db.execute(text("INSERT INTO players (account_id) VALUES (:id) ON CONFLICT DO NOTHING"), {"id": account_id})


def test_repeated_match_import_upserts_without_duplicate_rows(db):
    seed(db)
    match = provider_match()

    first = ingest_match(db, match)
    second = ingest_match(db, match)

    assert first == second == 12
    assert db.execute(text("SELECT count(*) FROM matches WHERE match_id=90001")).scalar_one() == 1
    assert db.execute(text("SELECT count(*) FROM match_players WHERE match_id=90001")).scalar_one() == 12


def test_partial_match_import_preserves_previously_known_values(db):
    seed(db)
    full = provider_match()
    ingest_match(db, full)
    partial = ProviderMatch(
        match_id=90001,
        started_at=full.started_at,
        players=[ProviderMatchPlayer(account_id=10001, hero_id=58)],
        status="partial",
    )

    ingest_match(db, partial)

    assert db.execute(text("SELECT duration_s, winning_team, status FROM matches WHERE match_id=90001")).one() == (1845, 1, "complete")
    assert db.execute(text("SELECT kills, player_damage FROM match_players WHERE match_id=90001 AND account_id=10001")).one() == (1, 10955)


def test_partial_and_history_import_preserve_known_items_json(db):
    seed(db)
    full = provider_match()
    ingest_match(db, full)
    account_id = full.players[0].account_id
    known_items = full.players[0].items
    assert known_items

    ingest_match(db, ProviderMatch(
        match_id=90001, started_at=full.started_at,
        players=[ProviderMatchPlayer(account_id=account_id, hero_id=58)], status="partial",
    ))
    history = ProviderHistoryEntry(
        account_id=account_id, match_id=90001, hero_id=86, started_at=full.started_at,
    )
    ingest_history_entries(db, account_id, [history], stale=False)

    assert db.execute(text("SELECT items FROM match_players WHERE match_id=90001 AND account_id=:id"),
                      {"id": account_id}).scalar_one() == known_items


def test_bad_participant_rolls_back_match_and_all_other_participants(db):
    seed(db)
    match = provider_match()
    match.players.append(ProviderMatchPlayer.model_construct(account_id=0, hero_id=58))

    with pytest.raises(IntegrityError):
        ingest_match(db, match)

    assert db.execute(text("SELECT count(*) FROM matches WHERE match_id=90001")).scalar_one() == 0
    assert db.execute(text("SELECT count(*) FROM match_players WHERE match_id=90001")).scalar_one() == 0


def test_history_keeps_latest_hundred_and_records_partial_stale_coverage(db):
    seed(db)
    entries = [ProviderHistoryEntry(
        account_id=10001, match_id=91000 + i, hero_id=58,
        started_at=datetime.fromtimestamp(1_792_000_000 + i, timezone.utc),
        kills=i,
    ) for i in range(101)]

    count = ingest_history_entries(db, 10001, entries, stale=True)

    assert count == 100
    assert db.execute(text("SELECT min(match_id), max(match_id), count(*) FROM match_players WHERE account_id=10001 AND match_id >= 91000")).one() == (91001, 91100, 100)
    assert db.execute(text("SELECT history_coverage, history_stale FROM players WHERE account_id=10001")).one() == ("partial", True)
