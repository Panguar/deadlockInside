"""Persist refresh progress so retries resume past completed provider calls."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0004_refresh_progress"
down_revision = "0003_refresh_dispatch"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("refresh_jobs", sa.Column(
        "progress", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False,
    ))


def downgrade():
    op.drop_column("refresh_jobs", "progress")
