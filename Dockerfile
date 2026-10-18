# FraudLens AI - single Cloud Run image: React build + FastAPI (API + static files).
# Data and model artifacts are generated reproducibly (seed 42) before building:
#   cd backend && uv run python -m app.data.generate && uv run python -m app.ml.train

FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080 \
    UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    STATIC_DIR=/app/static METRICS_DIR=/app/metrics DATA_DIR=/app/data MODELS_DIR=/app/models
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /bin/uv
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/app ./app
COPY backend/data ./data
COPY backend/models ./models
COPY docs/metrics ./metrics
COPY --from=web /web/dist ./static
RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser
EXPOSE 8080
CMD ["sh", "-c", "exec /app/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --timeout-graceful-shutdown 10"]
