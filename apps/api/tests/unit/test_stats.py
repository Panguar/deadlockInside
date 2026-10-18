from deadlock.players.stats import PlayerMatchRow, calculate_player_stats
from deadlock.heroes.service import aggregate_hero_buckets, analytics_filter_key, analytics_filters
from deadlock.providers.schemas import ProviderHeroStats
from datetime import datetime, timezone


def test_empty_sample_has_null_win_rate_and_kda():
    stats = calculate_player_stats([])

    assert stats.sample_size == 0
    assert stats.kda_sample_size == 0
    assert stats.decided_matches == 0
    assert stats.wins == 0
    assert stats.win_rate is None
    assert stats.kda is None


def test_win_rate_excludes_unknown_outcomes():
    stats = calculate_player_stats([
        PlayerMatchRow(hero_id=1, outcome=1, kills=1, deaths=1, assists=0),
        PlayerMatchRow(hero_id=1, outcome=1, kills=2, deaths=1, assists=1),
        PlayerMatchRow(hero_id=2, outcome=2, kills=0, deaths=2, assists=1),
        PlayerMatchRow(hero_id=2, outcome=0, kills=3, deaths=0, assists=2),
    ])

    assert stats.sample_size == 4
    assert stats.decided_matches == 3
    assert stats.wins == 2
    assert stats.win_rate == 2 / 3
    assert [row.hero_id for row in stats.heroes] == ["1", "2"]
    assert stats.heroes[1].decided_matches == 1
    assert stats.heroes[1].wins == 0


def test_kda_uses_summed_values_and_zero_death_floor():
    stats = calculate_player_stats([
        PlayerMatchRow(hero_id=1, outcome=1, kills=10, deaths=0, assists=5),
        PlayerMatchRow(hero_id=1, outcome=2, kills=0, deaths=2, assists=0),
    ])

    assert stats.kda == 15 / 2
    assert stats.heroes[0].kda == 15 / 2


def test_kda_skips_rows_with_missing_components():
    stats = calculate_player_stats([
        PlayerMatchRow(hero_id=1, outcome=1, kills=10, deaths=0, assists=5),
        PlayerMatchRow(hero_id=1, outcome=2, kills=None, deaths=2, assists=0),
    ])

    assert stats.sample_size == 2
    assert stats.kda == 15
    assert stats.kda_sample_size == 1


def test_hero_buckets_sum_per_hero_and_drop_the_exclusive_end_bucket():
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    end = datetime(2026, 10, 1, 2, tzinfo=timezone.utc)
    rows = [
        ProviderHeroStats(hero_id=1, bucket=1790812800, wins=2, losses=1, matches=3,
                          total_kills=20, total_deaths=10, total_assists=30),
        ProviderHeroStats(hero_id=1, bucket=1790816400, wins=1, losses=2, matches=3,
                          total_kills=10, total_deaths=20, total_assists=10),
        ProviderHeroStats(hero_id=1, bucket=1790820000, wins=100, losses=0, matches=100,
                          total_kills=1000, total_deaths=1, total_assists=0),
    ]

    result = aggregate_hero_buckets(rows, start=start, end=end)

    assert result == [{"hero_id": "1", "matches": 6, "wins": 3, "losses": 3,
                       "win_rate": 0.5, "kda": 70 / 30, "kda_sample_size": 6}]


def test_filter_key_is_stable_but_changes_with_period_or_bucket():
    day = analytics_filters(datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2026, 10, 2, tzinfo=timezone.utc))
    hour = analytics_filters(datetime(2026, 10, 1, 1, tzinfo=timezone.utc), datetime(2026, 10, 2, 1, tzinfo=timezone.utc))

    assert analytics_filter_key(day) == analytics_filter_key(dict(reversed(list(day.items()))))
    assert analytics_filter_key(day) != analytics_filter_key(hour)
    assert day["bucket"] == "start_time_day"
    assert hour["bucket"] == "start_time_hour"
