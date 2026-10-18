"""Operations views: overview KPIs, alert priority + SLA, deterministic insights, search, audit log, controls.

Every number here is computed from the synthetic dataset or the case store; nothing is estimated or generated
by an LLM. "Now" is the dataset clock (the latest screened transaction), so 24h windows and SLA timers are
reproducible. SLA targets and analyst names are prototype operating values.
"""

from __future__ import annotations

import re
from dataclasses import asdict
from functools import lru_cache

import pandas as pd
from fastapi import APIRouter, HTTPException, Request

from app.ai import laya_client
from app.cases import service
from app.config import settings
from app.ml.rules import describe
from app.policy.engine import POLICY_VERSION, TIER_ACTIONS, TIER_NAMES, PolicyConfig
from app.schemas import ANALYSTS, Case, CaseAssign, QuickAction
from app.services import get_services

router = APIRouter(prefix="/api")

HIGH_RISK = 0.85
P2_MIN = 0.77
SLA_MINUTES = {"P1": 12 * 60, "P2": 24 * 60, "P3": 48 * 60}
DONE = ("approved", "modified", "closed")
POLICY_RULES = {
    "R1": "Confirmed fraud link (direct or within 2 hops) plus another suspicious family → Tier 3 Contain",
    "R2": "Three or more critical indicator families → Tier 3 Contain",
    "R3": "Two independent critical families → Tier 2 Verify",
    "R4": "Single signal or ML score only → Tier 1 Monitor",
    "R5": "ML score and evidence conflict → review required, Tier 3 capped at 2 (unless R1)",
    "R6": "Stale fraud link → must be re-validated, never justifies containment",
    "R7": "Limited history → cohort baseline, stricter amount threshold, review required",
    "R8": "No AI summary → manual review (deterministic evidence kept)",
}
AUTONOMY = {1: "Manual: analyst investigates", 2: "AI investigates, human decides",
            3: "AI recommends, sampled human review", 4: "Auto-close within guardrails"}


# ---- shared helpers --------------------------------------------------------------------------------
@lru_cache
def _frame() -> pd.DataFrame:
    svc = get_services()
    cols = ["risk_score", "device_other_customers", "cnt_10m", "cp_fraud_confirmed", "cp_linked_fraud", "cp_new",
            "amt_ratio_median"]
    tx = svc.repo.transactions.set_index("transaction_id")[["timestamp", "amount_paise", "customer_id"]]
    return svc.scorer.scored[cols].join(tx)


def as_of() -> pd.Timestamp:
    return _frame()["timestamp"].max()


def priority(risk_score: float, tier: int | None) -> str:
    if tier:
        return {3: "P1", 2: "P2", 1: "P3"}[tier]
    return "P1" if risk_score >= HIGH_RISK else "P2" if risk_score >= P2_MIN else "P3"


