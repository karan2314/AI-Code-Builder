---
name: fraud-detection-ml
description: Build FraudLens first-stage screening - point-in-time features, rules baseline with reason codes, LightGBM and Isolation Forest on a time-based split, threshold calibration, model versioning, fast single and batch scoring, and detection metrics JSON. Use when working on features, rules, model training, scoring APIs, or detection metrics.
---

# Fraud Detection ML (first stage)

Follow `ml-detection.md`. The LLM is never in this path.

## 1. Features (`app/features/build.py`)

Sort by `customer_id, timestamp`. For each txn, use only prior rows:
- `amt_ratio_median` = amount / rolling median (shifted); `amt_z_mad`; `amt_gt_p95_customer`
- `cnt_5m`, `cnt_1h`, `sum_1h`, `cnt_24h` (time-based rolling on a DatetimeIndex, `closed="left"`)
- `limit_util_daily` = running daily sum / daily limit
- `device_is_new` (first use for this customer), `device_linked_accounts`
- `recipient_is_new`, `merchant_is_new`, `recipient_fan_in_7d`
- `hour_unusual` (outside the customer's typical hours), `channel`
- `graph_dist_to_fraud` (from the precomputed graph, using fraud cases confirmed before the txn time)
- Cohort fallback when the prior count is < 5 (`limited_history=1`).

Leakage test: shuffle future rows, recompute features for a fixed txn, and assert they are unchanged.

## 2. Rules (`app/ml/rules.py`)

Vectorized boolean columns → reason codes; `rules_score` = weighted sum, clipped to 0..1.

## 3. Train (`app/ml/train.py`)

```python
train = df[df.day <= 60]; val = df[(df.day > 60) & (df.day <= 75)]; test = df[df.day > 75]
clf = lgb.LGBMClassifier(n_estimators=400, learning_rate=0.05, num_leaves=31,
                         scale_pos_weight=neg/pos, random_state=42)
iso = IsolationForest(n_estimators=200, contamination="auto", random_state=42).fit(train[X])
# blend: risk = 0.7*clf_proba + 0.2*rules_score + 0.1*minmax(-iso.score_samples)
# threshold = value on val that gives the target candidate rate (≈2%) or max F1 under rate ≤ 5%
```

Save `models/lgbm-<date>-<sha>.txt`, `iso-….joblib`, `models/registry.json`. Write
`docs/metrics/detection_metrics.json` with: precision, recall, pr_auc, fp_per_10k, candidate_rate,
fraud_value_captured_pct, p50/p95 latency (single + batch), threshold, seed, versions, timestamp.

## 4. Score (`app/ml/score.py`)

- Load models and the feature state at startup. `score(txn)` computes features from the in-memory history and returns
  `ScoreResult` with `top_features` (LightGBM `pred_contrib=True`, top 5).
- `score_batch(df)` is vectorized and returns candidate IDs + summary.

## 5. Verify

`uv run pytest -q tests/ml`; the hero txn is a candidate; `CUST-BENIGN01`'s purchase scores low or medium;
the metrics JSON is written; P95 single-score latency < 100 ms.
