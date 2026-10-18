from datetime import datetime, timezone

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError


def seed(db):
    db.execute(text("INSERT INTO players (account_id) VALUES (10001)"))
    db.execute(text("INSERT INTO heroes (hero_id, name) VALUES (1, 'Hero')"))
    db.execute(text("INSERT INTO matches (match_id, started_at) VALUES (90001, '2026-10-18T10:00:00Z')"))


def test_all_foundation_tables_exist(migrated_engine):
    expected = {"players", "heroes", "matches", "match_players", "rank_snapshots", "hero_stats_snapshots", "refresh_jobs"}
    assert expected <= set(inspect(migrated_engine).get_table_names())


@pytest.mark.parametrize("statement", [
    "INSERT INTO players (account_id) VALUES (10001)",
    "INSERT INTO matches (match_id, started_at) VALUES (90001, now())",
    "INSERT INTO match_players (match_id, account_id, hero_id) VALUES (90001, 10001, 1)",
])
def test_duplicate_identities_rejected(db, statement):
    seed(db)
    db.execute(text("INSERT INTO match_players (match_id, account_id, hero_id) VALUES (90001,10001,1)"))
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text(statement))


def test_unknown_rank_and_damage_remain_null(db):
    seed(db)
    db.execute(text("INSERT INTO match_players (match_id,account_id,hero_id) VALUES (90001,10001,1)"))
    assert db.execute(text("SELECT rank_badge FROM players WHERE account_id=10001")).scalar_one() is None
    assert db.execute(text("SELECT player_damage FROM match_players")).scalar_one() is None
    started_at = db.execute(text("SELECT started_at FROM matches")).scalar_one()
    assert started_at == datetime(2026, 10, 18, 10, tzinfo=timezone.utc)
    assert started_at.tzinfo is not None


def test_bad_participant_rolls_back_entire_match(db):
    db.execute(text("INSERT INTO players (account_id) VALUES (10001)"))
    db.execute(text("INSERT INTO heroes (hero_id,name) VALUES (1,'Hero')"))
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text("INSERT INTO matches (match_id, started_at) VALUES (90002,now())"))
        db.execute(text("INSERT INTO match_players (match_id,account_id,hero_id) VALUES (90002,10001,1)"))
        db.execute(text("INSERT INTO match_players (match_id,account_id,hero_id) VALUES (90002,99999,1)"))
    assert db.execute(text("SELECT count(*) FROM matches WHERE match_id=90002")).scalar_one() == 0
    assert db.execute(text("SELECT count(*) FROM match_players WHERE match_id=90002")).scalar_one() == 0


def test_invalid_stats_and_job_states_rejected(db):
    seed(db)
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text("INSERT INTO match_players (match_id,account_id,hero_id,kills) VALUES (90001,10001,1,-1)"))
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text("INSERT INTO refresh_jobs (job_id,account_id,status) VALUES ('00000000-0000-0000-0000-000000000001',10001,'unknown')"))


def test_only_one_active_refresh_per_player(db):
    seed(db)
    db.execute(text("INSERT INTO refresh_jobs (job_id,account_id,status) VALUES ('00000000-0000-0000-0000-000000000001',10001,'queued')"))
    with pytest.raises(IntegrityError), db.begin_nested():
        db.execute(text("INSERT INTO refresh_jobs (job_id,account_id,status) VALUES ('00000000-0000-0000-0000-000000000002',10001,'running')"))
    db.execute(text("UPDATE refresh_jobs SET status='succeeded'"))
    db.execute(text("INSERT INTO refresh_jobs (job_id,account_id,status) VALUES ('00000000-0000-0000-0000-000000000002',10001,'queued')"))
