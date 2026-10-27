from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from deadlock.core.db import Base


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (CheckConstraint("account_id > 0 AND account_id <= 4294967295", name="account_id_range"),)

    account_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    steam_id64: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    personaname: Mapped[str | None] = mapped_column(String(200))
    avatar_url: Mapped[str | None] = mapped_column(String(2048))
    default_period: Mapped[str] = mapped_column(String(8), nullable=False, server_default="30")


class Favorite(Base):
    __tablename__ = "account_favorites"
    __table_args__ = (
        CheckConstraint("account_id > 0 AND account_id <= 4294967295", name="target_account_id_range"),
    )

    owner_id: Mapped[int] = mapped_column(ForeignKey("accounts.account_id", ondelete="CASCADE"), primary_key=True)
    account_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
