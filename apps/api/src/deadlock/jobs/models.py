from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from deadlock.core.db import Base


class RefreshJob(Base):
    __tablename__ = "refresh_jobs"
    __table_args__ = (
        CheckConstraint("status IN ('queued','running','succeeded','failed')", name="status_valid"),
        CheckConstraint("attempts >= 0", name="attempts_nonnegative"),
        Index("uq_refresh_jobs_active_account", "account_id", unique=True,
              postgresql_where=text("status IN ('queued','running')")),
        Index("ix_refresh_jobs_status_available", "status", "available_at"),
    )

    job_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    account_id: Mapped[int] = mapped_column(ForeignKey("players.account_id"), index=True)
    status: Mapped[str] = mapped_column(String(16), server_default="queued")
    attempts: Mapped[int] = mapped_column(Integer, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_token: Mapped[UUID | None] = mapped_column(Uuid)
    error_code: Mapped[str | None] = mapped_column(String(100))
    progress: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), nullable=False)
