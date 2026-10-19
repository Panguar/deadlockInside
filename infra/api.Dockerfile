FROM ghcr.io/astral-sh/uv:0.12.7 AS uv
FROM python:3.14.7-slim
COPY --from=uv /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/src ./src
COPY apps/api/alembic.ini ./
COPY apps/api/migrations ./migrations
RUN uv sync --frozen --no-dev && useradd --uid 10001 --create-home app \
    && mkdir -p /var/lib/celery && chown app:app /var/lib/celery
USER app
EXPOSE 8000
CMD ["uvicorn", "deadlock.main:create_app", "--factory", "--no-proxy-headers", "--host", "0.0.0.0", "--port", "8000"]
