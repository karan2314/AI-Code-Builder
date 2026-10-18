"""Laya decision tool (BRD Variant C, `get_jev_decision` slot, implemented with the open Laya model).

Advisory only: produces one evidence item in the `ml` family, which the policy engine never counts as
an independent indicator. All numbers in the state come from deterministic features.
"""

from __future__ import annotations

from app.ai import laya_client
from app.tools.common import features_or_raise, ok, txn_or_raise


def laya_state(transaction_id: str) -> dict:
    """Pseudonymous, tool-computed features describing the candidate (no IDs, no labels, no raw history)."""
    t = txn_or_raise(transaction_id)
    f = features_or_raise(transaction_id)
    return {
        "payment": {"channel": t["channel"], "amount_rupees": round(t["amount_paise"] / 100),
                    "times_customer_median": round(float(f["amt_ratio_median"]), 1),
                    "above_customer_95th_percentile": bool(f["amt_ratio_p95"] > 1),
                    "share_of_daily_limit": round(float(f["daily_limit_util"]), 2)},
        "customer_history": {"prior_payments": int(f["prior_count"]), "limited_history": bool(f["limited_history"]),
                             "hours_from_usual_time": round(float(f["hour_dev"]), 1)},
        "velocity": {"payments_in_previous_10_min": int(f["cnt_10m"]), "payments_in_previous_hour": int(f["cnt_1h"])},
        "device": {"new_for_customer": bool(f["device_new"]),
                   "other_customers_on_device": int(f["device_other_customers"]),
                   "previously_paid_confirmed_fraud": int(f["device_paid_fraud_prior"])},
        "recipient": {"new_for_customer": bool(f["cp_new"]), "is_person": bool(f["cp_is_recipient"]),
                      "account_age_days": int(f["cp_age_days"]), "other_senders_before": int(f["cp_prior_senders"]),
                      "is_confirmed_fraud": bool(f["cp_fraud_confirmed"]),
                      "shares_device_with_confirmed_fraud": int(f["cp_linked_fraud"])},
    }


def get_laya_decision(transaction_id: str) -> dict:
    """Ask the Laya decision model (fast, typed, calibrated) to triage the candidate: route
    (investigate / monitor / dismiss), account-takeover and mule-payment probabilities, and urgency.
    Advisory evidence only; the policy engine decides the tier."""
    state = laya_state(transaction_id)
    r = laya_client.triage(transaction_id.replace("TXN-", "C-"), state)
    a = r.get("answers", {})
    route = a.get("route", {})
    observed = {
        "route": route.get("choice"), "route_confidence": route.get("confidence"),
        "route_probs": route.get("probabilities"),
        "p_account_takeover": a.get("account_takeover", {}).get("noul"),
        "p_mule_payment": a.get("mule_payment", {}).get("noul"),
        "urgency_score": a.get("urgency", {}).get("score"),
        "model": r.get("model"), "revision": (r.get("revision") or "")[:12], "latency_ms": r.get("latency_ms"),
    }

    def p(x):
        return f"{x:.2f}" if isinstance(x, int | float) else "n/a"

    summary = (f"Laya triage: route={observed['route']} (conf {p(observed['route_confidence'])}), "
               f"P(account takeover)={p(observed['p_account_takeover'])}, P(mule payment)={p(observed['p_mule_payment'])}")
    return ok({**observed, "questions_version": r.get("questions_version")},
              [{"kind": "laya_decision", "indicator_family": "ml", "summary": summary, "observed": observed}])
