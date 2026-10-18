from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from redis import Redis
from redis.exceptions import RedisError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from deadlock.core.config import Settings
from deadlock.core.db import build_engine
from deadlock.core.errors import error_response


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
        app.state.session_factory = sessionmaker(engine, expire_on_commit=False)
        try:
            yield
        finally:
            redis.close()
            engine.dispose()

    app = FastAPI(title="Deadlock Inside API", version="0.1.0", lifespan=lifespan)

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

    return app
