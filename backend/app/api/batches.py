"""Upload & Test API: upload a CSV/JSON of transactions, get them screened, then investigate any row.

POST /api/batches?format=csv|json&filename=…   raw file body (max 2 MB / 5,000 rows)
GET  /api/batches/template.csv                    ready-to-upload sample
GET  /api/batches/{batch_id}                      summary + scored rows (+ labelled metrics)
GET  /api/batches/{batch_id}/results.csv          export (spreadsheet-formula safe)
Cases from a batch: POST /api/cases {"transaction_id": …, "batch_id": …}, then the normal investigate flow.
"""

from __future__ import annotations

import re
import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from app.api.routes import client_ip, rate_limit
from app.batches import service as batch_service
from app.batches.parse import MAX_BYTES, UploadError
from app.config import settings
from app.observability import log_event
from app.services import BatchNotFound

router = APIRouter(prefix="/api/batches")
_BATCH_ID = re.compile(r"^BATCH-[A-Z0-9]{8,16}$")
_uploads: dict[str, deque] = defaultdict(deque)
_uploads_lock = threading.Lock()


SINGLE_TXN_MAX_BYTES = 2048          # the "Single transaction" form posts one small JSON row
SINGLE_TXN_PER_HOUR = 30


def _upload_quota(request: Request, size: int) -> None:
    ip, now = client_ip(request), time.time()
    single = size <= SINGLE_TXN_MAX_BYTES
    key, limit = (f"single:{ip}", SINGLE_TXN_PER_HOUR) if single else (ip, settings.uploads_per_hour_per_ip)
    with _uploads_lock:
        q = _uploads[key]
        while q and now - q[0] > 3600:
            q.popleft()
        if len(q) >= limit:
            what = "single-transaction checks" if single else "file uploads"
            raise HTTPException(429, f"Limit reached ({limit} {what} per hour); try again later")
        q.append(now)


def _check_id(batch_id: str) -> None:
    if not _BATCH_ID.match(batch_id):
        raise HTTPException(404, "batch not found")


@router.get("/template.csv", response_class=PlainTextResponse)
def template() -> PlainTextResponse:
    return PlainTextResponse(batch_service.template_csv(), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="fraudlens-upload-template.csv"'})


@router.post("")
async def upload(request: Request, format: str = "csv", filename: str = "upload") -> JSONResponse:
    rate_limit(request, cost=2)
    fmt = format.lower()
    if fmt not in ("csv", "json"):
        raise HTTPException(415, "only CSV or JSON files are accepted")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, f"file too large (max {MAX_BYTES // (1024 * 1024)} MB)")
    _upload_quota(request, len(raw))
    safe_name = re.sub(r"[^A-Za-z0-9._ -]", "_", filename)[:120]
    try:
        view = batch_service.create_batch(bytes(raw), fmt, safe_name, source="upload")
    except UploadError as e:
        log_event("batch_rejected", reason=str(e)[:200], errors=len(e.errors))
        return JSONResponse({"detail": str(e), "errors": e.errors[:200]}, status_code=422)
    return JSONResponse(view, status_code=201)


@router.get("/{batch_id}")
def get_batch(batch_id: str) -> dict:
    _check_id(batch_id)
    try:
        return batch_service.batch_view(batch_id)
    except BatchNotFound as e:
        raise HTTPException(404, str(e)) from e


@router.get("/{batch_id}/results.csv", response_class=PlainTextResponse)
def export(batch_id: str) -> PlainTextResponse:
    _check_id(batch_id)
    try:
        body = batch_service.results_csv(batch_id)
    except BatchNotFound as e:
        raise HTTPException(404, str(e)) from e
    return PlainTextResponse(body, media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{batch_id}-results.csv"'})
