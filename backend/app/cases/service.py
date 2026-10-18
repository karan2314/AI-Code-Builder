"""Case lifecycle: create from candidate -> investigate (agentic or deterministic fallback) ->
Gemini synthesis -> policy decision -> simulated action -> persisted case + append-only audit trail."""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from datetime import UTC, datetime

from google.genai import types

from app.agents.context import InvestigationContext
from app.agents.fraudlens.prompts import PROMPT_VERSION
from app.ai.synthesis import build_evidence_package, synthesize_grounded, validate_citations
from app.config import settings
from app.observability import log_event
from app.policy.engine import POLICY_VERSION, decide
from app.schemas import AnalystAction, Case
from app.services import get_services

SYSTEM = "system"
DEMO_ANALYST = "analyst:demo"


class CaseError(ValueError):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def create_case(transaction_id: str) -> Case:
    svc = get_services()
    existing = svc.cases.find_by_transaction(transaction_id)
    if existing:
        return existing
    txn = svc.repo.public_transaction(transaction_id)
    if txn is None:
        raise CaseError(f"unknown transaction {transaction_id}")
    ml = svc.scorer.score_existing(transaction_id)
    case = Case(case_id=f"CASE-{uuid.uuid4().hex[:8].upper()}", transaction_id=transaction_id,
                customer_id=txn["customer_id"], status="open", created_at=_now(), updated_at=_now(),
                transaction={**txn, "timestamp": txn["timestamp"].isoformat()}, ml=ml,
                versions={"model": ml.model_version, "policy": POLICY_VERSION, "prompt": PROMPT_VERSION,
                          "gemini_model": settings.gemini_model})
    svc.cases.save(case)
    svc.cases.append_audit(case.case_id, "case_created", SYSTEM, {"transaction_id": transaction_id,
                                                                    "risk_score": ml.risk_score,
                                                                    "reason_codes": ml.reason_codes})
    return case


def _deterministic_investigation(ctx: InvestigationContext, txn: dict) -> None:
    """Fallback (and test double): call the same tools in a fixed order."""
    a, tid = "deterministic_fallback", txn["transaction_id"]
    ctx.run_tool(a, "calculate_customer_deviation", customer_id=txn["customer_id"], transaction_id=tid)
    ctx.run_tool(a, "get_transaction_history", customer_id=txn["customer_id"], transaction_id=tid, days=90)
    ctx.run_tool(a, "get_account_limits", account_id=txn["account_id"], transaction_id=tid)
    ctx.run_tool(a, "calculate_velocity", transaction_id=tid)
    ctx.run_tool(a, "get_device_history", device_id=txn["device_id"], transaction_id=tid)
    ctx.run_tool(a, "get_merchant_history", customer_id=txn["customer_id"], counterparty_id=txn["counterparty_id"],
                 transaction_id=tid)
    net = ctx.run_tool(a, "analyze_fraud_network", transaction_id=tid)
    entities = [txn["counterparty_id"], txn["device_id"]]
    for ev in net.get("evidence", []):
        for node in (ev.get("observed", {}).get("path") or [])[1:]:
            if node not in entities and len(entities) < 10:
                entities.append(node)
    ctx.run_tool(a, "search_known_fraud_cases", entity_ids=entities, transaction_id=tid)
    if settings.enable_laya:
        ctx.run_tool(a, "get_laya_decision", transaction_id=tid)


