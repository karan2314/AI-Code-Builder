"""Case + audit persistence. Firestore when enabled, in-memory otherwise (or as degraded fallback).

Audit events are append-only: there is deliberately no update or delete method for them.
"""

from __future__ import annotations

import threading
import uuid
from datetime import UTC, datetime
from typing import Any, Protocol

from app.config import settings
from app.observability import log_event
from app.schemas import AuditEvent, Case


class CaseRepository(Protocol):
    backend: str
    degraded: bool

    def save(self, case: Case) -> None: ...
    def get(self, case_id: str) -> Case | None: ...
    def find_by_transaction(self, transaction_id: str) -> Case | None: ...
    def list(self, limit: int = 100) -> list[Case]: ...
    def append_audit(self, case_id: str, event_type: str, actor: str, details: dict[str, Any]) -> AuditEvent: ...
    def audit(self, case_id: str) -> list[AuditEvent]: ...


def _event(case_id: str, event_type: str, actor: str, details: dict[str, Any]) -> AuditEvent:
    return AuditEvent(event_id=f"AE-{uuid.uuid4().hex[:12]}", case_id=case_id, event_type=event_type, actor=actor,
                      timestamp=datetime.now(UTC), details=details)


class InMemoryCaseRepository:
    backend = "memory"

    def __init__(self, degraded: bool = False) -> None:
        self.degraded = degraded
        self._cases: dict[str, Case] = {}
        self._audit: dict[str, list[AuditEvent]] = {}
        self._lock = threading.Lock()

    def save(self, case: Case) -> None:
        with self._lock:
            self._cases[case.case_id] = case.model_copy(deep=True)

    def get(self, case_id: str) -> Case | None:
        c = self._cases.get(case_id)
        return c.model_copy(deep=True) if c else None

    def find_by_transaction(self, transaction_id: str) -> Case | None:
        for c in self._cases.values():
            if c.transaction_id == transaction_id:
                return c.model_copy(deep=True)
        return None

    def list(self, limit: int = 100) -> list[Case]:
        return sorted(self._cases.values(), key=lambda c: c.updated_at, reverse=True)[:limit]

    def append_audit(self, case_id: str, event_type: str, actor: str, details: dict[str, Any]) -> AuditEvent:
        ev = _event(case_id, event_type, actor, details)
        with self._lock:
            self._audit.setdefault(case_id, []).append(ev)
        return ev

    def audit(self, case_id: str) -> list[AuditEvent]:
        return list(self._audit.get(case_id, []))


class FirestoreCaseRepository:
    backend = "firestore"
    degraded = False

    def __init__(self) -> None:
        from google.cloud import firestore  # imported lazily so tests don't need GCP

        self._fs = firestore
        self.db = firestore.Client(project=settings.google_cloud_project or None, database=settings.firestore_database)
        self.db.collection("cases").limit(1).get()  # connectivity check

    def save(self, case: Case) -> None:
        self.db.collection("cases").document(case.case_id).set(case.model_dump(mode="json"))

    def get(self, case_id: str) -> Case | None:
        snap = self.db.collection("cases").document(case_id).get()
        return Case.model_validate(snap.to_dict()) if snap.exists else None

    def find_by_transaction(self, transaction_id: str) -> Case | None:
        docs = self.db.collection("cases").where(filter=self._fs.FieldFilter("transaction_id", "==", transaction_id)).limit(1).get()
        return Case.model_validate(docs[0].to_dict()) if docs else None

    def list(self, limit: int = 100) -> list[Case]:
        docs = self.db.collection("cases").order_by("updated_at", direction=self._fs.Query.DESCENDING).limit(limit).get()
        return [Case.model_validate(d.to_dict()) for d in docs]

    def append_audit(self, case_id: str, event_type: str, actor: str, details: dict[str, Any]) -> AuditEvent:
        ev = _event(case_id, event_type, actor, details)
        # create() fails if the document exists, so events can never be overwritten
        self.db.collection("cases").document(case_id).collection("audit").document(ev.event_id).create(ev.model_dump(mode="json"))
        return ev

    def audit(self, case_id: str) -> list[AuditEvent]:
        docs = self.db.collection("cases").document(case_id).collection("audit").order_by("timestamp").get()
        return [AuditEvent.model_validate(d.to_dict()) for d in docs]


def make_case_repository() -> CaseRepository:
    if settings.firestore_enabled:
        try:
            repo = FirestoreCaseRepository()
            log_event("case_repository", backend="firestore")
            return repo
        except Exception as e:  # degrade gracefully: keep the demo working
            log_event("case_repository_degraded", error=f"{type(e).__name__}: {e}")
            return InMemoryCaseRepository(degraded=True)
    return InMemoryCaseRepository()
