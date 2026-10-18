"""Impact metrics for the Evaluation page: outcome-first comparisons derived ONLY from measured data.

Inputs: the scored dataset (held-out test split), detection_metrics.json (thresholds), agentic_eval.json and
laya_eval.json (measured). Output: docs/metrics/impact.json with
  - confusion counts per variant (rules vs FraudLens screening),
  - catch rate per fraud type,
  - precision-recall curves,
  - the alert funnel with deterministic policy tiers for every test alert,
  - policy precision/recall on validation-split candidates,
  - headline deltas (each with the formula used).

Usage: uv run python -m evals.run_impact
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from sklearn.metrics import precision_recall_curve

from app.config import settings
from app.ml.rules import rules_score
from app.services import get_base_services

SCENARIO_LABELS = {
    "account_takeover": "Account takeover (new device + burst)",
    "account_takeover_subtle": "Subtle account takeover (own device)",
    "mule_network": "Payment to mule network",
    "scam_fresh_mule": "Scam to fresh, unlinked mule",
    "card_testing": "Card testing",
    "limited_history_fraud": "Fraud on a new customer",
    "first_party": "First-party fraud (looks normal)",
}


def counts(flag: np.ndarray, y: np.ndarray) -> dict:
    tp, fp = int((flag & (y == 1)).sum()), int((flag & (y == 0)).sum())
    fn, tn = int((~flag & (y == 1)).sum()), int((~flag & (y == 0)).sum())
    return {"alerts": int(flag.sum()), "caught": tp, "missed": fn, "false_alarms": fp, "true_negatives": tn,
            "precision": round(tp / max(tp + fp, 1), 4), "recall": round(tp / max(tp + fn, 1), 4)}


def curve(y: np.ndarray, score: np.ndarray, step: float = 0.025) -> list[dict]:
    """Interpolated precision (best precision achievable at recall >= r) on a fixed recall grid."""
    p, r, _ = precision_recall_curve(y, score)
    out = []
    for target in np.arange(0, 1 + 1e-9, step):
        mask = r >= target
        if mask.any():
            out.append({"recall": round(float(target), 4), "precision": round(float(p[mask].max()), 4)})
    return out


def policy_tiers(tids: list[str]) -> dict[str, int]:
    """Deterministic investigation (same tools + policy as production, no LLM) for every alert."""
    from app.agents.context import InvestigationContext
    from app.cases.service import _deterministic_investigation
    from app.policy.engine import decide

    svc = get_base_services()
    out = {}
    for tid in tids:
        txn = svc.repo.public_transaction(tid)
        with InvestigationContext(f"CASE-EVAL-{tid[-10:]}", txn) as ctx:
            _deterministic_investigation(ctx, txn)
            ctx.run_tool("eval", "get_ml_risk_score", transaction_id=tid)
            out[tid] = decide(ctx.evidence, None, svc.scorer.score_existing(tid)).tier
    return out


def main() -> None:
    mdir = Path(settings.metrics_dir)
    det = json.loads((mdir / "detection_metrics.json").read_text())
    agentic = json.loads((mdir / "agentic_eval.json").read_text()) if (mdir / "agentic_eval.json").exists() else None
    laya = json.loads((mdir / "laya_eval.json").read_text()) if (mdir / "laya_eval.json").exists() else None
    svc = get_base_services()
    sc = svc.scorer.scored
    tx = svc.repo.transactions.set_index("transaction_id")
    rules_all = rules_score(sc)
    split = {"test": sc["day"] >= 75, "validation": (sc["day"] >= 60) & (sc["day"] < 75)}

    test = sc[split["test"]]
    t_tx = tx.loc[test.index]
    y = t_tx["is_fraud"].to_numpy()
    amount = (t_tx["amount_paise"] / 100).to_numpy()
    rules_flag = (rules_all.loc[test.index] >= det["thresholds"]["rules"]).to_numpy()
    ml_flag = (test["risk_score"] >= svc.scorer.threshold).to_numpy()
    union_flag = rules_flag | ml_flag  # measured option: rule hits as hard triggers on top of the ML screen
    variants = {"rules": counts(rules_flag, y), "fraudlens": counts(ml_flag, y), "union": counts(union_flag, y)}
    for k, flag in (("rules", rules_flag), ("fraudlens", ml_flag), ("union", union_flag)):
        variants[k]["fraud_value_caught_rupees"] = round(float(amount[flag & (y == 1)].sum()), 2)
    total_fraud_value = round(float(amount[y == 1].sum()), 2)

    by_type = []
    scen = t_tx["scenario"].to_numpy()
    for key, label in SCENARIO_LABELS.items():
        m = (scen == key) & (y == 1)
        if m.sum() == 0:
            continue
        by_type.append({"type": key, "label": label, "fraud_transactions": int(m.sum()),
                        "rules_caught": int((rules_flag & m).sum()), "fraudlens_caught": int((ml_flag & m).sum()),
                        "union_caught": int((union_flag & m).sum()),
                        "rules_rate": round(float((rules_flag & m).sum() / m.sum()), 4),
                        "fraudlens_rate": round(float((ml_flag & m).sum() / m.sum()), 4)})
    benign_big = (scen == "benign_high_value")
    legit_big = {"transactions": int(benign_big.sum()), "rules_flagged": int((rules_flag & benign_big).sum()),
                 "fraudlens_flagged": int((ml_flag & benign_big).sum())}

    curves = {"rules": curve(y, rules_all.loc[test.index].to_numpy()), "fraudlens": curve(y, test["risk_score"].to_numpy())}

    # Funnel: every test alert gets the real policy tier from tool evidence (deterministic, no LLM)
    alerts = test.index[ml_flag].tolist()
    tiers = policy_tiers(alerts)
    tier_counts = {str(t): sum(1 for v in tiers.values() if v == t) for t in (1, 2, 3)}
    tier_fraud = {str(t): sum(1 for k, v in tiers.items() if v == t and tx.at[k, "is_fraud"] == 1) for t in (1, 2, 3)}
    escalated = [k for k, v in tiers.items() if v >= 2]
    esc_y = np.array([tx.at[k, "is_fraud"] for k in escalated])

    # Policy check on validation-split candidates (used to tune policy 2026.10.2)
    val = sc[split["validation"]]
    val_alerts = val.index[val["risk_score"] >= svc.scorer.threshold].tolist()
    vt = policy_tiers(val_alerts)
    vflag = np.array([vt[k] >= 2 for k in val_alerts])
    vy = tx.loc[val_alerts, "is_fraud"].to_numpy()
    policy_val = counts(vflag, vy)

    n = len(test)
    r, f = variants["rules"], variants["fraudlens"]
    headline = {
        "extra_frauds_caught": f["caught"] - r["caught"],
        "extra_frauds_caught_pct": round((f["caught"] - r["caught"]) / max(r["caught"], 1), 4),
        "recall_rules": r["recall"], "recall_fraudlens": f["recall"],
        "pr_auc_rules": det["variants"]["A_rules"]["pr_auc"], "pr_auc_fraudlens": det["variants"]["B_ml_blend"]["pr_auc"],
        "pr_auc_gain_pct": round(det["variants"]["B_ml_blend"]["pr_auc"] / det["variants"]["A_rules"]["pr_auc"] - 1, 4),
        "alert_rate": round(f["alerts"] / n, 5), "transactions_per_alert": round(n / max(f["alerts"], 1)),
        "llm_calls_avoided_pct": round(1 - f["alerts"] / n, 4),
        "extra_false_alarms": f["false_alarms"] - r["false_alarms"],
        "formulas": {
            "extra_frauds_caught": "FraudLens caught - rules caught (test split)",
            "llm_calls_avoided_pct": "1 - alerts / transactions screened",
            "llm_cost_if_all_per_1000": "measured cost per investigated case x 1000",
        },
    }
    if agentic and agentic.get("cost"):
        per_case = agentic["cost"]["avg_llm_cost_usd_per_investigated_case"]
        headline.update({"llm_cost_per_1000_fraudlens_usd": agentic["cost"]["llm_cost_usd_per_1000_transactions"],
                         "llm_cost_per_1000_if_all_usd": round(per_case * 1000, 2),
                         "llm_cost_reduction_x": round(per_case * 1000 / agentic["cost"]["llm_cost_usd_per_1000_transactions"])})

    out = {
        "generated_at": datetime.now(UTC).isoformat(), "dataset_seed": settings.dataset_seed,
        "model_version": svc.scorer.version, "test_transactions": n, "test_fraud_transactions": int(y.sum()),
        "total_fraud_value_rupees": total_fraud_value,
        "variants": variants, "by_fraud_type": by_type, "legit_high_value": legit_big, "pr_curves": curves,
        "funnel": {"screened": n, "alerts": f["alerts"], "alerts_fraud": f["caught"], "policy_tiers": tier_counts,
                   "policy_tiers_fraud": tier_fraud, "escalated_tier2plus": len(escalated),
                   "escalated_precision": round(float(esc_y.mean()), 4) if len(esc_y) else None,
                   "note": "Policy tiers from deterministic tool evidence (no LLM) for every test alert"},
        "policy_validation": {"split": "validation candidates", **policy_val},
        "headline": headline,
        "agentic": None if not agentic else {
            "sample": agentic["sample"], "evidence_validity_rate_mean": agentic["evidence_validity_rate_mean"],
            "invalid_citations_total": agentic["invalid_citations_total"],
            "investigation_latency_ms": agentic["investigation_latency_ms"], "tokens_per_case": agentic["tokens_per_case"],
            "gemini_model": agentic["gemini_model"], "policy_version": agentic["policy_version"],
            "golden": {k: {"tier": v["tier"], "pass": v["pass_tier"] and v["pass_citations"]}
                       for k, v in agentic["golden_scenarios"].items()}},
        "laya": None if not laya else {"routed_investigate": laya["route_distribution"]["investigate"],
                                       "queried": laya["b_candidates_queried"],
                                       "escalation_reduction": laya["gemini_escalation_reduction_if_routing_on_investigate"],
                                       "latency_ms": laya["laya_latency_ms"], "auc": laya.get("separation_auc_on_candidates")},
        "screening_ms_per_1k": det["batch_scoring_ms_per_1k_txns"],
    }
    (mdir / "impact.json").write_text(json.dumps(out, indent=2))
    print(json.dumps({k: out[k] for k in ("variants", "headline", "funnel", "policy_validation")}, indent=2))
    for t in by_type:
        print(f"{t['label']:<42} rules {t['rules_caught']:>3}/{t['fraud_transactions']:<3} fraudlens {t['fraudlens_caught']:>3}")


if __name__ == "__main__":
    main()
