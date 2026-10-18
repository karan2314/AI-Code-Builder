"""Baseline A: transparent rules with human-readable reason codes (vectorized)."""

from __future__ import annotations

import numpy as np
import pandas as pd

# code: (weight, predicate over the feature frame, description)
RULES: dict[str, tuple[float, callable, str]] = {
    "RECIPIENT_KNOWN_FRAUD": (0.45, lambda f: f.cp_fraud_confirmed > 0, "Counterparty is a confirmed-fraud entity"),
    "RECIPIENT_LINKED_FRAUD": (0.30, lambda f: f.cp_linked_fraud > 0, "Counterparty shares a device with confirmed-fraud entities"),
    "DEVICE_LINKED_FRAUD": (0.30, lambda f: f.device_paid_fraud_prior > 0, "Device previously paid a confirmed-fraud entity"),
    "AMT_GT_5X_MEDIAN": (0.25, lambda f: (f.amt_ratio_median >= 5) & (f.limited_history == 0), "Amount at least 5x the customer's median"),
    "AMT_GT_P95_CUSTOMER": (0.10, lambda f: (f.amt_ratio_p95 > 1) & (f.limited_history == 0), "Amount above the customer's 95th percentile"),
    "NEW_DEVICE": (0.20, lambda f: f.device_new > 0, "First transaction from this device"),
    "DEVICE_SHARED": (0.15, lambda f: f.device_other_customers > 0, "Device previously used by other customers"),
    "VELOCITY_10M": (0.20, lambda f: f.cnt_10m >= 3, "3+ transactions in the previous 10 minutes"),
    "MICRO_TXN_BURST": (0.25, lambda f: (f.amount_rupees < 100) & (f.cnt_10m >= 3), "Burst of very small transactions"),
    "NEW_COUNTERPARTY_HIGH_VALUE": (0.15, lambda f: (f.cp_new > 0) & (f.amt_ratio_median >= 3), "High-value payment to a new counterparty"),
    "YOUNG_RECIPIENT": (0.10, lambda f: (f.cp_is_recipient > 0) & (f.cp_age_days < 60), "Recipient account opened < 60 days ago"),
    "LIMIT_UTIL_HIGH": (0.10, lambda f: (f.txn_limit_util >= 0.9) | (f.daily_limit_util >= 0.9), "Limit utilisation >= 90%"),
    "UNUSUAL_HOUR": (0.05, lambda f: f.hour_dev >= 6, "Unusual time of day for this customer"),
}
INFO_CODES = {"LIMITED_HISTORY": lambda f: f.limited_history > 0}


def rule_matrix(features: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame({code: pred(features).astype(bool) for code, (_, pred, _) in RULES.items()},
                        index=features.index)


def rules_score(features: pd.DataFrame) -> pd.Series:
    m = rule_matrix(features)
    weights = np.array([RULES[c][0] for c in m.columns])
    return pd.Series(np.clip(m.to_numpy() @ weights, 0, 1), index=features.index, name="rules_score")


def reason_codes(row: pd.Series) -> list[str]:
    f = row.to_frame().T
    codes = [code for code, (_, pred, _) in RULES.items() if bool(pred(f).iloc[0])]
    codes += [code for code, pred in INFO_CODES.items() if bool(pred(f).iloc[0])]
    return codes


def describe(code: str) -> str:
    if code in RULES:
        return RULES[code][2]
    return {"LIMITED_HISTORY": "Customer has limited transaction history"}.get(code, code)
