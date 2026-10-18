from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from deadlock.core.db import Base


class Player(Base):
    __tablename__ = "players"
    __table_args__ = (CheckConstraint("account_id > 0 AND account_id <= 4294967295", name="account_id_range"),)

    account_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    personaname: Mapped[str | None] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(2048))
    rank_badge: Mapped[int | None] = mapped_column(Integer)
    profile_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    history_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RankSnapshot(Base):
    __tablename__ = "rank_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "match_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("players.account_id"), index=True)
    match_id: Mapped[int | None] = mapped_column(ForeignKey("matches.match_id"))
    badge: Mapped[int | None] = mapped_column(Integer)
    delta: Mapped[int | None] = mapped_column(Integer)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
