"""Gemini evidence synthesis: bounded evidence package -> InvestigationSummary -> citation validation."""

from __future__ import annotations

import json
import time

from google.genai import types

from app.agents.fraudlens.prompts import PROMPT_VERSION, SYNTHESIS_PROMPT
from app.ai.client import get_client
from app.config import settings
from app.observability import log_event
from app.schemas import Evidence, InvestigationSummary, ScoreResult

MAX_PACKAGE_CHARS = 24_000  # ~6-8k tokens


def build_evidence_package(case_id: str, txn: dict, ml: ScoreResult, evidence: list[Evidence]) -> str:
    """Only pseudonymous IDs, tool-computed values and statuses. No raw history rows, no PII."""
    package = {
        "case_id": case_id,
        "transaction": {"transaction_id": txn["transaction_id"], "customer_id": txn["customer_id"],
                        "amount_rupees": round(txn["amount_paise"] / 100, 2), "channel": txn["channel"],
                        "counterparty_id": txn["counterparty_id"], "device_id": txn["device_id"],
                        "timestamp": str(txn["timestamp"])},
        "first_stage": {"risk_score": ml.risk_score, "reason_codes": ml.reason_codes, "model_version": ml.model_version},
        "evidence": [{"id": e.id, "source_tool": e.source_tool, "kind": e.kind, "family": e.indicator_family,
                      "status": e.status, "summary": e.summary, "observed": e.observed, "baseline": e.baseline}
                     for e in evidence],
    }
    text = json.dumps(package, default=str)
    if len(text) > MAX_PACKAGE_CHARS:  # trim verbose observed payloads but never truncate mid-JSON
        for item in package["evidence"]:
            item.pop("baseline", None)
            item["observed"] = {k: v for k, v in item["observed"].items() if not isinstance(v, list | dict)}
        text = json.dumps(package, default=str)
    ids = ", ".join(e.id for e in evidence)
    return (f"<evidence_package>\n{text}\n</evidence_package>\n"
            f"<valid_evidence_ids>{ids}</valid_evidence_ids>\n"
            "Cite ONLY IDs from valid_evidence_ids, copied exactly.")


def invalid_citations(summary: InvestigationSummary, evidence_ids: set[str]) -> list[str]:
    return sorted({i for f in summary.findings for i in f.evidence_ids if i not in evidence_ids})


def validate_citations(summary: InvestigationSummary, evidence_ids: set[str]) -> tuple[InvestigationSummary, float, int]:
    """Drop findings that cite unknown evidence IDs; return (clean summary, validity rate, dropped count)."""
    kept, total_claims, valid_claims = [], 0, 0
    for f in summary.findings:
        total_claims += 1
        cited = [i for i in f.evidence_ids if i in evidence_ids]
        if cited and len(cited) == len(f.evidence_ids):
            valid_claims += 1
            kept.append(f)
        elif cited:  # partially valid: keep only valid references but count as invalid claim
            kept.append(f.model_copy(update={"evidence_ids": cited}))
    dropped = total_claims - len(kept)
    rate = round(valid_claims / total_claims, 4) if total_claims else 0.0
    clean = summary.model_copy(update={"findings": kept})
    if total_claims and (total_claims - valid_claims) / total_claims > 0.2:
        clean = clean.model_copy(update={"confidence": "low"})
    clean = clean.model_copy(update={"conflicting_evidence": clean.conflicting_evidence[:6],
                                     "missing_evidence": clean.missing_evidence[:6]})
    return clean, rate, dropped


def synthesize_grounded(package: str, case_id: str, evidence_ids: set[str]) -> tuple[InvestigationSummary, dict]:
    """Synthesize; if more than half of the cited IDs are unknown, make ONE repair attempt that names the
    invalid IDs. Bounded cost: at most two calls, and the second only on failure."""
    summary, usage = synthesize(package, case_id)
    bad = invalid_citations(summary, evidence_ids)
    cited = {i for f in summary.findings for i in f.evidence_ids}
    if bad and len(bad) > len(cited) / 2:
        log_event("citation_repair", case_id=case_id, invalid_ids=bad[:10])
        repair = (f"{package}\nYour previous answer cited evidence IDs that do not exist: {', '.join(bad[:10])}. "
                  "Rewrite the summary citing only the valid evidence IDs.")
        summary2, usage2 = synthesize(repair, case_id)
        if len(invalid_citations(summary2, evidence_ids)) < len(bad):
            summary = summary2
        usage = {**usage2, "input_tokens": (usage.get("input_tokens") or 0) + (usage2.get("input_tokens") or 0),
                 "output_tokens": (usage.get("output_tokens") or 0) + (usage2.get("output_tokens") or 0),
                 "thinking_tokens": (usage.get("thinking_tokens") or 0) + (usage2.get("thinking_tokens") or 0),
                 "latency_ms": (usage.get("latency_ms") or 0) + (usage2.get("latency_ms") or 0), "repaired": True}
    usage["invalid_ids_first_pass"] = bad[:10]
    return summary, usage


def synthesize(package: str, case_id: str) -> tuple[InvestigationSummary, dict]:
    t0 = time.perf_counter()
    resp = get_client().models.generate_content(
        model=settings.gemini_model_synth,
        contents=[package],
        config=types.GenerateContentConfig(
            system_instruction=SYNTHESIS_PROMPT,
            response_mime_type="application/json",
            response_schema=InvestigationSummary,
            temperature=0.1,
            max_output_tokens=4096,
            # Evidence is pre-computed by tools, so deep reasoning adds latency/cost without better grounding.
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel(settings.synthesis_thinking_level)),
        ),
    )
    latency = round((time.perf_counter() - t0) * 1000, 1)
    usage = resp.usage_metadata
    usage_d = {"step": "synthesis", "model": settings.gemini_model_synth, "latency_ms": latency,
               "input_tokens": getattr(usage, "prompt_token_count", None),
               "output_tokens": getattr(usage, "candidates_token_count", None),
               "thinking_tokens": getattr(usage, "thoughts_token_count", None)}
    log_event("llm_call", case_id=case_id, prompt_version=PROMPT_VERSION, **usage_d)
    parsed = resp.parsed
    if isinstance(parsed, InvestigationSummary):
        return parsed, usage_d
    if resp.text:
        return InvestigationSummary.model_validate_json(resp.text), usage_d
    raise ValueError(f"empty synthesis response (finish_reason={resp.candidates[0].finish_reason if resp.candidates else None})")
