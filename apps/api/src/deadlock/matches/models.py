from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from deadlock.core.db import Base


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        CheckConstraint("match_id > 0", name="positive_id"),
        CheckConstraint("duration_s IS NULL OR duration_s >= 0", name="duration_nonnegative"),
        CheckConstraint("status IN ('partial', 'complete')", name="status_valid"),
        Index("ix_matches_started_id", "started_at", "match_id"),
    )

    match_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_s: Mapped[int | None] = mapped_column(Integer)
    game_mode: Mapped[int | None] = mapped_column(Integer)
    match_mode: Mapped[int | None] = mapped_column(Integer)
    winning_team: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), server_default="partial")
    metadata_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MatchPlayer(Base):
    __tablename__ = "match_players"
    __table_args__ = (
        CheckConstraint("kills IS NULL OR kills >= 0", name="kills_nonnegative"),
        CheckConstraint("deaths IS NULL OR deaths >= 0", name="deaths_nonnegative"),
        CheckConstraint("assists IS NULL OR assists >= 0", name="assists_nonnegative"),
        CheckConstraint("player_damage IS NULL OR player_damage >= 0", name="damage_nonnegative"),
        Index("ix_match_players_account_match", "account_id", "match_id"),
    )

    match_id: Mapped[int] = mapped_column(ForeignKey("matches.match_id", ondelete="CASCADE"), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("players.account_id"), primary_key=True)
    hero_id: Mapped[int] = mapped_column(ForeignKey("heroes.hero_id"))
    team: Mapped[int | None] = mapped_column(Integer)
    kills: Mapped[int | None] = mapped_column(Integer)
    deaths: Mapped[int | None] = mapped_column(Integer)
    assists: Mapped[int | None] = mapped_column(Integer)
    net_worth: Mapped[int | None] = mapped_column(BigInteger)
    player_damage: Mapped[int | None] = mapped_column(BigInteger)
    player_match_outcome: Mapped[int | None] = mapped_column(Integer)
    items: Mapped[list | None] = mapped_column(JSONB)
    stats_at_seconds: Mapped[int | None] = mapped_column(Integer)
