from contextlib import asynccontextmanager
import os
from uuid import uuid4

from fastapi import FastAPI, Request
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from deadlock.core.config import Settings
from deadlock.core.db import build_engine
from deadlock.core.errors import error_response, install_error_handlers
from deadlock.providers.deadlock_api import DeadlockProvider
from deadlock.providers.limiter import RedisRateLimiter


def create_app() -> FastAPI:
    settings = Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = build_engine(settings)
        redis = Redis.from_url(
            settings.redis_url.get_secret_value(),
            socket_connect_timeout=settings.dependency_timeout_seconds,
            socket_timeout=settings.dependency_timeout_seconds,
            retry_on_timeout=False,
        )
        app.state.engine = engine
        app.state.redis = redis
        app.state.settings = settings
        app.state.provider = DeadlockProvider(
            os.environ.get("DEADLOCK_API_BASE_URL", "https://api.deadlock-api.com/v1"),
            limiter=RedisRateLimiter(redis),
        )
        app.state.session_factory = sessionmaker(engine, expire_on_commit=False)
        try:
            yield
        finally:
            redis.close()
            engine.dispose()

    app = FastAPI(title="Deadlock Inside API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    install_error_handlers(app)

    @app.middleware("http")
    async def request_id(request: Request, call_next):
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.get("/health/live", tags=["health"])
    def live():
        return {"status": "ok"}

    @app.get("/health/ready", tags=["health"], responses={503: {"description": "Dependencies unavailable"}})
    def ready(request: Request):
        try:
            with request.app.state.engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            request.app.state.redis.ping()
        except (SQLAlchemyError, RedisError, OSError):
            return error_response(request, 503, "dependencies_unavailable", "Service dependencies are unavailable")
        return {"status": "ok"}

    from deadlock.jobs.router import router as jobs_router
    from deadlock.heroes.router import router as heroes_router
    from deadlock.matches.router import router as matches_router
    from deadlock.players.router import router as players_router

    app.include_router(players_router, prefix="/api/v1")
    app.include_router(matches_router, prefix="/api/v1")
    app.include_router(jobs_router, prefix="/api/v1")
    app.include_router(heroes_router, prefix="/api/v1")

    return app
