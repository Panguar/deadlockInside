"""Import the complete model registry for Alembic and ORM consumers."""
from deadlock.account.models import Account, Favorite
from deadlock.heroes.models import Hero, HeroAnalyticsSnapshot, HeroCatalogSnapshot, HeroStatsSnapshot
from deadlock.jobs.models import RefreshJob
from deadlock.matches.models import Match, MatchPlayer
from deadlock.players.models import Player, RankSnapshot

__all__ = ["Account", "Favorite", "Hero", "HeroStatsSnapshot", "HeroAnalyticsSnapshot", "HeroCatalogSnapshot", "RefreshJob", "Match", "MatchPlayer", "Player", "RankSnapshot"]
