"""FraudLens AI - FastAPI entrypoint. Serves /api, /healthz and the built React app (one Cloud Run URL)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse

from app.api.routes import router
from app.config import settings
from app.observability import log_event, setup_logging
from app.policy.engine import POLICY_VERSION
from app.services import get_services

setup_logging(settings.log_level)


@asynccontextmanager
async def lifespan(_: FastAPI):
    svc = get_services()  # load data, models, graph once
    log_event("startup", transactions=len(svc.repo.transactions), model_version=svc.scorer.version,
              case_store=svc.cases.backend, gemini_enabled=settings.gemini_enabled)
    yield


app = FastAPI(title="FraudLens AI", version="0.1.0", lifespan=lifespan,
              description="Agentic fraud investigation on SYNTHETIC data. All actions are simulated.")
app.include_router(router)

MAX_BODY_BYTES = 256 * 1024


SECURITY_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    # Same-origin only. 'unsafe-inline' styles are needed by the chart/graph libraries; no inline scripts.
    "Content-Security-Policy": ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                                "img-src 'self' data:; connect-src 'self'; font-src 'self' data:; "
                                "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"),
}
DOCS_CSP = "default-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net"


@app.middleware("http")
async def guard_and_headers(request: Request, call_next):
    if int(request.headers.get("content-length") or 0) > MAX_BODY_BYTES:
        return JSONResponse({"detail": "request too large"}, status_code=413)
    response = await call_next(request)
    for k, v in SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
    if request.url.path in ("/docs", "/redoc"):
        response.headers["Content-Security-Policy"] = DOCS_CSP
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    elif request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"  # hashed filenames
    return response


@app.get("/healthz")
@app.get("/api/health")  # Cloud Run's front end reserves /healthz for external requests
def healthz() -> dict:
    svc = get_services()
    return {"status": "ok", "model_version": svc.scorer.version, "policy_version": POLICY_VERSION,
            "gemini_enabled": settings.gemini_enabled, "case_store": svc.cases.backend}


static_dir = Path(settings.static_dir)


@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    """Serve the React build; unknown paths fall back to index.html (client-side routing)."""
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "not found"}, status_code=404)
    candidate = (static_dir / full_path).resolve()
    if full_path and candidate.is_file() and static_dir.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = static_dir / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "frontend not built", "api_docs": "/docs"}, status_code=404)
