"""Track successful catalog fetches independently from match-created heroes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0007_hero_catalog_snapshots"
down_revision = "0006_hero_analytics"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "hero_catalog_snapshots",
        sa.Column("id", sa.BigInteger(), sa.Identity(), nullable=False),
        sa.Column("source", sa.String(length=100), nullable=False),
        sa.Column("sample_size", sa.BigInteger(), nullable=False),
        sa.Column("hero_ids", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("sample_size >= 0", name=op.f("ck_hero_catalog_snapshots_sample_size_nonnegative")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_hero_catalog_snapshots")),
    )


def downgrade():
    op.drop_table("hero_catalog_snapshots")
