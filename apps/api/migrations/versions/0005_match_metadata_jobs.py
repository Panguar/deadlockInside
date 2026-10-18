"""Add deduplicated jobs for loading metadata of a known match."""
from alembic import op
import sqlalchemy as sa


revision = "0005_match_metadata_jobs"
down_revision = "0004_refresh_progress"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("refresh_jobs", sa.Column("target_match_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_refresh_jobs_target_match_id_matches", "refresh_jobs", "matches",
                          ["target_match_id"], ["match_id"], ondelete="CASCADE")
    op.create_index("ix_refresh_jobs_target_match_id", "refresh_jobs", ["target_match_id"], unique=False)
    op.drop_index("uq_refresh_jobs_active_account", table_name="refresh_jobs",
                  postgresql_where=sa.text("status IN ('queued','running')"))
    op.create_index("uq_refresh_jobs_active_account", "refresh_jobs", ["account_id"], unique=True,
                    postgresql_where=sa.text("status IN ('queued','running') AND target_match_id IS NULL"))
    op.create_index("uq_refresh_jobs_active_match", "refresh_jobs", ["target_match_id"], unique=True,
                    postgresql_where=sa.text("status IN ('queued','running') AND target_match_id IS NOT NULL"))


def downgrade():
    op.execute("DELETE FROM refresh_jobs WHERE target_match_id IS NOT NULL")
    op.drop_index("uq_refresh_jobs_active_match", table_name="refresh_jobs",
                  postgresql_where=sa.text("status IN ('queued','running') AND target_match_id IS NOT NULL"))
    op.drop_index("uq_refresh_jobs_active_account", table_name="refresh_jobs",
                  postgresql_where=sa.text("status IN ('queued','running') AND target_match_id IS NULL"))
    op.create_index("uq_refresh_jobs_active_account", "refresh_jobs", ["account_id"], unique=True,
                    postgresql_where=sa.text("status IN ('queued','running')"))
    op.drop_index("ix_refresh_jobs_target_match_id", table_name="refresh_jobs")
    op.drop_constraint("fk_refresh_jobs_target_match_id_matches", "refresh_jobs", type_="foreignkey")
    op.drop_column("refresh_jobs", "target_match_id")
