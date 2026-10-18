"""Variant C benchmark: Laya decision model routing on top of Baseline B (ML screening).

For every test-split candidate from B, ask the deployed Laya service for its typed triage, then
measure C = "B candidates that Laya routes to investigate" against the labels over the WHOLE test
split, next to A (rules) and B. Also reports Laya latency and how much it would cut Gemini escalations.
Writes docs/metrics/laya_eval.json and updates the C entry in docs/metrics/benchmark.json.

Usage: ENABLE_LAYA=true LAYA_URL=https://fraudlens-laya-....run.app uv run python -m evals.run_laya_benchmark
"""

from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from app.ai import laya_client
from app.config import settings
from app.services import get_services
from app.tools.laya import laya_state


def ask(tid: str) -> dict:
    t0 = time.perf_counter()
    try:
        for attempt in range(4):  # the private service runs 1 instance; back off on 429
            try:
                r = laya_client.triage(tid.replace("TXN-", "C-"), laya_state(tid))
                break
            except laya_client.LayaUnavailable as e:
                if "429" not in str(e) or attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))
        a = r["answers"]
        return {"transaction_id": tid, "ok": True, "route": a["route"]["choice"],
                "route_conf": a["route"].get("confidence"), "p_ato": a["account_takeover"]["noul"],
                "p_mule": a["mule_payment"]["noul"], "urgency": a["urgency"].get("score"),
                "service_ms": r.get("latency_ms"), "roundtrip_ms": round((time.perf_counter() - t0) * 1000, 1)}
    except Exception as e:
        return {"transaction_id": tid, "ok": False, "error": f"{type(e).__name__}: {str(e)[:80]}"}


def metrics(flag_ids: set[str], test_ids, labels, amounts) -> dict:
    y = labels.to_numpy()
    flag = np.array([t in flag_ids for t in test_ids])
    tp, fp = int((flag & (y == 1)).sum()), int((flag & (y == 0)).sum())
    pos = int((y == 1).sum())
    return {"candidates": int(flag.sum()), "candidate_rate": round(float(flag.mean()), 5),
            "precision": round(tp / max(tp + fp, 1), 4), "recall": round(tp / max(pos, 1), 4),
            "false_positives_per_10k": round(fp / len(y) * 10_000, 2),
            "fraud_value_captured_pct": round(float(amounts[flag & (y == 1)].sum() / max(amounts[y == 1].sum(), 1) * 100), 2)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--limit", type=int, default=0, help="cap candidates (0 = all test candidates)")
    args = ap.parse_args()
    svc = get_services()
    sc = svc.scorer.scored
    test = sc[sc["day"] >= 75]
    tx = svc.repo.transactions.set_index("transaction_id").loc[test.index]
    labels, amounts = tx["is_fraud"], (tx["amount_paise"] / 100).to_numpy()
    cand = test.index[test["risk_score"] >= svc.scorer.threshold].tolist()
    if args.limit:
        cand = cand[: args.limit]

    print(f"warming Laya and querying {len(cand)} candidates...")
    ask(cand[0])  # absorb cold start
    with ThreadPoolExecutor(args.workers) as pool:
        rows = list(pool.map(ask, cand))
    ok = [r for r in rows if r["ok"]]
    if not ok:
        raise SystemExit(f"Laya unavailable: {rows[0].get('error')}")

    lab = labels.to_dict()
    routes = {r["transaction_id"]: r for r in ok}
    variants = {
        "C_route_investigate": {t for t, r in routes.items() if r["route"] == "investigate"},
        "C_route_not_dismiss": {t for t, r in routes.items() if r["route"] != "dismiss"},
        "C_p_ato_or_mule_ge_0.5": {t for t, r in routes.items() if max(r["p_ato"], r["p_mule"]) >= 0.5},
    }
    b_flag = set(cand)
    from sklearn.metrics import roc_auc_score

    y_ok = [int(lab[r["transaction_id"]]) for r in ok]
    auc = {k: (round(float(roc_auc_score(y_ok, [r[k] for r in ok])), 4) if len(set(y_ok)) == 2 else None)
           for k in ("p_ato", "p_mule", "urgency")}
    out = {
        "generated_at": datetime.now(UTC).isoformat(), "dataset_seed": settings.dataset_seed,
        "laya_model": ok[0].get("model") or "convaiinnovations/laya-typed-decisions",
        "model_version": svc.scorer.version, "test_transactions": len(test), "b_candidates_queried": len(cand),
        "laya_failures": len(rows) - len(ok),
        "laya_latency_ms": {"service_p50": round(float(np.percentile([r["service_ms"] for r in ok], 50)), 1),
                            "service_p95": round(float(np.percentile([r["service_ms"] for r in ok], 95)), 1),
                            "roundtrip_p50": round(float(np.percentile([r["roundtrip_ms"] for r in ok], 50)), 1)},
        "separation_auc_on_candidates": auc,
        "route_distribution": {k: sum(r["route"] == k for r in ok) for k in ("investigate", "monitor", "dismiss")},
        "route_vs_label_on_candidates": {
            k: {"fraud": sum(lab[r["transaction_id"]] == 1 for r in ok if r["route"] == k),
                "legit": sum(lab[r["transaction_id"]] == 0 for r in ok if r["route"] == k)}
            for k in ("investigate", "monitor", "dismiss")},
        "variants": {"B_ml_blend": metrics(b_flag, test.index, labels, amounts),
                     **{k: metrics(v, test.index, labels, amounts) for k, v in variants.items()}},
        "gemini_escalation_reduction_if_routing_on_investigate": round(1 - len(variants["C_route_investigate"]) / max(len(cand), 1), 4),
        "note": "Laya is advisory in FraudLens; these variants measure what routing on it WOULD do.",
        "rows": rows,
    }
    mdir = Path(settings.metrics_dir)
    (mdir / "laya_eval.json").write_text(json.dumps(out, indent=2, default=str))
    bench_path = mdir / "benchmark.json"
    if bench_path.exists():
        bench = json.loads(bench_path.read_text())
        bench["C_laya"] = {"status": "measured", "model": out["laya_model"], "routing_rule": "B candidates with route=investigate",
                           **out["variants"]["C_route_investigate"], "laya_latency_ms": out["laya_latency_ms"],
                           "source": "docs/metrics/laya_eval.json"}
        bench.pop("C_jev", None)
        bench_path.write_text(json.dumps(bench, indent=2, default=str))
    print(json.dumps({k: out[k] for k in ("b_candidates_queried", "laya_failures", "laya_latency_ms", "route_distribution",
                                          "route_vs_label_on_candidates", "variants",
                                          "gemini_escalation_reduction_if_routing_on_investigate")}, indent=2))


if __name__ == "__main__":
    main()
