"""Upload & Test: create a batch from an uploaded file, score it, expose results, template and export."""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta

import pandas as pd

from app.batches.overlay import build_overlay
from app.batches.parse import ParsedBatch, parse_upload
from app.batches.store import get_batch_store, is_expired
from app.config import settings
from app.ml.rules import reason_codes
from app.observability import log_event
from app.services import Services, batch_overlay, cache_overlay, get_base_services

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _new_batch_id() -> str:
    return f"BATCH-{uuid.uuid4().hex[:12].upper()}"


def create_batch(raw: bytes, fmt: str, filename: str, source: str) -> dict:
    parsed: ParsedBatch = parse_upload(raw, fmt)
    base = get_base_services()
    repo, scorer, graph, scored, summary = build_overlay(base.repo, base.scorer, parsed.rows, parsed.labels)
    batch_id = _new_batch_id()
    now = datetime.now(UTC)
    meta = {"batch_id": batch_id, "filename": (filename or "upload")[:120], "format": fmt, "source": source,
            "created_at": now.isoformat(), "expires_at": (now + timedelta(hours=settings.batch_ttl_hours)).isoformat(),
            "rows": summary["rows"], "candidates": summary["candidates"], "has_labels": parsed.has_labels,
            "ai_investigations": 0, "summary": summary,
            # native timestamp for the Firestore TTL policy (auto-deletes metadata after expiry)
            "ttl": now + timedelta(hours=settings.batch_ttl_hours)}
    get_batch_store().save(meta, parsed.rows, parsed.labels)
    cache_overlay(batch_id, (Services(repo=repo, scorer=scorer, graph=graph, cases=base.cases, batch_id=batch_id),
                             scored, summary))
    log_event("batch_created", batch_id=batch_id, rows=summary["rows"], candidates=summary["candidates"],
              processing_ms=summary["processing_ms"], source=source)
    return batch_view(batch_id)


def batch_view(batch_id: str, limit: int = 500) -> dict:
    store = get_batch_store()
    meta = store.meta(batch_id)
    if meta is None or is_expired(meta):
        from app.services import BatchNotFound

        raise BatchNotFound(f"upload batch {batch_id} not found or expired")
    svc, scored, summary = batch_overlay(batch_id)
    cases = {}
    for c in svc.cases.list(500):
        if c.batch_id == batch_id:
            cases[c.transaction_id] = c
    tx = svc.repo.transactions.set_index("transaction_id").loc[scored.index]
    rows = []
    order = scored.sort_values(["is_candidate", "risk_score"], ascending=[False, False]).index
    for tid in order[:limit]:
        r, t = scored.loc[tid], tx.loc[tid]
        c = cases.get(tid)
        rows.append({"transaction_id": tid, "customer_id": t["customer_id"], "timestamp": t["timestamp"].isoformat(),
                     "amount_rupees": round(float(t["amount_paise"]) / 100, 2), "channel": t["channel"],
                     "counterparty_id": t["counterparty_id"], "device_id": t["device_id"],
                     "risk_score": round(float(r["risk_score"]), 4), "is_candidate": bool(r["is_candidate"]),
                     "reason_codes": reason_codes(r[[c for c in r.index if c in svc.scorer.base.importance]]),
                     "label": None if int(t["is_fraud"]) < 0 else int(t["is_fraud"]),
                     "case_id": c.case_id if c else None, "case_status": c.status if c else None,
                     "tier": c.decision.tier if c and c.decision else None})
    fresh = store.meta(batch_id) or meta
    return {"batch_id": batch_id, "filename": meta["filename"], "created_at": meta["created_at"],
            "expires_at": meta["expires_at"], "summary": summary,
            "ai_investigations": {"used": fresh.get("ai_investigations", 0),
                                  "limit": settings.max_ai_investigations_per_batch},
            "rows": rows, "truncated": len(scored) > limit}


def _safe_cell(v) -> str:
    s = "" if v is None else str(v)
    return "'" + s if s.startswith(FORMULA_PREFIXES) else s


def results_csv(batch_id: str) -> str:
    view = batch_view(batch_id, limit=10_000)
    out = io.StringIO()
    w = csv.writer(out)
    cols = ["transaction_id", "customer_id", "timestamp", "amount_rupees", "channel", "counterparty_id", "device_id",
            "risk_score", "is_candidate", "reason_codes", "label", "case_id", "tier"]
    w.writerow(cols)
    for r in view["rows"]:
        w.writerow([_safe_cell(";".join(r[c]) if c == "reason_codes" else r[c]) for c in cols])
    return out.getvalue()


def template_csv() -> str:
    """A ready-to-upload sample built from the live synthetic dataset: one account-takeover burst on an
    existing customer, normal activity on another, and a brand-new customer."""
    base = get_base_services()
    repo = base.repo
    last = repo.transactions["timestamp"].max().normalize() + pd.Timedelta(days=1, hours=10)
    victim, normal = "CUST-000123", "CUST-000124"
    v_acc = repo.customer(victim)["account_id"]
    n = repo.customer(normal)
    hist = repo.customer_history(normal)
    familiar = hist["counterparty_id"].value_counts().index[0]
    median = float(hist["amount_paise"].median()) / 100
    v_median = float(repo.customer_history(victim)["amount_paise"].median()) / 100
    mule = sorted(e for e in repo.confirmed_fraud.index if e.startswith("RCP-MULE"))[0]
    rows = []

    def add(tid, cust, acc, ts, amt, ch, cp, dev, label):
        rows.append([tid, cust, acc, ts.strftime("%Y-%m-%dT%H:%M:%S"), f"{amt:.2f}", ch, cp, dev, label])

    for k in range(4):  # rapid small payments from a never-seen device
        add(f"TXN-UPL-ATK-{k + 1}", victim, v_acc, last + pd.Timedelta(minutes=2 * k), v_median * 0.6, "upi",
            f"RCP-UPL-{k + 1:02d}", "DEV-UPL-NEW1", 1)
    add("TXN-UPL-ATK-BIG", victim, v_acc, last + pd.Timedelta(minutes=9), v_median * 30, "imps", mule, "DEV-UPL-NEW1", 1)
    for k in range(4):
        add(f"TXN-UPL-OK-{k + 1}", normal, n["account_id"], last + pd.Timedelta(hours=1 + k), median * (0.8 + 0.1 * k),
            "upi", familiar, n["home_device"], 0)
    add("TXN-UPL-NEW-1", "CUST-UPL-NEW1", "ACC-UPL-NEW1", last + pd.Timedelta(hours=3), 2500, "upi", "MER-0001",
        "DEV-UPL-NEW2", 0)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["transaction_id", "customer_id", "account_id", "timestamp", "amount_rupees", "channel",
                "counterparty_id", "device_id", "is_fraud"])
    w.writerows(rows)
    return out.getvalue()
