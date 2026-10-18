"""Store immutable global hero analytics snapshots, including empty sets."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0006_hero_analytics"
down_revision = "0005_match_metadata_jobs"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "hero_analytics_snapshots",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("filter_key", sa.String(length=64), nullable=False),
        sa.Column("filters", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("data", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("sample_size", sa.BigInteger(), nullable=False),
        sa.Column("period_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("sample_size >= 0", name=op.f("ck_hero_analytics_snapshots_sample_size_nonnegative")),
        sa.CheckConstraint("period_end > period_start", name=op.f("ck_hero_analytics_snapshots_period_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hero_analytics_snapshots")),
        sa.UniqueConstraint("filter_key", "fetched_at", name=op.f("uq_hero_analytics_snapshots_filter_key")),
    )
    op.create_index(op.f("ix_hero_analytics_snapshots_filter_key"), "hero_analytics_snapshots", ["filter_key"])


def downgrade():
    op.drop_index(op.f("ix_hero_analytics_snapshots_filter_key"), table_name="hero_analytics_snapshots")
    op.drop_table("hero_analytics_snapshots")
