"""Train first-stage screening models on a time-based split and write detection metrics.

Baseline A: rules only.  Baseline B: gradient boosting + Isolation Forest + rules blend.
Split: train days 0-59, validation 60-74, test 75-89. Thresholds are calibrated on validation and
all reported metrics are measured on the test split.

Usage:  uv run python -m app.ml.train
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, IsolationForest
from sklearn.inspection import permutation_importance
from sklearn.metrics import average_precision_score

from app.config import settings
from app.data.repository import DataRepository
from app.features.build import FEATURE_COLUMNS, compute_features
from app.ml.normalize import AnomalyNormalizer
from app.ml.rules import rules_score

TRAIN_END, VAL_END = 60, 75
BLEND = {"ml": 0.6, "rules": 0.3, "anomaly": 0.1}
MAX_CANDIDATE_RATE = 0.03


def split(day: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    return day < TRAIN_END, (day >= TRAIN_END) & (day < VAL_END), day >= VAL_END


def calibrate(score: np.ndarray, y: np.ndarray, max_rate: float = MAX_CANDIDATE_RATE) -> float:
    """Pick the threshold with the best F1 on validation, subject to a candidate-rate ceiling."""
    best_t, best_f1 = 1.0, -1.0
    for t in np.unique(np.quantile(score, np.linspace(0.90, 0.9995, 400))):
        flag = score >= t
        if flag.mean() > max_rate:
            continue
        tp = (flag & (y == 1)).sum()
        prec = tp / max(flag.sum(), 1)
        rec = tp / max((y == 1).sum(), 1)
        f1 = 2 * prec * rec / max(prec + rec, 1e-9)
        if f1 > best_f1:
            best_t, best_f1 = float(t), f1
    return best_t


def detection_metrics(score: np.ndarray, flag: np.ndarray, y: np.ndarray, amount: np.ndarray) -> dict:
    tp = int((flag & (y == 1)).sum())
    fp = int((flag & (y == 0)).sum())
    n, pos = len(y), int((y == 1).sum())
    return {
        "transactions": n,
        "fraud_transactions": pos,
        "candidates": int(flag.sum()),
        "candidate_rate": round(float(flag.mean()), 5),
        "precision": round(tp / max(tp + fp, 1), 4),
        "recall": round(tp / max(pos, 1), 4),
        "pr_auc": round(float(average_precision_score(y, score)), 4),
        "false_positives_per_10k": round(fp / n * 10_000, 2),
        "fraud_value_captured_pct": round(float(amount[flag & (y == 1)].sum() / max(amount[y == 1].sum(), 1) * 100), 2),
    }


def main() -> None:
    t0 = time.time()
    repo = DataRepository()
    feats = compute_features(repo.transactions, repo.accounts, repo.counterparties, repo.fraud_cases,
                             repo.entity_links, repo.start)
    labels = repo.transactions.set_index("transaction_id").loc[feats.index]
    y = labels["is_fraud"].to_numpy()
    amount = feats["amount_rupees"].to_numpy()
    tr, va, te = (m.to_numpy() for m in split(feats["day"]))
    X = feats[FEATURE_COLUMNS]

    clf = HistGradientBoostingClassifier(max_iter=300, learning_rate=0.06, max_leaf_nodes=31,
                                         class_weight="balanced", random_state=settings.dataset_seed)
    clf.fit(X[tr], y[tr])
    iso = IsolationForest(n_estimators=200, random_state=settings.dataset_seed, n_jobs=-1)
    iso.fit(X[tr][y[tr] == 0])
    norm = AnomalyNormalizer(-iso.score_samples(X[tr]))

    ml = clf.predict_proba(X)[:, 1]
    anomaly = norm(-iso.score_samples(X))
    rules = rules_score(feats).to_numpy()
    risk = BLEND["ml"] * ml + BLEND["rules"] * rules + BLEND["anomaly"] * anomaly

    rules_t = calibrate(rules[va], y[va])
    risk_t = calibrate(risk[va], y[va])

    # global feature importance (permutation on a validation sample) for per-transaction explanations
    rng = np.random.default_rng(settings.dataset_seed)
    va_idx = np.flatnonzero(va)
    sample = np.concatenate([va_idx[y[va_idx] == 1], rng.choice(va_idx[y[va_idx] == 0], 6000, replace=False)])
    imp = permutation_importance(clf, X.iloc[sample], y[sample], scoring="average_precision", n_repeats=3,
                                 random_state=settings.dataset_seed)
    importance = {c: round(float(max(v, 0)), 5) for c, v in zip(FEATURE_COLUMNS, imp.importances_mean, strict=True)}
    stats = {"mean": X[tr].mean().to_dict(), "std": X[tr].std().replace(0, 1).to_dict()}

    # single-transaction latency is measured by the scorer at runtime; here batch throughput
    tb = time.perf_counter()
    clf.predict_proba(X[te])
    iso.score_samples(X[te])
    batch_ms_per_1k = (time.perf_counter() - tb) / max(te.sum(), 1) * 1000 * 1000

    stamp = datetime.now(UTC)
    version = f"hgb-iso-{stamp:%Y%m%d%H%M}"
    models_dir = Path(settings.models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({"clf": clf, "iso": iso, "norm": norm, "blend": BLEND, "risk_threshold": risk_t,
                 "rules_threshold": rules_t, "features": FEATURE_COLUMNS, "importance": importance,
                 "stats": stats, "version": version}, models_dir / "screening.joblib")
    (models_dir / "registry.json").write_text(json.dumps({
        "active": version, "file": "screening.joblib", "trained_at": stamp.isoformat(),
        "features": FEATURE_COLUMNS, "metrics_ref": "docs/metrics/detection_metrics.json"}, indent=2))

    scored = pd.DataFrame({"rules_score": rules, "ml_score": ml, "anomaly_score": anomaly, "risk_score": risk},
                          index=feats.index)
    scored["is_candidate"] = scored["risk_score"] >= risk_t
    feats.join(scored).to_parquet(Path(settings.data_dir) / "scored.parquet")

    metrics = {
        "generated_at": stamp.isoformat(),
        "dataset_seed": settings.dataset_seed,
        "model_version": version,
        "split": {"train_days": f"0-{TRAIN_END - 1}", "validation_days": f"{TRAIN_END}-{VAL_END - 1}",
                  "test_days": f"{VAL_END}-89", "test_transactions": int(te.sum())},
        "thresholds": {"rules": round(rules_t, 4), "blend": round(risk_t, 4), "calibrated_on": "validation",
                       "max_candidate_rate": MAX_CANDIDATE_RATE},
        "blend_weights": BLEND,
        "variants": {
            "A_rules": detection_metrics(rules[te], rules[te] >= rules_t, y[te], amount[te]),
            "B_ml_blend": detection_metrics(risk[te], risk[te] >= risk_t, y[te], amount[te]),
        },
        "batch_scoring_ms_per_1k_txns": round(batch_ms_per_1k, 2),
        "training_seconds": round(time.time() - t0, 1),
        "top_global_features": sorted(importance.items(), key=lambda kv: -kv[1])[:8],
    }
    metrics_dir = Path(settings.metrics_dir)
    metrics_dir.mkdir(parents=True, exist_ok=True)
    (metrics_dir / "detection_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics["variants"], indent=2))
    print("thresholds", metrics["thresholds"], "| hero risk",
          round(float(scored.loc["TXN-HERO-185K", "risk_score"]), 3), "| benign risk",
          round(float(scored.loc["TXN-BENIGN-150K", "risk_score"]), 3))


if __name__ == "__main__":
    main()
