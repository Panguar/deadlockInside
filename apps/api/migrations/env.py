import os

from alembic import context
from sqlalchemy import create_engine, pool

from deadlock.core.db import Base
from deadlock.core import models  # register all tables


def run_migrations():
    url = os.environ["DATABASE_URL"]
    if context.is_offline_mode():
        context.configure(url=url, literal_binds=True, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    else:
        engine = create_engine(url, poolclass=pool.NullPool)
        with engine.connect() as connection:
            context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
            with context.begin_transaction():
                context.run_migrations()
        engine.dispose()


run_migrations()
