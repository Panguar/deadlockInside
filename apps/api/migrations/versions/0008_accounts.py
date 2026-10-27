"""Add Steam accounts and per-account favorites."""
from alembic import op
import sqlalchemy as sa


revision = "0008_accounts"
down_revision = "0007_hero_catalog_snapshots"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "accounts",
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("steam_id64", sa.String(20), nullable=False),
        sa.Column("personaname", sa.String(200), nullable=True),
        sa.Column("avatar_url", sa.String(2048), nullable=True),
        sa.Column("default_period", sa.String(8), server_default="30", nullable=False),
        sa.CheckConstraint("account_id > 0 AND account_id <= 4294967295", name=op.f("ck_accounts_account_id_range")),
        sa.PrimaryKeyConstraint("account_id", name=op.f("pk_accounts")),
        sa.UniqueConstraint("steam_id64", name=op.f("uq_accounts_steam_id64")),
    )
    op.create_table(
        "account_favorites",
        sa.Column("owner_id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("account_id > 0 AND account_id <= 4294967295", name=op.f("ck_account_favorites_target_account_id_range")),
        sa.ForeignKeyConstraint(["owner_id"], ["accounts.account_id"], name=op.f("fk_account_favorites_owner_id_accounts"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("owner_id", "account_id", name=op.f("pk_account_favorites")),
    )
    op.create_index("ix_account_favorites_owner_id", "account_favorites", ["owner_id"])


def downgrade():
    op.drop_index("ix_account_favorites_owner_id", table_name="account_favorites")
    op.drop_table("account_favorites")
    op.drop_table("accounts")