def sla(alert_ts: pd.Timestamp, prio: str, case_status: str | None) -> dict:
    target = SLA_MINUTES[prio]
    if case_status in DONE:
        return {"target_minutes": target, "remaining_minutes": None, "state": "resolved"}
    remaining = int(target - (as_of() - pd.Timestamp(alert_ts)).total_seconds() // 60)
    state = "breached" if remaining < 0 else "at_risk" if remaining < target * 0.25 else "on_track"
    return {"target_minutes": target, "remaining_minutes": remaining, "state": state}


def enrich(item: dict, case: Case | None) -> dict:
    tier = case.decision.tier if case and case.decision else None
    p = priority(item["risk_score"], tier)
    return {**item, "priority": p, "sla": sla(pd.Timestamp(item["timestamp"]), p, case.status if case else None),
            "assignee": case.assignee if case else None}


def _candidates(start: pd.Timestamp, end: pd.Timestamp) -> pd.DataFrame:
    f = _frame()
    thr = get_services().scorer.threshold
    return f[(f["timestamp"] > start) & (f["timestamp"] <= end) & (f["risk_score"] >= thr)]


def _pair(cur: float, prev: float) -> dict:
    return {"value": cur, "previous": prev, "delta": cur - prev}


# ---- overview --------------------------------------------------------------------------------------
@router.get("/overview")
def overview() -> dict:
    svc = get_services()
    laya_client.warm()  # analysts are on the dashboard: keep the advisory Laya model warm (throttled, async)
    f, now = _frame(), as_of()
    day, two = now - pd.Timedelta(hours=24), now - pd.Timedelta(hours=48)
    cur, prev = _candidates(day, now), _candidates(two, day)
    cases = {c.transaction_id: c for c in svc.cases.list(500)}
    closed = {t for t, c in cases.items() if c.status == "closed"}
    done = {t for t, c in cases.items() if c.status in DONE}

    def exposure(df: pd.DataFrame) -> float:
        return round(float(df[~df.index.isin(closed)]["amount_paise"].sum()) / 100, 2)

    # SLA state over the open alert queue (last 7 days of alerts)
    week = _candidates(now - pd.Timedelta(days=7), now)
    states = {"on_track": 0, "at_risk": 0, "breached": 0, "resolved": 0}
    prio_mix = {"P1": 0, "P2": 0, "P3": 0}
    for tid, r in week.iterrows():
        c = cases.get(tid)
        p = priority(float(r["risk_score"]), c.decision.tier if c and c.decision else None)
        prio_mix[p] += 1
        states[sla(r["timestamp"], p, c.status if c else None)["state"]] += 1

    screened_cur = int(((f["timestamp"] > day) & (f["timestamp"] <= now)).sum())
    screened_prev = int(((f["timestamp"] > two) & (f["timestamp"] <= day)).sum())
    return {
        "as_of": now.isoformat(), "window_hours": 24,
        "kpis": {
            "high_risk_alerts": _pair(int((cur["risk_score"] >= HIGH_RISK).sum()), int((prev["risk_score"] >= HIGH_RISK).sum())),
            "potential_exposure_rupees": _pair(exposure(cur), exposure(prev)),
            "nearing_sla": {"value": states["at_risk"], "breached": states["breached"]},
            "awaiting_review": _pair(int((~cur.index.isin(done)).sum()), len(prev)),
            "transactions_screened": _pair(screened_cur, screened_prev),
        },
        "alert_rate_24h": round(len(cur) / max(screened_cur, 1), 5),
        "priority_mix_7d": prio_mix, "sla_states_7d": states,
        "insights": insights(),
    }


def insights() -> list[dict]:
    """Deterministic pattern counts over alerts: last 7 days vs the 7 days before (dataset clock)."""
    now = as_of()
    cur = _candidates(now - pd.Timedelta(days=7), now)
    prev = _candidates(now - pd.Timedelta(days=14), now - pd.Timedelta(days=7))
    specs = [
        ("shared_device", "Shared-device alerts", "alerts on devices shared with other customers",
         lambda d: d["device_other_customers"] > 0, "high"),
        ("fraud_link", "Linked to confirmed fraud", "alerts paying recipients linked to confirmed fraud",
         lambda d: (d["cp_fraud_confirmed"] > 0) | (d["cp_linked_fraud"] > 0), "high"),
        ("velocity", "Velocity spikes", "customers with 3+ payments in 10 minutes",
         lambda d: d["cnt_10m"] >= 3, "medium"),
        ("new_payee_high_value", "High-value payments to new payees", "alerts ≥ 5× the customer's median to a new payee",
         lambda d: (d["cp_new"] > 0) & (d["amt_ratio_median"] >= 5), "medium"),
    ]
    out = []
    for key, title, what, mask, sev in specs:
        if key == "velocity":
            n, p = cur[mask(cur)]["customer_id"].nunique(), prev[mask(prev)]["customer_id"].nunique()
        else:
            n, p = int(mask(cur).sum()), int(mask(prev).sum())
        change = None if p == 0 else round((n - p) / p, 3)
        out.append({"id": key, "title": title, "count": int(n), "previous": int(p), "change": change,
                    "detail": f"{n} {what} in the last 7 days (previous 7 days: {p})", "severity": sev})
    return sorted(out, key=lambda i: -i["count"])


# ---- assignment & quick actions ----------------------------------------------------------------------
def _rate_limit(request: Request) -> None:
    from app.api.routes import rate_limit

    rate_limit(request)


def _case_out(case: Case) -> dict:
    from app.api.routes import _case_out as out

    return out(case)


@router.get("/analysts")
def analysts() -> dict:
    return {"items": list(ANALYSTS)}


@router.post("/cases/{case_id}/assign")
def assign(case_id: str, body: CaseAssign, request: Request) -> dict:
    _rate_limit(request)
    try:
        return _case_out(service.assign_case(case_id, body.assignee))
    except service.CaseError as e:
        raise HTTPException(404, str(e)) from e


@router.post("/cases/{case_id}/quick-action")
def quick_action(case_id: str, body: QuickAction, request: Request) -> dict:
    _rate_limit(request)
    try:
        return _case_out(service.quick_action(case_id, body.action, body.note))
    except service.CaseError as e:
        raise HTTPException(409, str(e)) from e


# ---- cases list, search, audit log, controls ------------------------------------------------------------
@router.get("/cases-board")
def cases_board(limit: int = 100) -> dict:
    items = []
    for c in get_services().cases.list(min(max(limit, 1), 300)):
        tier = c.decision.tier if c.decision else None
        p = priority(c.ml.risk_score, tier)
        items.append({"case_id": c.case_id, "transaction_id": c.transaction_id, "customer_id": c.customer_id,
                      "status": c.status, "tier": tier, "priority": p, "risk_score": c.ml.risk_score,
                      "amount_rupees": round(float(c.transaction.get("amount_paise", 0)) / 100, 2),
                      "assignee": c.assignee, "investigation_mode": c.investigation_mode,
                      "override": bool(c.analyst_action and c.analyst_action.get("override")),
                      "sla": sla(pd.Timestamp(c.transaction["timestamp"]), p, c.status),
                      "updated_at": c.updated_at.isoformat()})
    return {"items": items}


_ID = re.compile(r"^[A-Za-z0-9-]{3,40}$")


@router.get("/search")
def search(q: str) -> dict:
    q = q.strip().upper()
    if not _ID.match(q):
        return {"items": []}
    svc = get_services()
    items: list[dict] = []
    for c in svc.cases.list(500):
        if q in (c.case_id, c.transaction_id) or c.case_id.startswith(q) or c.customer_id == q:
            items.append({"kind": "case", "id": c.case_id, "label": f"{c.case_id} · {c.transaction_id}",
                          "case_id": c.case_id})
    t = svc.repo.public_transaction(q)
    if t is not None and not any(i.get("id") == q for i in items):
        existing = svc.cases.find_by_transaction(q)
        items.append({"kind": "transaction", "id": q, "label": f"{q} · ₹{t['amount_paise'] / 100:,.0f}",
                      "case_id": existing.case_id if existing else None})
    for cid in [c for c in svc.repo.customers.index if c.startswith(q)][:5]:
        items.append({"kind": "customer", "id": cid, "label": cid, "case_id": None})
    for eid in [e for e in svc.repo.counterparties.index if e.startswith(q)][:3]:
        items.append({"kind": "entity", "id": eid, "label": eid, "case_id": None})
    return {"items": items[:12]}


@router.get("/audit")
def audit_log(limit: int = 200) -> dict:
    svc = get_services()
    events = []
    for c in svc.cases.list(50):
        events.extend(svc.cases.audit(c.case_id))
    events.sort(key=lambda e: e.timestamp, reverse=True)
    return {"items": [e.model_dump(mode="json") for e in events[: min(max(limit, 1), 500)]]}


@router.get("/controls")
def controls() -> dict:
    s = get_services().scorer
    from app.ml.rules import INFO_CODES, RULES

    return {
        "model": {"version": s.version, "threshold": s.threshold, "blend": s.blend},
        "reason_codes": {code: describe(code) for code in list(RULES) + list(INFO_CODES)},
        "policy": {"version": POLICY_VERSION, "config": asdict(PolicyConfig()), "rules": POLICY_RULES,
                   "tiers": {t: {"name": TIER_NAMES[t], "actions": TIER_ACTIONS[t]} for t in (1, 2, 3)}},
        "decision_model": {"name": "Laya (open-weight typed decision model)", "enabled": settings.enable_laya,
                           "role": "Advisory triage (route, P(account takeover), P(mule payment)); recorded as "
                                   "ML-family evidence and compared with the policy tier, never used to set it."},
        "autonomy": {"current_level": 2, "levels": AUTONOMY,
                     "ceilings": {"1": 3, "2": 2, "3": 2}},
        "operations": {"priority_bands": {"P1": f"Tier 3, or risk ≥ {int(HIGH_RISK * 1000)}",
                                          "P2": f"Tier 2, or risk ≥ {int(P2_MIN * 1000)}",
                                          "P3": "Tier 1, or any other alert"},
                       "sla_minutes": SLA_MINUTES, "analysts": list(ANALYSTS)},
    }
