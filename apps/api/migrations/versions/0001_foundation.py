"""Create the seven foundation tables and integrity constraints."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_foundation"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('heroes',
    sa.Column('hero_id', sa.BigInteger(), autoincrement=False, nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('class_name', sa.String(length=200), nullable=True),
    sa.Column('client_version', sa.Integer(), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('hero_id', name=op.f('pk_heroes'))
    )
    op.create_table('matches',
    sa.Column('match_id', sa.BigInteger(), autoincrement=False, nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('duration_s', sa.Integer(), nullable=True),
    sa.Column('game_mode', sa.Integer(), nullable=True),
    sa.Column('match_mode', sa.Integer(), nullable=True),
    sa.Column('winning_team', sa.Integer(), nullable=True),
    sa.Column('status', sa.String(length=16), server_default='partial', nullable=False),
    sa.Column('metadata_updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("status IN ('partial', 'complete')", name=op.f('ck_matches_status_valid')),
    sa.CheckConstraint('duration_s IS NULL OR duration_s >= 0', name=op.f('ck_matches_duration_nonnegative')),
    sa.CheckConstraint('match_id > 0', name=op.f('ck_matches_positive_id')),
    sa.PrimaryKeyConstraint('match_id', name=op.f('pk_matches'))
    )
    op.create_index('ix_matches_started_id', 'matches', ['started_at', 'match_id'], unique=False)
    op.create_table('players',
    sa.Column('account_id', sa.BigInteger(), autoincrement=False, nullable=False),
    sa.Column('personaname', sa.String(length=200), nullable=True),
    sa.Column('avatar_url', sa.String(length=2048), nullable=True),
    sa.Column('rank_badge', sa.Integer(), nullable=True),
    sa.Column('profile_updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('history_updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('account_id > 0 AND account_id <= 4294967295', name=op.f('ck_players_account_id_range')),
    sa.PrimaryKeyConstraint('account_id', name=op.f('pk_players'))
    )
    op.create_table('hero_stats_snapshots',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('hero_id', sa.BigInteger(), nullable=False),
    sa.Column('filter_key', sa.String(length=64), nullable=False),
    sa.Column('filters', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('data', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('source', sa.String(length=100), server_default='deadlock-api', nullable=False),
    sa.Column('sample_size', sa.BigInteger(), nullable=False),
    sa.Column('fetched_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint('sample_size >= 0', name=op.f('ck_hero_stats_snapshots_sample_size_nonnegative')),
    sa.ForeignKeyConstraint(['hero_id'], ['heroes.hero_id'], name=op.f('fk_hero_stats_snapshots_hero_id_heroes')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_hero_stats_snapshots')),
    sa.UniqueConstraint('hero_id', 'filter_key', 'fetched_at', name=op.f('uq_hero_stats_snapshots_hero_id'))
    )
    op.create_index(op.f('ix_hero_stats_snapshots_filter_key'), 'hero_stats_snapshots', ['filter_key'], unique=False)
    op.create_table('match_players',
    sa.Column('match_id', sa.BigInteger(), nullable=False),
    sa.Column('account_id', sa.BigInteger(), nullable=False),
    sa.Column('hero_id', sa.BigInteger(), nullable=False),
    sa.Column('team', sa.Integer(), nullable=True),
    sa.Column('kills', sa.Integer(), nullable=True),
    sa.Column('deaths', sa.Integer(), nullable=True),
    sa.Column('assists', sa.Integer(), nullable=True),
    sa.Column('net_worth', sa.BigInteger(), nullable=True),
    sa.Column('player_damage', sa.BigInteger(), nullable=True),
    sa.Column('player_match_outcome', sa.Integer(), nullable=True),
    sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    sa.Column('stats_at_seconds', sa.Integer(), nullable=True),
    sa.CheckConstraint('assists IS NULL OR assists >= 0', name=op.f('ck_match_players_assists_nonnegative')),
    sa.CheckConstraint('deaths IS NULL OR deaths >= 0', name=op.f('ck_match_players_deaths_nonnegative')),
    sa.CheckConstraint('kills IS NULL OR kills >= 0', name=op.f('ck_match_players_kills_nonnegative')),
    sa.CheckConstraint('player_damage IS NULL OR player_damage >= 0', name=op.f('ck_match_players_damage_nonnegative')),
    sa.ForeignKeyConstraint(['account_id'], ['players.account_id'], name=op.f('fk_match_players_account_id_players')),
    sa.ForeignKeyConstraint(['hero_id'], ['heroes.hero_id'], name=op.f('fk_match_players_hero_id_heroes')),
    sa.ForeignKeyConstraint(['match_id'], ['matches.match_id'], name=op.f('fk_match_players_match_id_matches'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('match_id', 'account_id', name=op.f('pk_match_players'))
    )
    op.create_index('ix_match_players_account_match', 'match_players', ['account_id', 'match_id'], unique=False)
    op.create_table('rank_snapshots',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('account_id', sa.BigInteger(), nullable=False),
    sa.Column('match_id', sa.BigInteger(), nullable=True),
    sa.Column('badge', sa.Integer(), nullable=True),
    sa.Column('delta', sa.Integer(), nullable=True),
    sa.Column('observed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['account_id'], ['players.account_id'], name=op.f('fk_rank_snapshots_account_id_players')),
    sa.ForeignKeyConstraint(['match_id'], ['matches.match_id'], name=op.f('fk_rank_snapshots_match_id_matches')),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_rank_snapshots')),
    sa.UniqueConstraint('account_id', 'match_id', name=op.f('uq_rank_snapshots_account_id'))
    )
    op.create_index(op.f('ix_rank_snapshots_account_id'), 'rank_snapshots', ['account_id'], unique=False)
    op.create_table('refresh_jobs',
    sa.Column('job_id', sa.Uuid(), nullable=False),
    sa.Column('account_id', sa.BigInteger(), nullable=False),
    sa.Column('status', sa.String(length=16), server_default='queued', nullable=False),
    sa.Column('attempts', sa.Integer(), server_default='0', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('available_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('lease_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('lease_token', sa.Uuid(), nullable=True),
    sa.Column('error_code', sa.String(length=100), nullable=True),
    sa.CheckConstraint("status IN ('queued','running','succeeded','failed')", name=op.f('ck_refresh_jobs_status_valid')),
    sa.CheckConstraint('attempts >= 0', name=op.f('ck_refresh_jobs_attempts_nonnegative')),
    sa.ForeignKeyConstraint(['account_id'], ['players.account_id'], name=op.f('fk_refresh_jobs_account_id_players')),
    sa.PrimaryKeyConstraint('job_id', name=op.f('pk_refresh_jobs'))
    )
    op.create_index(op.f('ix_refresh_jobs_account_id'), 'refresh_jobs', ['account_id'], unique=False)
    op.create_index('ix_refresh_jobs_status_available', 'refresh_jobs', ['status', 'available_at'], unique=False)
    op.create_index('uq_refresh_jobs_active_account', 'refresh_jobs', ['account_id'], unique=True, postgresql_where=sa.text("status IN ('queued','running')"))


def downgrade():
    op.drop_index('uq_refresh_jobs_active_account', table_name='refresh_jobs', postgresql_where=sa.text("status IN ('queued','running')"))
    op.drop_index('ix_refresh_jobs_status_available', table_name='refresh_jobs')
    op.drop_index(op.f('ix_refresh_jobs_account_id'), table_name='refresh_jobs')
    op.drop_table('refresh_jobs')
    op.drop_index(op.f('ix_rank_snapshots_account_id'), table_name='rank_snapshots')
    op.drop_table('rank_snapshots')
    op.drop_index('ix_match_players_account_match', table_name='match_players')
    op.drop_table('match_players')
    op.drop_index(op.f('ix_hero_stats_snapshots_filter_key'), table_name='hero_stats_snapshots')
    op.drop_table('hero_stats_snapshots')
    op.drop_table('players')
    op.drop_index('ix_matches_started_id', table_name='matches')
    op.drop_table('matches')
    op.drop_table('heroes')
