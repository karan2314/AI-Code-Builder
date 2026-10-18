"""HTTP API (/api). Read endpoints are public (synthetic data); mutating endpoints are rate-limited."""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.api import ops
from app.cases import service
from app.config import settings
from app.data.generate import BENIGN_TXN, HERO_TXN
from app.ml.rules import describe
from app.schemas import AnalystAction, BatchScoreResult, Case, CaseCreate, ScoreResult, Transaction
from app.services import get_services

router = APIRouter(prefix="/api")

# ---- simple per-IP rate limiting for mutating endpoints ---------------------------------------------
_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def client_ip(request: Request) -> str:
    """Cloud Run's front end APPENDS the real client IP to X-Forwarded-For, so the LAST entry is trustworthy;
    earlier entries are client-supplied and can be spoofed to dodge rate limits."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[-1].strip()
    return request.client.host if request.client else "?"


def rate_limit(request: Request, cost: int = 1) -> None:
    ip = client_ip(request)
    now = time.time()
    with _hits_lock:
        q = _hits[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) + cost > settings.rate_limit_per_min:
            raise HTTPException(429, "Rate limit exceeded; please wait a minute")
        q.extend([now] * cost)


def _not_found(what: str) -> HTTPException:
    return HTTPException(404, f"{what} not found")


# ---- transactions -----------------------------------------------------------------------------------
@router.post("/transactions/score", response_model=ScoreResult)
def score_transaction(txn: Transaction, request: Request) -> ScoreResult:
    rate_limit(request)
    svc = get_services()
    if svc.repo.customer(txn.customer_id) is None:
        raise HTTPException(422, "unknown customer_id (synthetic dataset only)")
    if svc.repo.account(txn.account_id) is None:
        raise HTTPException(422, "unknown account_id")
    return svc.scorer.score_new(txn)


class BatchRequest(BaseModel):
    transactions: list[Transaction] = Field(default_factory=list, max_length=200)
    dataset: str | None = Field(default=None, pattern="^(all|test)$")


@router.post("/transactions/batch-score", response_model=BatchScoreResult)
def batch_score(body: BatchRequest, request: Request) -> BatchScoreResult:
    rate_limit(request, cost=max(1, len(body.transactions) // 20))
    return get_services().scorer.score_batch(body.transactions or None, body.dataset)


@router.get("/transactions/{transaction_id}")
def get_transaction(transaction_id: str) -> dict:
    svc = get_services()
    t = svc.repo.public_transaction(transaction_id)
    if t is None:
        raise _not_found("transaction")
    return {"transaction": t, "score": svc.scorer.score_existing(transaction_id)}


@router.get("/queue")
def queue(limit: int = 100) -> dict:
    svc = get_services()
    q = svc.scorer.queue(min(max(limit, 1), 300))
    cases = {c.transaction_id: c for c in svc.cases.list(500)}
    pinned = [HERO_TXN, BENIGN_TXN]
    items = []
    for tid, r in q.iterrows():
        c = cases.get(tid)
        items.append(ops.enrich({"transaction_id": tid, "customer_id": r["customer_id"], "timestamp": r["timestamp"].isoformat(),
                      "amount_rupees": round(r["amount_paise"] / 100, 2), "channel": r["channel"],
                      "counterparty_id": r["counterparty_id"], "risk_score": round(float(r["risk_score"]), 4),
                      "reason_codes": svc.scorer.score_existing(tid).reason_codes,
                      "case_id": c.case_id if c else None, "case_status": c.status if c else "new",
                      "tier": c.decision.tier if c and c.decision else None, "demo": tid in pinned}, c))
    items.sort(key=lambda i: (not i["demo"], i["timestamp"]), reverse=False)
    demo_first = [i for i in items if i["demo"]] + sorted([i for i in items if not i["demo"]],
                                                          key=lambda i: i["timestamp"], reverse=True)
    return {"items": demo_first, "threshold": svc.scorer.threshold, "model_version": svc.scorer.version}


@router.get("/reason-codes")
def reason_code_descriptions() -> dict:
    from app.ml.rules import INFO_CODES, RULES

    return {code: describe(code) for code in list(RULES) + list(INFO_CODES)}


# ---- customers ------------------------------------------------------------------------------------
@router.get("/customers/{customer_id}/profile")
def customer_profile(customer_id: str) -> dict:
    svc = get_services()
    c = svc.repo.customer(customer_id)
    if c is None:
        raise _not_found("customer")
    acc = svc.repo.account(c["account_id"])
    h = svc.repo.customer_history(customer_id)
    amt = h["amount_paise"] / 100
    return {"profile": c, "limits": {"txn_limit_rupees": acc["txn_limit_paise"] / 100,
                                     "daily_limit_rupees": acc["daily_limit_paise"] / 100},
            "baseline": {"transactions": int(len(h)), "median_rupees": round(float(amt.median()), 2) if len(h) else None,
                         "p95_rupees": round(float(amt.quantile(0.95)), 2) if len(h) else None,
                         "devices": h["device_id"].value_counts().head(5).to_dict(),
                         "channels": h["channel"].value_counts().to_dict()}}


@router.get("/customers/{customer_id}/history")
def customer_history(customer_id: str, days: int = 30) -> dict:
    svc = get_services()
    if svc.repo.customer(customer_id) is None:
        raise _not_found("customer")
    h = svc.repo.customer_history(customer_id)
    if len(h):
        h = h[h["timestamp"] >= h["timestamp"].max() - __import__("pandas").Timedelta(days=min(max(days, 1), 90))]
    rows = [{"transaction_id": r.transaction_id, "timestamp": r.timestamp.isoformat(),
             "amount_rupees": round(r.amount_paise / 100, 2), "channel": r.channel,
             "counterparty_id": r.counterparty_id, "device_id": r.device_id}
            for r in h.itertuples(index=False)]
    return {"customer_id": customer_id, "transactions": rows[-400:]}


# ---- network -------------------------------------------------------------------------------------
@router.get("/network/{entity_id}")
def network(entity_id: str, transaction_id: str | None = None) -> dict:
    svc = get_services()
    at = None
    if transaction_id:
        t = svc.repo.public_transaction(transaction_id)
        if t is None:
            raise _not_found("transaction")
        at = t["timestamp"]
    if entity_id not in svc.graph.g:
        raise _not_found("entity")
    return svc.graph.cytoscape(entity_id, at)


# ---- cases ---------------------------------------------------------------------------------------
def _case_out(case: Case) -> dict:
    out = case.model_dump(mode="json")
    out["audit"] = [a.model_dump(mode="json") for a in get_services().cases.audit(case.case_id)]
    out["priority"] = ops.priority(case.ml.risk_score, case.decision.tier if case.decision else None)
    out["sla"] = ops.sla(case.transaction["timestamp"], out["priority"], case.status)
    return out


@router.get("/cases")
def list_cases(limit: int = 50) -> dict:
    return {"items": [{"case_id": c.case_id, "transaction_id": c.transaction_id, "customer_id": c.customer_id,
                       "status": c.status, "tier": c.decision.tier if c.decision else None,
                       "updated_at": c.updated_at.isoformat()} for c in get_services().cases.list(min(limit, 200))]}


@router.post("/cases")
def create_case(body: CaseCreate, request: Request) -> dict:
    rate_limit(request)
    try:
        return _case_out(service.create_case(body.transaction_id))
    except service.CaseError as e:
        raise HTTPException(404, str(e)) from e


@router.get("/cases/{case_id}")
def get_case(case_id: str) -> dict:
    case = get_services().cases.get(case_id)
    if case is None:
        raise _not_found("case")
    return _case_out(case)


_running: set[str] = set()


def _run_investigation(case_id: str, cached: bool = False) -> None:
    try:
        (service.investigate_with_cache if cached else service.investigate)(case_id)
    except Exception as e:  # never leave a case stuck in "investigating"
        from app.observability import log_event

        log_event("investigation_crash", case_id=case_id, error=f"{type(e).__name__}: {e}")
        case = get_services().cases.get(case_id)
        if case is not None:
            case.status, case.ai_error = "manual_review", f"investigation failed: {type(e).__name__}"
            get_services().cases.save(case)
    finally:
        _running.discard(case_id)


@router.post("/cases/{case_id}/investigate")
def run_investigation(case_id: str, request: Request, cached: bool = False) -> dict:
    """Runs the investigation INSIDE the request (sync endpoint -> threadpool) so Cloud Run keeps CPU
    allocated with request-based billing (no always-on CPU cost). The UI polls GET /cases/{id} meanwhile
    for live progress. `cached=true` (demo) restores the last good AI result if live AI fails."""
    rate_limit(request, cost=3)
    case = get_services().cases.get(case_id)
    if case is None:
        raise _not_found("case")
    if case_id in _running or case.status == "investigating":
        raise HTTPException(409, "investigation already running")
    _running.add(case_id)
    _run_investigation(case_id, cached)
    return _case_out(get_services().cases.get(case_id))


@router.post("/cases/{case_id}/action")
def analyst_action(case_id: str, body: AnalystAction, request: Request) -> dict:
    rate_limit(request)
    try:
        return _case_out(service.record_analyst_action(case_id, body))
    except service.CaseError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/cases/{case_id}/export")
def export_case(case_id: str) -> dict:
    case = get_services().cases.get(case_id)
    if case is None:
        raise _not_found("case")
    return {"export_format": "fraudlens-case-v1", "synthetic_data": True, **_case_out(case)}


# ---- demo --------------------------------------------------------------------------------------
@router.post("/demo/{scenario}")
def demo(scenario: str, request: Request) -> dict:
    """Create (or reuse) the hero / benign demo case. Cost control: an already-investigated demo case is
    returned as-is (no new Gemini calls); the UI only starts an investigation when the case is still open."""
    rate_limit(request)
    tid = {"hero": HERO_TXN, "benign": BENIGN_TXN}.get(scenario)
    if tid is None:
        raise _not_found("scenario")
    case = service.create_case(tid)
    return {"case_id": case.case_id, "status": case.status, "needs_investigation": case.status == "open"}


# ---- metrics -----------------------------------------------------------------------------------
def _read_metrics(name: str) -> dict | None:
    p = Path(settings.metrics_dir) / name
    return json.loads(p.read_text()) if p.exists() else None


@router.get("/metrics")
def metrics() -> dict:
    svc = get_services()
    scored = svc.scorer.scored
    candidates = int((scored["risk_score"] >= svc.scorer.threshold).sum())
    cases = svc.cases.list(500)
    tiers = {1: 0, 2: 0, 3: 0}
    for c in cases:
        if c.decision:
            tiers[c.decision.tier] += 1
    investigated = [c for c in cases if c.decision]
    validity = [c.evidence_validity_rate for c in investigated if c.evidence_validity_rate is not None]
    # Analyst vs policy / AI agreement (the human-in-the-loop feedback loop). Overrides are logged with a reason.
    reviewed = [c.analyst_action for c in cases if c.analyst_action]
    finals = [(a, a.get("final_tier", service.analyst_final_tier(a.get("action", ""), a.get("tier"), a.get("policy_tier"))))
              for a in reviewed if a.get("action") in ("approve", "modify", "close")]
    pol = [(a, f) for a, f in finals if a.get("policy_tier") is not None]
    ai = [(a, f) for a, f in finals if a.get("ai_tier") is not None]
    return {
        "live": {
            "transactions_screened": int(len(scored)), "candidates": candidates,
            "candidate_rate": round(candidates / max(len(scored), 1), 5),
            "gemini_escalation_rate": round(candidates / max(len(scored), 1), 5),
            "open_cases": sum(1 for c in cases if c.status in ("open", "awaiting_review", "manual_review", "investigating")),
            "cases_investigated": len(investigated), "tier_distribution": tiers,
            "avg_evidence_validity_rate": round(sum(validity) / len(validity), 4) if validity else None,
            "single_score_latency": svc.scorer.latency_percentiles(),
            "case_store": svc.cases.backend + (" (degraded)" if svc.cases.degraded else ""),
            "ai_budget": service.ai_budget_status(),
            "analyst_review": {
                "cases_reviewed": len(finals),
                "overrides": sum(1 for a, f in pol if f != a["policy_tier"]),
                "policy_agreement_rate": round(sum(f == a["policy_tier"] for a, f in pol) / len(pol), 4) if pol else None,
                "ai_compared": len(ai),
                "ai_agreement_rate": round(sum(f == a["ai_tier"] for a, f in ai) / len(ai), 4) if ai else None,
            },
        },
        "detection": _read_metrics("detection_metrics.json"),
        "benchmark": _read_metrics("benchmark.json"),
        "agentic": _read_metrics("agentic_eval.json"),
    }
