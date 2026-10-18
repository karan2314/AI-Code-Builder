"""Transaction Analysis tools: velocity, device history, counterparty familiarity, ML score."""

from __future__ import annotations

import pandas as pd

from app.services import get_services
from app.tools.common import ToolInputError, features_or_raise, iso, ok, txn_or_raise


def calculate_velocity(transaction_id: str) -> dict:
    """Count the customer's transactions in the 10 minutes, 1 hour and 24 hours BEFORE this transaction,
    compared with the customer's normal daily rate."""
    t = txn_or_raise(transaction_id)
    f = features_or_raise(transaction_id)
    h = get_services().repo.customer_history(t["customer_id"], before=t["timestamp"], days=30)
    per_day = round(len(h) / 30, 2)
    result = {"count_10m": int(f["cnt_10m"]), "count_1h": int(f["cnt_1h"]), "count_24h": int(f["cnt_24h"]),
              "value_1h_vs_median": round(float(f["sum_1h_ratio"]), 2), "baseline_txns_per_day": per_day}
    return ok(result, [{"kind": "velocity", "indicator_family": "velocity",
                        "summary": (f"{result['count_10m']} txns in prior 10 min, {result['count_1h']} in prior hour "
                                    f"(baseline ~{per_day}/day)"),
                        "observed": {k: result[k] for k in ("count_10m", "count_1h", "count_24h", "value_1h_vs_median")},
                        "baseline": {"txns_per_day": per_day}}])


def get_device_history(device_id: str, transaction_id: str) -> dict:
    """Get the history of a device BEFORE the transaction: when this customer first used it, how many other
    customers used it, and whether it was used to pay confirmed-fraud entities."""
    t = txn_or_raise(transaction_id)
    svc = get_services()
    f = features_or_raise(transaction_id)
    h = svc.repo.device_history(device_id, before=t["timestamp"])
    own = h[h["customer_id"] == t["customer_id"]]
    first_own = own["timestamp"].min() if not own.empty else pd.Timestamp(t["timestamp"])
    hours_since = round((pd.Timestamp(t["timestamp"]) - first_own).total_seconds() / 3600, 2)
    others = sorted(set(h["customer_id"]) - {t["customer_id"]})
    fraud_payees = sorted({cp for cp in h["counterparty_id"] if svc.graph.fraud_status(cp, t["timestamp"]) == "confirmed"})
    result = {"device_id": device_id, "first_used_by_customer": iso(first_own),
              "hours_since_first_use_by_customer": hours_since, "is_new_device": bool(f["device_new"]),
              "other_customers_on_device": len(others), "other_customer_ids": others[:10],
              "prior_payments_to_confirmed_fraud": int(f["device_paid_fraud_prior"]),
              "confirmed_fraud_payees": fraud_payees[:10]}
    summary = (f"Device {device_id} first used by this customer {hours_since}h before; "
               f"{len(others)} other customer(s) used it; {result['prior_payments_to_confirmed_fraud']} prior payment(s) "
               f"to confirmed-fraud entities")
    return ok(result, [{"kind": "device_novelty", "indicator_family": "device", "summary": summary,
                        "observed": {k: result[k] for k in ("is_new_device", "hours_since_first_use_by_customer",
                                                            "other_customers_on_device",
                                                            "prior_payments_to_confirmed_fraud")}}])


def get_merchant_history(customer_id: str, counterparty_id: str, transaction_id: str) -> dict:
    """Get how familiar the customer is with this merchant/recipient (prior payments BEFORE the transaction),
    plus the counterparty's age and how many distinct customers paid it before."""
    t = txn_or_raise(transaction_id)
    svc = get_services()
    cp = svc.repo.counterparty(counterparty_id)
    if cp is None:
        raise ToolInputError(f"unknown counterparty {counterparty_id}")
    f = features_or_raise(transaction_id)
    h = svc.repo.customer_history(customer_id, before=t["timestamp"])
    prior = int((h["counterparty_id"] == counterparty_id).sum())
    result = {"counterparty_id": counterparty_id, "kind": cp["kind"], "category": cp["category"],
              "prior_payments_by_customer": prior, "is_new_counterparty": prior == 0,
              "counterparty_age_days": int(f["cp_age_days"]), "distinct_prior_senders": int(f["cp_prior_senders"])}
    summary = (f"{'New' if prior == 0 else 'Known'} {cp['kind']} ({prior} prior payments), account age "
               f"{result['counterparty_age_days']} days, {result['distinct_prior_senders']} other prior senders")
    return ok(result, [{"kind": "counterparty_familiarity", "indicator_family": "behavior", "summary": summary,
                        "observed": {k: result[k] for k in ("is_new_counterparty", "prior_payments_by_customer",
                                                            "counterparty_age_days", "distinct_prior_senders")}}])


def get_ml_risk_score(transaction_id: str) -> dict:
    """Get the first-stage ML risk score (0-1), model version, rule reason codes and top contributing features."""
    s = get_services().scorer.score_existing(transaction_id)
    if s is None:
        raise ToolInputError(f"unknown transaction {transaction_id}")
    result = s.model_dump()
    return ok(result, [{"kind": "ml_score", "indicator_family": "ml",
                        "summary": f"ML risk {s.risk_score:.2f} (model {s.model_version}); reasons: {', '.join(s.reason_codes) or 'none'}",
                        "observed": {"risk_score": s.risk_score, "ml_score": s.ml_score, "rules_score": s.rules_score,
                                     "anomaly_score": s.anomaly_score, "is_candidate": s.is_candidate,
                                     "reason_codes": s.reason_codes, "model_version": s.model_version}}])
