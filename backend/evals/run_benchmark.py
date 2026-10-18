"""Benchmark: A rules vs B ML (from detection metrics) + D agentic investigation on golden scenarios
and a stratified sample of test-split candidates. Writes docs/metrics/benchmark.json and agentic_eval.json.

Usage:
  uv run python -m evals.run_benchmark --sample 12            # real Gemini (needs ADC + GOOGLE_CLOUD_PROJECT)
  uv run python -m evals.run_benchmark --sample 12 --no-ai    # deterministic fallback only
"""

from __future__ import annotations

import argparse
import json
import statistics
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app.agents.fraudlens.prompts import PROMPT_VERSION
from app.cases import service
from app.config import settings
from app.policy.engine import POLICY_VERSION
from app.services import get_services

GOLDEN = {
    "hero_account_takeover": {"txn": "TXN-HERO-185K", "expect_tier": [3],
                              "must_cite": ["device_novelty", "velocity", "network_metrics"]},
    "benign_high_value": {"txn": "TXN-BENIGN-150K", "expect_tier": [1], "must_cite": ["amount_deviation"]},
}
PRICING = Path(__file__).with_name("pricing.json")


def _laya_variant(metrics_dir: Path) -> dict:
    """Variant C is measured by evals/run_laya_benchmark.py (needs the private Laya service)."""
    p = metrics_dir / "laya_eval.json"
    if not p.exists():
        return {"status": "not_run", "how": "uv run python -m evals.run_laya_benchmark (ENABLE_LAYA=true, LAYA_URL=...)"}
    d = json.loads(p.read_text())
    return {"status": "measured", "model": d.get("laya_model"), "routing_rule": "B candidates with route=investigate",
            **d["variants"]["C_route_investigate"], "laya_latency_ms": d.get("laya_latency_ms"),
            "source": "docs/metrics/laya_eval.json"}


def pct(values: list[float], q: float) -> float | None:
    return round(float(np.percentile(values, q)), 1) if values else None