async def _agentic_investigation(ctx: InvestigationContext, txn: dict, ml) -> dict:
    from google.adk.agents.run_config import RunConfig
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService

    from app.agents.fraudlens.agent import build_root_agent

    session_service = InMemorySessionService()
    runner = Runner(app_name="fraudlens", agent=build_root_agent(), session_service=session_service)
    session = await session_service.create_session(app_name="fraudlens", user_id=DEMO_ANALYST,
                                                   state={"case_id": ctx.case_id})
    brief = {k: txn[k] for k in ("transaction_id", "customer_id", "account_id", "device_id", "counterparty_id",
                                 "channel")}
    brief.update(amount_rupees=round(txn["amount_paise"] / 100, 2), risk_score=ml.risk_score,
                 reason_codes=ml.reason_codes, top_features=[f.name for f in ml.top_features])
    msg = types.Content(role="user", parts=[types.Part(text=f"Investigate this flagged transaction: {brief}")])
    final = ""
    t0 = time.perf_counter()
    async for event in runner.run_async(user_id=DEMO_ANALYST, session_id=session.id, new_message=msg,
                                        run_config=RunConfig(max_llm_calls=30)):
        if event.content and event.content.parts and event.author == "fraudlens_orchestrator":
            text = "".join(p.text or "" for p in event.content.parts if getattr(p, "text", None))
            if text:
                final = text
    # usage from all agents (orchestrator + specialists) collected by the after_model_callback
    tokens = {"input_tokens": 0, "output_tokens": 0, "thinking_tokens": 0, "llm_calls": 0, **ctx.usage}
    tokens["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    log_event("llm_call", case_id=ctx.case_id, step="agents", model=settings.gemini_model, **tokens)
    return {"orchestrator_note": final[:500], **tokens}


_ai_budget = {"day": None, "used": 0}
_ai_budget_lock = threading.Lock()


def _consume_ai_budget() -> bool:
    """Per-instance daily cap on AI investigations (bounds Gemini cost; max-instances bounds the total)."""
    today = datetime.now(UTC).date()
    with _ai_budget_lock:
        if _ai_budget["day"] != today:
            _ai_budget["day"], _ai_budget["used"] = today, 0
        if _ai_budget["used"] >= settings.max_ai_investigations_per_day:
            return False
        _ai_budget["used"] += 1
        return True


def ai_budget_status() -> dict:
    return {"used_today": _ai_budget["used"], "daily_cap_per_instance": settings.max_ai_investigations_per_day}


def investigate(case_id: str, use_ai: bool | None = None) -> Case:
    """Run the full investigation synchronously (the API calls it inside the request)."""
    svc = get_services()
    case = svc.cases.get(case_id)
    if case is None:
        raise CaseError(f"unknown case {case_id}")
    use_ai = settings.gemini_enabled if use_ai is None else use_ai
    budget_exhausted = False
    if use_ai and not _consume_ai_budget():
        use_ai, budget_exhausted = False, True
        log_event("ai_budget_exhausted", case_id=case_id, **ai_budget_status())
    txn = svc.repo.public_transaction(case.transaction_id)

    def progress(msg: str) -> None:
        case.progress.append(msg)
        case.updated_at = _now()
        svc.cases.save(case)

    case.status, case.progress, case.trajectory, case.evidence = "investigating", [], [], []
    case.summary, case.decision, case.ai_error, case.simulated_actions = None, None, None, []
    case.investigation_mode, case.usage, case.evidence_validity_rate, case.dropped_findings = "none", {}, None, 0
    case.analyst_action = None
    svc.cases.save(case)
    if budget_exhausted:
        case.ai_error = "daily AI investigation budget reached (cost control); deterministic investigation used"
    svc.cases.append_audit(case_id, "investigation_started", SYSTEM,
                           {"ai_enabled": use_ai, "ai_budget_exhausted": budget_exhausted})

    t_start = time.perf_counter()
    with InvestigationContext(case_id, txn, progress_cb=progress) as ctx:
        usage: dict = {}
        if use_ai:
            progress("orchestrator:planning")
            try:
                usage["agents"] = asyncio.run(asyncio.wait_for(_agentic_investigation(ctx, txn, case.ml),
                                                               timeout=settings.investigation_timeout_s))
                case.investigation_mode = "agentic"
            except Exception as e:
                case.ai_error = f"agents: {type(e).__name__}: {str(e)[:200]}"
                log_event("agent_failure", case_id=case_id, error=case.ai_error)
        # Ensure the minimum evidence set exists even if agents skipped tools or failed
        have = {e.source_tool for e in ctx.evidence if e.status == "ok"}
        required = {"calculate_customer_deviation", "analyze_fraud_network", "search_known_fraud_cases"}
        if not use_ai or case.investigation_mode != "agentic" or not required <= have:
            if case.investigation_mode != "agentic":
                case.investigation_mode = "deterministic_fallback"
            progress("deterministic:evidence_completion")
            if have:
                _complete_missing(ctx, txn, have)
            else:
                _deterministic_investigation(ctx, txn)

        # Variant C: make sure the advisory Laya triage is present when enabled (agents may skip it)
        if settings.enable_laya and "get_laya_decision" not in {e.source_tool for e in ctx.evidence}:
            ctx.run_tool("deterministic_fallback", "get_laya_decision", transaction_id=txn["transaction_id"])

        case.evidence = list(ctx.evidence)
        case.trajectory = list(ctx.trajectory)
        svc.cases.append_audit(case_id, "evidence_collected", SYSTEM,
                               {"evidence_ids": [e.id for e in case.evidence], "mode": case.investigation_mode,
                                "agents": sorted(ctx.agents_invoked)})

        summary = None
        if use_ai:
            progress("synthesis:gemini")
            try:
                package = build_evidence_package(case_id, txn, case.ml, case.evidence)
                raw, usage["synthesis"] = synthesize_grounded(package, case_id, {e.id for e in case.evidence})
                summary, rate, dropped = validate_citations(raw, {e.id for e in case.evidence})
                case.evidence_validity_rate, case.dropped_findings = rate, dropped
                if dropped:
                    log_event("evidence_validity_violation", case_id=case_id, dropped=dropped)
            except Exception as e:
                case.ai_error = (case.ai_error + " | " if case.ai_error else "") + f"synthesis: {type(e).__name__}: {str(e)[:200]}"
                log_event("synthesis_failure", case_id=case_id, error=case.ai_error)
        case.summary = summary

        progress("policy:decide")
        case.decision = decide(case.evidence, summary, case.ml)
        svc.cases.append_audit(case_id, "policy_decision", SYSTEM, case.decision.model_dump(mode="json"))
        if summary:
            svc.cases.append_audit(case_id, "ai_summary", f"agent:{settings.gemini_model_synth}",
                                   {"pattern": summary.pattern, "recommended_tier": summary.recommended_tier,
                                    "confidence": summary.confidence, "evidence_validity_rate": case.evidence_validity_rate})

        # Simulated response for the policy tier (never a real action)
        for action in case.decision.allowed_actions:
            rec = {"action": action, "simulated": True, "tier": case.decision.tier, "at": _now().isoformat(),
                   "account_id": txn["account_id"], "label": "SIMULATED - no real account was affected"}
            case.simulated_actions.append(rec)
            svc.cases.append_audit(case_id, "simulated_action", f"policy:{POLICY_VERSION}", rec)

        case.usage = {**usage, "total_latency_ms": round((time.perf_counter() - t_start) * 1000, 1)}
        case.status = "manual_review" if case.decision.manual_review else "awaiting_review"
        progress("persisted")
    svc.cases.save(case)
    log_event("investigation_complete", case_id=case_id, mode=case.investigation_mode, tier=case.decision.tier,
              latency_ms=case.usage["total_latency_ms"], validity=case.evidence_validity_rate)
    return case


def investigate_with_cache(case_id: str, use_ai: bool | None = None) -> Case:
    """Demo resilience: if live AI fails on re-run but this case previously had a good agentic result,
    restore that result (clearly labelled) instead of showing a degraded case to judges."""
    svc = get_services()
    before = svc.cases.get(case_id)
    good = before if before and before.summary is not None and before.investigation_mode == "agentic" else None
    case = investigate(case_id, use_ai=use_ai)
    if case.summary is None and good is not None:
        restored = good.model_copy(update={
            "updated_at": _now(), "status": "awaiting_review", "analyst_action": None,
            "progress": good.progress + ["restored:last_good_ai_result"],
            "ai_error": f"live AI unavailable ({case.ai_error}); showing last good AI result from {good.updated_at.isoformat()}",
        })
        svc.cases.save(restored)
        svc.cases.append_audit(case_id, "restored_last_good_result", SYSTEM, {"reason": case.ai_error})
        return restored
    return case


def _complete_missing(ctx: InvestigationContext, txn: dict, have: set[str]) -> None:
    a, tid = "deterministic_fallback", txn["transaction_id"]
    if "calculate_customer_deviation" not in have:
        ctx.run_tool(a, "calculate_customer_deviation", customer_id=txn["customer_id"], transaction_id=tid)
    if "analyze_fraud_network" not in have:
        ctx.run_tool(a, "analyze_fraud_network", transaction_id=tid)
    if "search_known_fraud_cases" not in have:
        ctx.run_tool(a, "search_known_fraud_cases", entity_ids=[txn["counterparty_id"], txn["device_id"]],
                     transaction_id=tid)


def record_analyst_action(case_id: str, action: AnalystAction, actor: str = DEMO_ANALYST) -> Case:
    svc = get_services()
    case = svc.cases.get(case_id)
    if case is None:
        raise CaseError(f"unknown case {case_id}")
    if case.status in ("open", "investigating"):
        raise CaseError("case has not been investigated yet")
    if action.action == "modify" and (action.tier is None or not action.reason.strip()):
        raise CaseError("modify requires a tier and a reason")
    case.status = {"approve": "approved", "modify": "modified", "close": "closed"}[action.action]
    case.analyst_action = {**action.model_dump(), "actor": actor, "at": _now().isoformat(),
                           "policy_tier": case.decision.tier if case.decision else None}
    case.updated_at = _now()
    svc.cases.save(case)
    svc.cases.append_audit(case_id, f"analyst_{action.action}", actor, case.analyst_action)
    return case
