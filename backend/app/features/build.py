"""Point-in-time feature engineering for first-stage screening.

Every feature for a transaction at time t is computed ONLY from rows strictly earlier than t
(shifted rolling windows, closed="left" time windows, first-use timestamps < t, fraud cases
confirmed before the transaction day). A unit test guards against leakage.
"""

from __future__ import annotations

from datetime import datetime

import numpy as np
import pandas as pd

FRAUD_LINK_RECENCY_DAYS = 180
HISTORY_WINDOW = 100
LIMITED_HISTORY_MIN = 5

FEATURE_COLUMNS = [
    "amount_rupees", "log_amount", "prior_count", "limited_history", "prior_median", "prior_p95",
    "amt_ratio_median", "amt_ratio_p95", "cnt_10m", "cnt_1h", "sum_1h_ratio", "cnt_24h",
    "device_new", "device_other_customers", "device_paid_fraud_prior", "cp_new", "cp_is_recipient",
    "cp_prior_senders", "cp_age_days", "cp_fraud_confirmed", "cp_linked_fraud", "hour_dev",
    "txn_limit_util", "daily_limit_util", "is_imps", "is_upi", "is_card",
]


def _day(ts: pd.Series, start: datetime) -> np.ndarray:
    return ((ts - pd.Timestamp(start)).dt.total_seconds() // 86400).astype(int).to_numpy()


def _prior_distinct_others(tx: pd.DataFrame, entity_col: str, is_first_use: pd.Series) -> np.ndarray:
    """Distinct OTHER customers that used `entity_col` strictly before each transaction."""
    first_use = tx.groupby([entity_col, "customer_id"], sort=False)["timestamp"].min()
    out = np.zeros(len(tx), dtype=np.int64)
    ts_all = tx["timestamp"].to_numpy()
    for entity, idx in tx.groupby(entity_col, sort=False).indices.items():
        times = np.sort(first_use.loc[entity].to_numpy())
        if len(times) <= 1:
            continue
        cnt = np.searchsorted(times, ts_all[idx], side="left")
        own_before = (~is_first_use.to_numpy()[idx]).astype(np.int64)
        out[idx] = np.maximum(cnt - own_before, 0)
    return out


def compute_features(tx: pd.DataFrame, accounts: pd.DataFrame, counterparties: pd.DataFrame,
                     fraud_cases: pd.DataFrame, entity_links: pd.DataFrame, start: datetime) -> pd.DataFrame:
    """Return a DataFrame indexed like `tx` (by transaction_id) with FEATURE_COLUMNS."""
    df = tx[["transaction_id", "customer_id", "account_id", "timestamp", "amount_paise", "channel",
             "counterparty_id", "device_id"]].copy()
    df = df.sort_values(["customer_id", "timestamp", "transaction_id"], kind="stable").reset_index(drop=True)
    df["amount_rupees"] = df["amount_paise"] / 100.0
    df["log_amount"] = np.log1p(df["amount_rupees"])
    df["day"] = _day(df["timestamp"], start)

    g = df.groupby("customer_id", sort=False)
    df["prior_count"] = g.cumcount()
    df["limited_history"] = (df["prior_count"] < LIMITED_HISTORY_MIN).astype(int)
    shifted = g["amount_rupees"].shift(1)
    df["prior_median"] = shifted.groupby(df["customer_id"], sort=False).transform(
        lambda s: s.rolling(HISTORY_WINDOW, min_periods=1).median())
    df["prior_p95"] = shifted.groupby(df["customer_id"], sort=False).transform(
        lambda s: s.rolling(HISTORY_WINDOW, min_periods=1).quantile(0.95))
    # cohort fallback for customers without history
    cohort_median = float(df["amount_rupees"].median())
    df["prior_median"] = df["prior_median"].fillna(cohort_median)
    df["prior_p95"] = df["prior_p95"].fillna(cohort_median * 5)
    df["amt_ratio_median"] = df["amount_rupees"] / df["prior_median"].clip(lower=1)
    df["amt_ratio_p95"] = df["amount_rupees"] / df["prior_p95"].clip(lower=1)

    # velocity (time windows, strictly before the transaction)
    s = df.set_index("timestamp").groupby("customer_id", sort=False)["amount_rupees"]
    df["cnt_10m"] = s.rolling("10min", closed="left").count().fillna(0).to_numpy()
    df["cnt_1h"] = s.rolling("1h", closed="left").count().fillna(0).to_numpy()
    sum_1h = s.rolling("1h", closed="left").sum().fillna(0).to_numpy()
    df["sum_1h_ratio"] = sum_1h / df["prior_median"].clip(lower=1)
    df["cnt_24h"] = s.rolling("24h", closed="left").count().fillna(0).to_numpy()

    # device novelty and sharing
    dev_first = df.groupby(["customer_id", "device_id"], sort=False).cumcount() == 0
    # "new device": this customer first used the device within the last 24h, after having used others.
    # Only rows at or before t are involved (the first-use row precedes or is the current row).
    dev_first_ts = df["timestamp"].where(dev_first).groupby(
        [df["customer_id"], df["device_id"]], sort=False).transform("first")
    cust_first_ts = df.groupby("customer_id", sort=False)["timestamp"].transform("first")
    df["device_new"] = (((df["timestamp"] - dev_first_ts) <= pd.Timedelta(hours=24))
                        & (dev_first_ts > cust_first_ts)).astype(int)
    df["device_other_customers"] = _prior_distinct_others(df, "device_id", dev_first)

    # counterparty novelty, fan-in, age
    cp_first = df.groupby(["customer_id", "counterparty_id"], sort=False).cumcount() == 0
    df["cp_new"] = cp_first.astype(int)
    df["cp_prior_senders"] = _prior_distinct_others(df, "counterparty_id", cp_first)
    cp = counterparties.set_index("counterparty_id")
    df["cp_is_recipient"] = (df["counterparty_id"].map(cp["kind"]) == "recipient").astype(int)
    df["cp_age_days"] = (df["day"] - df["counterparty_id"].map(cp["created_day"]).fillna(-1000).astype(int)).clip(upper=3650)

    # known fraud (point in time: confirmed strictly before the transaction day, within recency window)
    fc = fraud_cases[fraud_cases["status"] == "confirmed"].groupby("entity_id")["confirmed_day"].min()
    conf_day = df["counterparty_id"].map(fc)
    age = df["day"] - conf_day
    df["cp_fraud_confirmed"] = ((age > 0) & (age <= FRAUD_LINK_RECENCY_DAYS)).fillna(False).astype(int)

    # linked fraud: counterparty shares a device with a confirmed-fraud entity (confirmed before t)
    dev_members = entity_links.groupby("entity_b")["entity_a"].apply(list).to_dict()
    neighbours: dict[str, list[int]] = {}
    for members in dev_members.values():
        for m in members:
            days = [int(fc[o]) for o in members if o != m and o in fc.index]
            if days:
                neighbours.setdefault(m, []).extend(days)
    day_arr = df["day"].to_numpy()
    linked = np.zeros(len(df), dtype=np.int64)
    for i, (c, d) in enumerate(zip(df["counterparty_id"].to_numpy(), day_arr, strict=True)):
        days = neighbours.get(c)
        if days:
            linked[i] = sum(1 for x in days if 0 < d - x <= FRAUD_LINK_RECENCY_DAYS)
    df["cp_linked_fraud"] = linked

    # device previously used to pay a confirmed-fraud counterparty (any customer)
    by_dev = df.sort_values(["device_id", "timestamp"], kind="stable")
    hit = (by_dev["cp_fraud_confirmed"] == 1).astype(int)
    prior_hits = hit.groupby(by_dev["device_id"], sort=False).cumsum() - hit
    df["device_paid_fraud_prior"] = prior_hits.reindex(df.index).to_numpy()

    # time-of-day deviation from the customer's own habit
    hour = df["timestamp"].dt.hour + df["timestamp"].dt.minute / 60
    prior_hour = hour.groupby(df["customer_id"], sort=False).transform(lambda x: x.shift(1).expanding().mean())
    diff = (hour - prior_hour.fillna(hour)).abs()
    df["hour_dev"] = np.minimum(diff, 24 - diff)

    # limits
    acc = accounts.set_index("account_id")
    df["txn_limit_util"] = df["amount_paise"] / df["account_id"].map(acc["txn_limit_paise"]).astype(float)
    daily_cum = df.groupby(["customer_id", "day"], sort=False)["amount_paise"].cumsum()
    df["daily_limit_util"] = daily_cum / df["account_id"].map(acc["daily_limit_paise"]).astype(float)

    df["is_imps"] = (df["channel"] == "imps").astype(int)
    df["is_upi"] = (df["channel"] == "upi").astype(int)
    df["is_card"] = (df["channel"] == "card").astype(int)

    out = df.set_index("transaction_id")[FEATURE_COLUMNS + ["day"]]
    return out.astype(float)