def run_case(tid: str, use_ai: bool) -> dict:
    svc = get_services()
    case = service.investigate(service.create_case(tid).case_id, use_ai=use_ai)
    label = int(svc.repo.get_transaction(tid)["is_fraud"])
    agents = case.usage.get("agents", {}) or {}
    synth = case.usage.get("synthesis", {}) or {}
    cited_kinds = set()
    if case.summary:
        ev_kind = {e.id: e.kind for e in case.evidence}
        cited_kinds = {ev_kind[i] for f in case.summary.findings for i in f.evidence_ids if i in ev_kind}
    return {
        "transaction_id": tid, "label_is_fraud": label, "tier": case.decision.tier,
        "flagged": case.decision.tier >= 2, "mode": case.investigation_mode, "ai_error": case.ai_error,
        "llm_tier": case.decision.llm_recommended_tier, "disagreement": case.decision.disagreement,
        "evidence_items": len(case.evidence), "evidence_validity_rate": case.evidence_validity_rate,
        "dropped_findings": case.dropped_findings, "cited_kinds": sorted(cited_kinds),
        "agents_used": sorted({t.agent for t in case.trajectory}),
        "tool_calls": len(case.trajectory), "latency_ms": case.usage.get("total_latency_ms"),
        "input_tokens": (agents.get("input_tokens") or 0) + (synth.get("input_tokens") or 0),
        "output_tokens": (agents.get("output_tokens") or 0) + (agents.get("thinking_tokens") or 0) + (synth.get("output_tokens") or 0) + (synth.get("thinking_tokens") or 0),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=12, help="test-split candidates to investigate (stratified)")
    ap.add_argument("--no-ai", action="store_true")
    args = ap.parse_args()
    use_ai = not args.no_ai and settings.gemini_enabled
    svc = get_services()
    rng = np.random.default_rng(settings.dataset_seed)

    golden = {}
    for name, spec in GOLDEN.items():
        r = run_case(spec["txn"], use_ai)
        r["pass_tier"] = r["tier"] in spec["expect_tier"]
        r["pass_citations"] = (not use_ai) or set(spec["must_cite"]) <= set(r["cited_kinds"])
        golden[name] = r

    scored = svc.scorer.scored
    test_cand = scored[(scored["day"] >= 75) & (scored["risk_score"] >= svc.scorer.threshold)].index
    labels = svc.repo.transactions.set_index("transaction_id").loc[test_cand, "is_fraud"]
    pos, neg = labels[labels == 1].index.to_numpy(), labels[labels == 0].index.to_numpy()
    k_neg = min(len(neg), max(args.sample // 3, 1))
    k_pos = min(len(pos), args.sample - k_neg)
    sample = list(rng.choice(pos, k_pos, replace=False)) + list(rng.choice(neg, k_neg, replace=False))
    results = [run_case(str(t), use_ai) for t in sample]

    def agreement(rows):
        return round(sum(r["flagged"] == bool(r["label_is_fraud"]) for r in rows) / max(len(rows), 1), 4)

    lat = [r["latency_ms"] for r in results + list(golden.values()) if r["latency_ms"]]
    validity = [r["evidence_validity_rate"] for r in results + list(golden.values()) if r["evidence_validity_rate"] is not None]
    tokens_in = [r["input_tokens"] for r in results if r["mode"] == "agentic"]
    tokens_out = [r["output_tokens"] for r in results if r["mode"] == "agentic"]
    escalation = len(test_cand) / max(int((scored["day"] >= 75).sum()), 1)

    cost = None
    if PRICING.exists() and tokens_in:
        p = json.loads(PRICING.read_text())
        per_case = (statistics.mean(tokens_in) * p["input_usd_per_1m_tokens"] +
                    statistics.mean(tokens_out) * p["output_usd_per_1m_tokens"]) / 1_000_000
        cost = {"avg_llm_cost_usd_per_investigated_case": round(per_case, 5),
                "llm_cost_usd_per_1000_transactions": round(per_case * escalation * 1000, 5),
                "formula": "mean(tokens) x price per token x escalation rate x 1000",
                "pricing_source": p.get("source"), "pricing_checked": p.get("checked")}

    agentic = {
        "generated_at": datetime.now(UTC).isoformat(), "dataset_seed": settings.dataset_seed,
        "ai_enabled": use_ai, "gemini_model": settings.gemini_model, "synthesis_model": settings.gemini_model_synth,
        "prompt_version": PROMPT_VERSION, "policy_version": POLICY_VERSION, "model_version": svc.scorer.version,
        "golden_scenarios": golden,
        "sample": {"size": len(results), "fraud": k_pos, "legit": k_neg,
                   "tier_vs_label_agreement": agreement(results),
                   "agentic_runs": sum(r["mode"] == "agentic" for r in results),
                   "fallback_runs": sum(r["mode"] != "agentic" for r in results)},
        "evidence_validity_rate_mean": round(statistics.mean(validity), 4) if validity else None,
        "invalid_citations_total": sum(r["dropped_findings"] for r in results + list(golden.values())),
        "investigation_latency_ms": {"p50": pct(lat, 50), "p95": pct(lat, 95)},
        "tokens_per_case": {"input_mean": round(statistics.mean(tokens_in)) if tokens_in else None,
                            "output_mean": round(statistics.mean(tokens_out)) if tokens_out else None},
        "gemini_escalation_rate_test": round(escalation, 5),
        "cost": cost,
        "cases": results,
    }
    out = Path(settings.metrics_dir)
    (out / "agentic_eval.json").write_text(json.dumps(agentic, indent=2, default=str))

    det = json.loads((out / "detection_metrics.json").read_text())
    bench = {
        "generated_at": agentic["generated_at"], "dataset_seed": settings.dataset_seed,
        "A_rules": det["variants"]["A_rules"], "B_ml_blend": det["variants"]["B_ml_blend"],
        "C_laya": _laya_variant(out),
        "D_ml_plus_agentic": {
            "screening": "B_ml_blend", "investigated_sample": len(results),
            "tier_vs_label_agreement": agentic["sample"]["tier_vs_label_agreement"],
            "evidence_validity_rate_mean": agentic["evidence_validity_rate_mean"],
            "gemini_escalation_rate": agentic["gemini_escalation_rate_test"],
            "investigation_latency_ms": agentic["investigation_latency_ms"],
            "llm_cost_usd_per_1000_transactions": cost["llm_cost_usd_per_1000_transactions"] if cost else None,
        },
    }
    (out / "benchmark.json").write_text(json.dumps(bench, indent=2, default=str))
    print(json.dumps({k: agentic[k] for k in ("ai_enabled", "sample", "evidence_validity_rate_mean",
                                               "investigation_latency_ms", "tokens_per_case", "cost")}, indent=2))
    print({n: (g["tier"], g["pass_tier"], g["pass_citations"], g["mode"]) for n, g in golden.items()})


if __name__ == "__main__":
    main()
