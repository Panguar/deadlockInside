from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from deadlock.core.db import Base


class Hero(Base):
    __tablename__ = "heroes"

    hero_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(200))
    class_name: Mapped[str | None] = mapped_column(String(200))
    client_version: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HeroStatsSnapshot(Base):
    __tablename__ = "hero_stats_snapshots"
    __table_args__ = (
        UniqueConstraint("hero_id", "filter_key", "fetched_at"),
        CheckConstraint("sample_size >= 0", name="sample_size_nonnegative"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    hero_id: Mapped[int] = mapped_column(ForeignKey("heroes.hero_id"))
    filter_key: Mapped[str] = mapped_column(String(64), index=True)
    filters: Mapped[dict] = mapped_column(JSONB)
    data: Mapped[dict] = mapped_column(JSONB)
    source: Mapped[str] = mapped_column(String(100), server_default="deadlock-api")
    sample_size: Mapped[int] = mapped_column(BigInteger)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HeroAnalyticsSnapshot(Base):
    __tablename__ = "hero_analytics_snapshots"
    __table_args__ = (
        UniqueConstraint("filter_key", "fetched_at"),
        CheckConstraint("sample_size >= 0", name="sample_size_nonnegative"),
        CheckConstraint("period_end > period_start", name="period_positive"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    filter_key: Mapped[str] = mapped_column(String(64), index=True)
    filters: Mapped[dict] = mapped_column(JSONB)
    data: Mapped[list] = mapped_column(JSONB)
    source: Mapped[str] = mapped_column(String(100))
    sample_size: Mapped[int] = mapped_column(BigInteger)
    period_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    period_end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HeroCatalogSnapshot(Base):
    __tablename__ = "hero_catalog_snapshots"
    __table_args__ = (CheckConstraint("sample_size >= 0", name="sample_size_nonnegative"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    source: Mapped[str] = mapped_column(String(100))
    sample_size: Mapped[int] = mapped_column(BigInteger)
    hero_ids: Mapped[list] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
