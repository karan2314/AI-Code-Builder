"""First-stage scorer: precomputed scores for the dataset + fast scoring of new transactions.

No LLM is ever called in this path.
"""

from __future__ import annotations

import time
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from app.config import settings
from app.data.repository import DataRepository
from app.features.build import FEATURE_COLUMNS, compute_features
from app.ml.rules import reason_codes, rules_score
from app.schemas import BatchScoreResult, ScoreResult, TopFeature, Transaction


class Scorer:
    def __init__(self, repo: DataRepository, models_dir: Path | None = None) -> None:
        self.repo = repo
        bundle = joblib.load(Path(models_dir or settings.models_dir) / "screening.joblib")
        self.clf, self.iso, self.norm = bundle["clf"], bundle["iso"], bundle["norm"]
        self.blend, self.threshold = bundle["blend"], bundle["risk_threshold"]
        self.importance, self.stats = bundle["importance"], bundle["stats"]
        self.version: str = bundle["version"]
        self.scored = pd.read_parquet(Path(settings.data_dir) / "scored.parquet")
        self._new: dict[str, ScoreResult] = {}  # idempotency cache for API-submitted transactions
        self.latencies_ms: list[float] = []

    # ---- explanations ----------------------------------------------------------------------
    def _top_features(self, row: pd.Series, k: int = 5) -> list[TopFeature]:
        out = []
        for name in FEATURE_COLUMNS:
            z = (float(row[name]) - self.stats["mean"][name]) / (self.stats["std"][name] or 1.0)
            out.append((name, float(row[name]), self.importance.get(name, 0.0) * abs(z)))
        out.sort(key=lambda t: -t[2])
        return [TopFeature(name=n, value=round(v, 4), weight=round(w, 5)) for n, v, w in out[:k] if w > 0]

    def _result(self, tid: str, row: pd.Series) -> ScoreResult:
        return ScoreResult(
            transaction_id=tid,
            risk_score=round(float(row["risk_score"]), 4),
            rules_score=round(float(row["rules_score"]), 4),
            ml_score=round(float(row["ml_score"]), 4),
            anomaly_score=round(float(row["anomaly_score"]), 4),
            is_candidate=bool(row["risk_score"] >= self.threshold),
            reason_codes=reason_codes(row[FEATURE_COLUMNS]),
            top_features=self._top_features(row),
            model_version=self.version,
        )

    def features_row(self, transaction_id: str) -> pd.Series | None:
        if transaction_id in self.scored.index:
            return self.scored.loc[transaction_id]
        return None

    # ---- scoring ---------------------------------------------------------------------------
    def score_existing(self, transaction_id: str) -> ScoreResult | None:
        if transaction_id in self._new:
            return self._new[transaction_id]
        row = self.features_row(transaction_id)
        return None if row is None else self._result(transaction_id, row)

    def _model_scores(self, feats: pd.DataFrame) -> pd.DataFrame:
        X = feats[FEATURE_COLUMNS]
        ml = self.clf.predict_proba(X)[:, 1]
        anomaly = self.norm(-self.iso.score_samples(X))
        rules = rules_score(feats).to_numpy()
        risk = self.blend["ml"] * ml + self.blend["rules"] * rules + self.blend["anomaly"] * anomaly
        return feats.assign(ml_score=ml, anomaly_score=anomaly, rules_score=rules, risk_score=risk)

    def score_new(self, txn: Transaction) -> ScoreResult:
        """Score a transaction that is not in the dataset, using only history before its timestamp."""
        existing = self.score_existing(txn.transaction_id)
        if existing is not None:
            return existing
        t0 = time.perf_counter()
        tx = self.repo.transactions
        ts = pd.Timestamp(txn.timestamp).tz_localize(None) if pd.Timestamp(txn.timestamp).tzinfo else pd.Timestamp(txn.timestamp)
        related = tx[((tx["customer_id"] == txn.customer_id) | (tx["device_id"] == txn.device_id)
                      | (tx["counterparty_id"] == txn.counterparty_id)) & (tx["timestamp"] < ts)]
        row = txn.model_dump()
        row["timestamp"] = ts
        sub = pd.concat([related.drop(columns=["is_fraud", "scenario"]), pd.DataFrame([row])], ignore_index=True)
        feats = compute_features(sub, self.repo.accounts, self.repo.counterparties, self.repo.fraud_cases,
                                 self.repo.entity_links, self.repo.start)
        scored = self._model_scores(feats.loc[[txn.transaction_id]])
        result = self._result(txn.transaction_id, scored.iloc[0])
        self._new[txn.transaction_id] = result
        self.latencies_ms.append((time.perf_counter() - t0) * 1000)
        return result

    def score_batch(self, txns: list[Transaction] | None = None, dataset_split: str | None = None) -> BatchScoreResult:
        t0 = time.perf_counter()
        if txns:
            results = [self.score_new(t) for t in txns]
            ids = [r.transaction_id for r in results if r.is_candidate]
            n = len(results)
        else:
            frame = self.scored
            if dataset_split == "test":
                frame = frame[frame["day"] >= 75]
            n = len(frame)
            ids = frame.index[frame["risk_score"] >= self.threshold].tolist()
        latency = (time.perf_counter() - t0) * 1000
        return BatchScoreResult(count=n, candidates=len(ids), candidate_rate=round(len(ids) / max(n, 1), 5),
                                latency_ms=round(latency, 2), candidate_ids=ids[:500])

    def queue(self, limit: int = 100) -> pd.DataFrame:
        """Most recent candidates first (the analyst queue)."""
        cand = self.scored[self.scored["risk_score"] >= self.threshold]
        tx = self.repo.transactions.set_index("transaction_id").loc[cand.index]
        q = cand.join(tx[["customer_id", "timestamp", "amount_paise", "channel", "counterparty_id", "device_id"]])
        return q.sort_values("timestamp", ascending=False).head(limit)

    def latency_percentiles(self) -> dict:
        if not self.latencies_ms:
            return {}
        arr = np.array(self.latencies_ms)
        return {"p50_ms": round(float(np.percentile(arr, 50)), 2), "p95_ms": round(float(np.percentile(arr, 95)), 2),
                "n": len(arr)}
