"""Persist the source coverage of each player's loaded history."""
from alembic import op
import sqlalchemy as sa

revision = "0002_history_coverage"
down_revision = "0001_foundation"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("players", sa.Column("history_coverage", sa.String(length=16), nullable=True))
    op.add_column("players", sa.Column("history_stale", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade():
    op.drop_column("players", "history_stale")
    op.drop_column("players", "history_coverage")
