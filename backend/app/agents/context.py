"""Investigation context: evidence capture, trajectory, tool budget and the tool guard.

Used by both the ADK agents (through callbacks) and the deterministic fallback, so evidence is
produced identically either way. Evidence IDs are assigned here: EV-<case-suffix>-<n>.
"""

from __future__ import annotations

import contextvars
import threading
import time
from datetime import UTC, datetime
from typing import Any

from app.config import settings
from app.observability import log_event
from app.schemas import Evidence, TrajectoryStep
from app.tools import ACTION_TOOLS, ALL_TOOLS
from app.tools.common import ToolInputError, validate_args

TOOL_FAMILY = {
    "get_customer_profile": "context", "get_transaction_history": "context", "get_account_limits": "behavior",
    "calculate_customer_deviation": "behavior", "calculate_velocity": "velocity", "get_device_history": "device",
    "get_merchant_history": "behavior", "get_ml_risk_score": "ml", "get_related_accounts": "network",
    "search_known_fraud_cases": "network", "analyze_fraud_network": "network", "get_laya_decision": "ml",
}

_registry: dict[str, InvestigationContext] = {}
_current: contextvars.ContextVar[InvestigationContext | None] = contextvars.ContextVar("fraudlens_ctx", default=None)
_lock = threading.Lock()


class InvestigationContext:
    def __init__(self, case_id: str, transaction: dict, progress_cb=None) -> None:
        self.case_id = case_id
        self.transaction = transaction
        self.evidence: list[Evidence] = []
        self.trajectory: list[TrajectoryStep] = []
        self.calls = 0
        self._seq = 0
        self._starts: dict[str, float] = {}
        self.progress_cb = progress_cb
        self.agents_invoked: set[str] = set()
        self.usage: dict[str, int] = {}

    # ---- registry ------------------------------------------------------------------------------
    def __enter__(self) -> InvestigationContext:
        _registry[self.case_id] = self
        self._token = _current.set(self)
        return self

    def __exit__(self, *exc) -> None:
        _registry.pop(self.case_id, None)
        _current.reset(self._token)

    @staticmethod
    def lookup(case_id: str | None) -> InvestigationContext | None:
        if case_id and case_id in _registry:
            return _registry[case_id]
        return _current.get()

    # ---- evidence ------------------------------------------------------------------------------
    def _next_id(self) -> str:
        with _lock:
            self._seq += 1
            return f"EV-{self.case_id.removeprefix('CASE-')}-{self._seq:02d}"

    def add_evidence(self, tool: str, item: dict[str, Any]) -> Evidence:
        ev = Evidence(id=self._next_id(), case_id=self.case_id, source_tool=tool, kind=item["kind"],
                      indicator_family=item.get("indicator_family", TOOL_FAMILY.get(tool, "context")),
                      summary=item["summary"], observed=item.get("observed", {}), baseline=item.get("baseline"),
                      status=item.get("status", "ok"), created_at=datetime.now(UTC))
        self.evidence.append(ev)
        return ev

    def add_unavailable(self, tool: str, reason: str) -> Evidence:
        return self.add_evidence(tool, {"kind": f"{tool}_unavailable", "indicator_family": TOOL_FAMILY.get(tool, "context"),
                                        "summary": f"{tool} unavailable: {reason[:120]}", "status": "unavailable",
                                        "observed": {"error": reason[:200]}})

    def progress(self, msg: str) -> None:
        if self.progress_cb:
            self.progress_cb(msg)

    # ---- guard + recording ---------------------------------------------------------------------
    def guard(self, tool: str, args: dict[str, Any]) -> str | None:
        """Return an error message if the call must be blocked, else None."""
        if tool in ACTION_TOOLS:
            return "action tools are not available to agents; the policy engine decides actions"
        if tool not in ALL_TOOLS:
            return f"unknown tool {tool}"
        if tool == "get_laya_decision" and not settings.enable_laya:
            return "Laya decision model is disabled"
        if self.calls >= settings.max_tool_calls:
            return "tool budget exhausted; summarize with the evidence already collected"
        try:
            validate_args(args)
        except ToolInputError as e:
            return str(e)
        return None

    def start(self, call_key: str) -> None:
        self.calls += 1
        self._starts[call_key] = time.perf_counter()

    def record(self, agent: str, tool: str, args: dict, status: str, call_key: str,
               evidence_ids: list[str]) -> None:
        latency = (time.perf_counter() - self._starts.pop(call_key, time.perf_counter())) * 1000
        step = TrajectoryStep(step=len(self.trajectory) + 1, agent=agent, tool=tool,
                              args={k: v for k, v in args.items() if k != "tool_context"}, status=status,
                              latency_ms=round(latency, 1), evidence_ids=evidence_ids, at=datetime.now(UTC))
        self.trajectory.append(step)
        self.agents_invoked.add(agent)
        log_event("tool_call", case_id=self.case_id, agent=agent, tool=tool, status=status, latency_ms=step.latency_ms)
        self.progress(f"tool:{agent}:{tool}:{status}")

    def capture(self, agent: str, tool: str, args: dict, response: dict, call_key: str) -> dict:
        """Convert a tool response into evidence; return the compact response the LLM sees."""
        ids = [self.add_evidence(tool, item).id for item in response.get("evidence", [])]
        self.record(agent, tool, args, "ok", call_key, ids)
        evs = [e for e in self.evidence if e.id in ids]
        return {"status": "ok", "evidence": [{"id": e.id, "kind": e.kind, "summary": e.summary,
                                              "observed": e.observed, "baseline": e.baseline, "status": e.status}
                                             for e in evs]}

    def fail(self, agent: str, tool: str, args: dict, error: str, call_key: str, blocked: bool = False) -> dict:
        ids = [] if blocked else [self.add_unavailable(tool, error).id]
        self.record(agent, tool, args, "blocked" if blocked else "error", call_key, ids)
        return {"status": "blocked" if blocked else "unavailable", "error": error, "evidence_ids": ids}

    def run_tool(self, agent: str, tool: str, **args: Any) -> dict:
        """Deterministic path: guard, run, capture."""
        key = f"{tool}-{self.calls}-{time.perf_counter_ns()}"
        blocked = self.guard(tool, args)
        if blocked:
            return self.fail(agent, tool, args, blocked, key, blocked=True)
        self.start(key)
        try:
            response = ALL_TOOLS[tool](**args)
        except Exception as e:  # tool failure -> evidence marked unavailable, never inferred
            return self.fail(agent, tool, args, f"{type(e).__name__}: {e}", key)
        return self.capture(agent, tool, args, response, key)
