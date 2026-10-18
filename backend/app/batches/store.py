"""Batch persistence. Cloud Storage holds the normalized rows (private bucket, 24 h lifecycle delete);
Firestore holds batch metadata and the per-batch AI counter, so every Cloud Run instance can serve
any batch. Falls back to in-process memory for local development and tests."""

from __future__ import annotations

import io
import json
import threading
from datetime import UTC, datetime
from typing import Any, Protocol

import pandas as pd

from app.config import settings
from app.observability import log_event

COLLECTION = "batches"


class BatchStore(Protocol):
    backend: str

    def save(self, meta: dict, rows: pd.DataFrame, labels: dict[str, int]) -> None: ...
    def meta(self, batch_id: str) -> dict | None: ...
    def load(self, batch_id: str) -> tuple[dict, pd.DataFrame, dict[str, int]] | None: ...
    def update(self, batch_id: str, fields: dict) -> None: ...
    def try_consume_ai(self, batch_id: str, cap: int) -> bool: ...


def _csv(rows: pd.DataFrame) -> bytes:
    out = rows.copy()
    out["timestamp"] = out["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%S")
    return out.to_csv(index=False).encode()


def _rows_from_csv(data: bytes) -> pd.DataFrame:
    df = pd.read_csv(io.BytesIO(data), dtype={"amount_paise": "int64"})
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df


class MemoryBatchStore:
    backend = "memory"

    def __init__(self) -> None:
        self._items: dict[str, tuple[dict, bytes, dict]] = {}
        self._lock = threading.Lock()

    def save(self, meta: dict, rows: pd.DataFrame, labels: dict[str, int]) -> None:
        with self._lock:
            self._items[meta["batch_id"]] = (dict(meta), _csv(rows), dict(labels))

    def meta(self, batch_id: str) -> dict | None:
        item = self._items.get(batch_id)
        return dict(item[0]) if item else None

    def load(self, batch_id: str):
        item = self._items.get(batch_id)
        return (dict(item[0]), _rows_from_csv(item[1]), dict(item[2])) if item else None

    def update(self, batch_id: str, fields: dict) -> None:
        with self._lock:
            if batch_id in self._items:
                self._items[batch_id][0].update(fields)

    def try_consume_ai(self, batch_id: str, cap: int) -> bool:
        with self._lock:
            meta = self._items.get(batch_id, ({},))[0]
            if meta.get("ai_investigations", 0) >= cap:
                return False
            meta["ai_investigations"] = meta.get("ai_investigations", 0) + 1
            return True


class CloudBatchStore:
    backend = "gcs+firestore"

    def __init__(self) -> None:
        from google.cloud import firestore, storage

        self._fs_mod = firestore
        self.db = firestore.Client(project=settings.google_cloud_project or None, database=settings.firestore_database)
        self.bucket = storage.Client(project=settings.google_cloud_project or None).bucket(settings.uploads_bucket)

    def _doc(self, batch_id: str):
        return self.db.collection(COLLECTION).document(batch_id)

    def save(self, meta: dict, rows: pd.DataFrame, labels: dict[str, int]) -> None:
        prefix = f"batches/{meta['batch_id']}"
        self.bucket.blob(f"{prefix}/rows.csv").upload_from_string(_csv(rows), content_type="text/csv")
        self.bucket.blob(f"{prefix}/labels.json").upload_from_string(json.dumps(labels),
                                                                      content_type="application/json")
        self._doc(meta["batch_id"]).create(meta)

    def meta(self, batch_id: str) -> dict | None:
        snap = self._doc(batch_id).get()
        return snap.to_dict() if snap.exists else None

    def load(self, batch_id: str):
        meta = self.meta(batch_id)
        if meta is None:
            return None
        prefix = f"batches/{batch_id}"
        try:
            rows = _rows_from_csv(self.bucket.blob(f"{prefix}/rows.csv").download_as_bytes())
            labels = json.loads(self.bucket.blob(f"{prefix}/labels.json").download_as_bytes())
        except Exception as e:  # deleted by the 24 h lifecycle rule
            log_event("batch_rows_missing", batch_id=batch_id, error=type(e).__name__)
            return None
        return meta, rows, labels

    def update(self, batch_id: str, fields: dict) -> None:
        self._doc(batch_id).update(fields)

    def try_consume_ai(self, batch_id: str, cap: int) -> bool:
        doc = self._doc(batch_id)

        @self._fs_mod.transactional
        def txn(transaction) -> bool:
            snap = doc.get(transaction=transaction)
            used = (snap.to_dict() or {}).get("ai_investigations", 0)
            if used >= cap:
                return False
            transaction.update(doc, {"ai_investigations": used + 1})
            return True

        return txn(self.db.transaction())


_store: BatchStore | None = None
_store_lock = threading.Lock()


def get_batch_store() -> BatchStore:
    global _store
    with _store_lock:
        if _store is None:
            if settings.uploads_bucket and settings.firestore_enabled:
                try:
                    _store = CloudBatchStore()
                    log_event("batch_store", backend="gcs+firestore", bucket=settings.uploads_bucket)
                except Exception as e:
                    log_event("batch_store_degraded", error=f"{type(e).__name__}: {e}")
                    _store = MemoryBatchStore()
            else:
                _store = MemoryBatchStore()
        return _store


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def is_expired(meta: dict[str, Any]) -> bool:
    exp = meta.get("expires_at")
    return bool(exp) and datetime.fromisoformat(exp) < datetime.now(UTC)
