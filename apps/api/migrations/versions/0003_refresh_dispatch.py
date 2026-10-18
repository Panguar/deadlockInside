"""Track broker dispatch attempts for queued refresh jobs."""
from alembic import op
import sqlalchemy as sa

revision = "0003_refresh_dispatch"
down_revision = "0002_history_coverage"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("refresh_jobs", sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column("refresh_jobs", "dispatched_at")
