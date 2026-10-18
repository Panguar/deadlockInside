from datetime import datetime, timezone

from sqlalchemy import select, func

from deadlock.matches.models import Match, MatchPlayer
from deadlock.players.models import Player


def get_player(session, account_id: int):
    player = session.execute(select(Player).where(Player.account_id == account_id)).scalar_one_or_none()
    if player is None:
        return None
    sample_size = session.execute(select(func.count()).select_from(MatchPlayer).where(
        MatchPlayer.account_id == account_id,
    )).scalar_one()
    updated_at = max((value for value in (player.profile_updated_at, player.history_updated_at) if value is not None), default=None)
    return player, sample_size, updated_at
