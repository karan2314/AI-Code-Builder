"""Customer Behavior tools: profile, history baseline, limits, deviation from the customer's own norm."""

from __future__ import annotations

import numpy as np

from app.services import get_services
from app.tools.common import ToolInputError, features_or_raise, ok, rupees, txn_or_raise


def get_customer_profile(customer_id: str) -> dict:
    """Get the customer's profile: segment, account age and home device. Use first to understand who the customer is."""
    c = get_services().repo.customer(customer_id)
    if c is None:
        raise ToolInputError(f"unknown customer {customer_id}")
    result = {"customer_id": customer_id, "segment": c["segment"], "account_age_days": int(c["account_age_days"]),
              "home_device": c["home_device"]}
    return ok(result, [{"kind": "profile", "indicator_family": "context",
                        "summary": f"{c['segment']} customer, account age {int(c['account_age_days'])} days",
                        "observed": result}])


def get_transaction_history(customer_id: str, transaction_id: str, days: int = 90) -> dict:
    """Summarise the customer's transaction history BEFORE the transaction under investigation
    (count, median, p95, transactions per active day, usual channels and devices). Returns aggregates only."""
    t = txn_or_raise(transaction_id)
    h = get_services().repo.customer_history(customer_id, before=t["timestamp"], days=days)
    if h.empty:
        return ok({"prior_transactions": 0, "limited_history": True},
                  [{"kind": "history_summary", "indicator_family": "context",
                    "summary": "No prior transactions in the window: limited history, cohort baseline needed",
                    "observed": {"prior_transactions": 0, "limited_history": True}}])
    amt = h["amount_paise"] / 100
    active_days = h["timestamp"].dt.normalize().nunique()
    result = {
        "window_days": days, "prior_transactions": int(len(h)),
        "median_rupees": round(float(amt.median()), 2), "p95_rupees": round(float(np.percentile(amt, 95)), 2),
        "max_rupees": round(float(amt.max()), 2), "txns_per_active_day": round(len(h) / max(active_days, 1), 2),
        "channels": h["channel"].value_counts().head(3).to_dict(),
        "devices_used": h["device_id"].value_counts().head(3).to_dict(),
        "limited_history": bool(len(h) < 5),
    }
    return ok(result, [{"kind": "history_summary", "indicator_family": "context",
                        "summary": (f"{result['prior_transactions']} prior txns in {days}d, median ₹{result['median_rupees']:,.0f},"
                                    f" ~{result['txns_per_active_day']} txns/active day"),
                        "observed": result}])


def get_account_limits(account_id: str, transaction_id: str) -> dict:
    """Get the account's per-transaction and daily limits and how much of them this transaction uses."""
    acc = get_services().repo.account(account_id)
    if acc is None:
        raise ToolInputError(f"unknown account {account_id}")
    f = features_or_raise(transaction_id)
    result = {"txn_limit_rupees": rupees(acc["txn_limit_paise"]), "daily_limit_rupees": rupees(acc["daily_limit_paise"]),
              "txn_limit_utilisation": round(float(f["txn_limit_util"]), 3),
              "daily_limit_utilisation": round(float(f["daily_limit_util"]), 3)}
    return ok(result, [{"kind": "limit_utilization", "indicator_family": "behavior",
                        "summary": (f"Uses {result['txn_limit_utilisation']:.0%} of the per-transaction limit and "
                                    f"{result['daily_limit_utilisation']:.0%} of the daily limit"),
                        "observed": {"txn_limit_utilisation": result["txn_limit_utilisation"],
                                     "daily_limit_utilisation": result["daily_limit_utilisation"]},
                        "baseline": {"txn_limit_rupees": result["txn_limit_rupees"],
                                     "daily_limit_rupees": result["daily_limit_rupees"]}}])


def calculate_customer_deviation(customer_id: str, transaction_id: str) -> dict:
    """Compare the transaction amount and time with the customer's OWN baseline (median, p95, usual hour).
    Falls back to the cohort baseline when the customer has limited history."""
    t = txn_or_raise(transaction_id)
    if t["customer_id"] != customer_id:
        raise ToolInputError("transaction does not belong to this customer")
    f = features_or_raise(transaction_id)
    limited = bool(f["limited_history"])
    result = {
        "amount_rupees": rupees(t["amount_paise"]),
        "baseline_median_rupees": round(float(f["prior_median"]), 2),
        "baseline_p95_rupees": round(float(f["prior_p95"]), 2),
        "ratio_to_median": round(float(f["amt_ratio_median"]), 2),
        "ratio_to_p95": round(float(f["amt_ratio_p95"]), 2),
        "hour_deviation_hours": round(float(f["hour_dev"]), 1),
        "prior_transactions": int(f["prior_count"]),
        "limited_history": limited,
        "baseline_source": "cohort" if limited else "customer",
    }
    summary = (f"₹{result['amount_rupees']:,.0f} is {result['ratio_to_median']}x the {result['baseline_source']} "
               f"median of ₹{result['baseline_median_rupees']:,.0f}")
    return ok(result, [{"kind": "amount_deviation", "indicator_family": "behavior", "summary": summary,
                        "observed": {k: result[k] for k in ("amount_rupees", "ratio_to_median", "ratio_to_p95",
                                                            "hour_deviation_hours", "limited_history")},
                        "baseline": {"median_rupees": result["baseline_median_rupees"],
                                     "p95_rupees": result["baseline_p95_rupees"],
                                     "source": result["baseline_source"]}}])
