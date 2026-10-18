"""Batch overlay: the base synthetic dataset PLUS one uploaded batch, isolated from everything else.

Uploaded rows get point-in-time features (from base history and earlier rows of the same batch), are
scored with the same models and rules, and are visible to the investigation tools and the network graph
only while that batch is active. The base dataset and other batches are never modified.
"""

from __future__ import annotations

import time

import numpy as np
import pandas as pd

from app.batches.parse import UploadError
from app.data.repository import DataRepository
from app.features.build import compute_features
from app.graph.network import FraudGraph
from app.ml.score import Scorer
from app.schemas import ScoreResult

NEW_ACCOUNT_TXN_LIMIT_PAISE = 2_00_000 * 100
NEW_ACCOUNT_DAILY_LIMIT_PAISE = 3_00_000 * 100


class BatchScorer:
    """Scorer view: batch rows first, then the base dataset."""

    def __init__(self, base: Scorer, batch_scored: pd.DataFrame) -> None:
        self.base = base
        self.batch_scored = batch_scored
        self.version = base.version
        self.threshold = base.threshold

    def features_row(self, transaction_id: str):
        if transaction_id in self.batch_scored.index:
            return self.batch_scored.loc[transaction_id]
        return self.base.features_row(transaction_id)

    def score_existing(self, transaction_id: str) -> ScoreResult | None:
        if transaction_id in self.batch_scored.index:
            return self.base._result(transaction_id, self.batch_scored.loc[transaction_id])
        return self.base.score_existing(transaction_id)

    def __getattr__(self, name):  # queue, latency_percentiles, ... delegate to base
        return getattr(self.base, name)


def validate_against_base(base: DataRepository, rows: pd.DataFrame) -> None:
    errors = []
    clash = rows["transaction_id"][rows["transaction_id"].isin(base._tx_by_id.index)]
    for i, t in clash.head(50).items():
        errors.append({"row": int(i) + 2, "field": "transaction_id", "error": f"{t} already exists in the base dataset"})
    known = rows[rows["account_id"].isin(base.accounts.index)]
    owner = known["account_id"].map(base.accounts["customer_id"])
    for i in known.index[owner != known["customer_id"]][:50]:
        errors.append({"row": int(i) + 2, "field": "account_id",
                       "error": f"{rows.at[i, 'account_id']} belongs to another customer"})
    acct_cust = rows.groupby("account_id")["customer_id"].nunique()
    for a in acct_cust[acct_cust > 1].index[:20]:
        errors.append({"row": None, "field": "account_id", "error": f"{a} is used by more than one customer"})
    if errors:
        raise UploadError(f"{len(errors)} consistency error(s); nothing was imported", errors)


def build_overlay(base_repo: DataRepository, base_scorer: Scorer, rows: pd.DataFrame,
                  labels: dict[str, int]) -> tuple[DataRepository, BatchScorer, FraudGraph, pd.DataFrame, dict]:
    t0 = time.perf_counter()
    validate_against_base(base_repo, rows)
    f = base_repo.frames
    start_day = lambda ts: int((pd.Timestamp(ts) - pd.Timestamp(base_repo.start)).total_seconds() // 86400)  # noqa: E731

    new_cust = rows[~rows["customer_id"].isin(base_repo.customers.index)].groupby("customer_id").first()
    customers = pd.concat([f["customers"], pd.DataFrame({
        "customer_id": new_cust.index, "account_id": new_cust["account_id"].to_numpy(), "segment": "unknown",
        "account_age_days": 0, "home_device": new_cust["device_id"].to_numpy()})], ignore_index=True)
    new_acc = rows[~rows["account_id"].isin(base_repo.accounts.index)].groupby("account_id").first()
    accounts = pd.concat([f["accounts"], pd.DataFrame({
        "account_id": new_acc.index, "customer_id": new_acc["customer_id"].to_numpy(),
        "txn_limit_paise": NEW_ACCOUNT_TXN_LIMIT_PAISE, "daily_limit_paise": NEW_ACCOUNT_DAILY_LIMIT_PAISE})],
        ignore_index=True)
    first_seen = rows.groupby("counterparty_id")["timestamp"].min()
    new_cp = first_seen[~first_seen.index.isin(base_repo.counterparties.index)]
    counterparties = pd.concat([f["counterparties"], pd.DataFrame({
        "counterparty_id": new_cp.index,
        "kind": ["recipient" if c.startswith("RCP-") else "merchant" for c in new_cp.index],
        "category": "unknown", "created_day": [start_day(ts) for ts in new_cp.to_numpy()]})], ignore_index=True)

    batch_tx = rows.assign(is_fraud=[labels.get(t, -1) for t in rows["transaction_id"]], scenario="uploaded")
    transactions = pd.concat([f["transactions"], batch_tx[f["transactions"].columns]], ignore_index=True)
    repo = DataRepository(frames={**f, "transactions": transactions, "customers": customers, "accounts": accounts,
                                  "counterparties": counterparties})

    # Point-in-time features: only rows that share a customer, device or counterparty with the batch matter
    tx = repo.transactions
    related = tx[tx["customer_id"].isin(rows["customer_id"]) | tx["device_id"].isin(rows["device_id"])
                 | tx["counterparty_id"].isin(rows["counterparty_id"])]
    feats = compute_features(related.drop(columns=["is_fraud", "scenario"]), repo.accounts, repo.counterparties,
                             repo.fraud_cases, repo.entity_links, repo.start)
    scored = base_scorer._model_scores(feats.loc[rows["transaction_id"]])
    scored["is_candidate"] = scored["risk_score"] >= base_scorer.threshold
    scorer = BatchScorer(base_scorer, scored)
    graph = FraudGraph(repo)

    summary = {"rows": int(len(rows)), "candidates": int(scored["is_candidate"].sum()),
               "candidate_rate": round(float(scored["is_candidate"].mean()), 5),
               "customers": int(rows["customer_id"].nunique()), "new_customers": int(len(new_cust)),
               "new_counterparties": int(len(new_cp)), "new_devices": int(rows.loc[~rows["device_id"].isin(base_repo._idx_by_device), "device_id"].nunique()),
               "processing_ms": round((time.perf_counter() - t0) * 1000, 1),
               "time_range": [rows["timestamp"].min().isoformat(), rows["timestamp"].max().isoformat()],
               "model_version": base_scorer.version, "threshold": round(float(base_scorer.threshold), 4)}
    if labels:
        y = np.array([labels.get(t, 0) for t in scored.index])
        flag = scored["is_candidate"].to_numpy()
        tp, fp = int((flag & (y == 1)).sum()), int((flag & (y == 0)).sum())
        pos = int((y == 1).sum())
        summary["labelled_metrics"] = {"fraud_rows": pos, "true_positives": tp, "false_positives": fp,
                                       "precision": round(tp / max(tp + fp, 1), 4) if flag.any() else None,
                                       "recall": round(tp / pos, 4) if pos else None}
    return repo, scorer, graph, scored, summary
