"""In-memory data repository (MVP). Loads the seeded Parquet dataset once at startup.

A BigQuery-backed implementation can expose the same methods for the scale story.
"""

from __future__ import annotations

from datetime import datetime
from functools import cached_property
from pathlib import Path

import pandas as pd

from app.config import settings
from app.data.generate import START


def _py(v):
    """Convert pandas/numpy scalars to plain Python (JSON/Pydantic friendly)."""
    if isinstance(v, pd.Timestamp):
        return v.to_pydatetime()
    if hasattr(v, "item") and not isinstance(v, str | bytes):
        try:
            return v.item()
        except (ValueError, AttributeError):
            return v
    return v


def _row(df: pd.DataFrame, key: str) -> dict:
    return {k: _py(v) for k, v in df.loc[key].to_dict().items()}


class DataRepository:
    def __init__(self, data_dir: Path | None = None) -> None:
        self.data_dir = Path(data_dir or settings.data_dir)
        if not (self.data_dir / "transactions.parquet").exists():
            raise FileNotFoundError(
                f"Dataset not found in {self.data_dir}. Run: uv run python -m app.data.generate")
        load = lambda n: pd.read_parquet(self.data_dir / f"{n}.parquet")  # noqa: E731
        self.transactions = load("transactions").sort_values("timestamp", kind="stable").reset_index(drop=True)
        self.customers = load("customers").set_index("customer_id", drop=False)
        self.accounts = load("accounts").set_index("account_id", drop=False)
        self.counterparties = load("counterparties").set_index("counterparty_id", drop=False)
        self.fraud_cases = load("fraud_cases")
        self.entity_links = load("entity_links")
        self.start: datetime = START
        self._tx_by_id = self.transactions.set_index("transaction_id", drop=False)
        self._idx_by_customer = self.transactions.groupby("customer_id").indices
        self._idx_by_device = self.transactions.groupby("device_id").indices
        self._idx_by_cp = self.transactions.groupby("counterparty_id").indices

    # ---- lookups ---------------------------------------------------------------------------------
    def get_transaction(self, transaction_id: str) -> dict | None:
        if transaction_id not in self._tx_by_id.index:
            return None
        row = self._tx_by_id.loc[transaction_id]
        return {k: _py(v) for k, v in row.items()}

    def public_transaction(self, transaction_id: str) -> dict | None:
        """Transaction without ground-truth label columns (labels are for evaluation only)."""
        t = self.get_transaction(transaction_id)
        if t is None:
            return None
        return {k: v for k, v in t.items() if k not in ("is_fraud", "scenario")}

    def customer(self, customer_id: str) -> dict | None:
        if customer_id not in self.customers.index:
            return None
        return _row(self.customers, customer_id)

    def account(self, account_id: str) -> dict | None:
        if account_id not in self.accounts.index:
            return None
        return _row(self.accounts, account_id)

    def counterparty(self, counterparty_id: str) -> dict | None:
        if counterparty_id not in self.counterparties.index:
            return None
        return _row(self.counterparties, counterparty_id)

    def customer_history(self, customer_id: str, before: datetime | None = None, days: int | None = None) -> pd.DataFrame:
        idx = self._idx_by_customer.get(customer_id)
        if idx is None:
            return self.transactions.iloc[0:0]
        h = self.transactions.iloc[idx]
        if before is not None:
            h = h[h["timestamp"] < pd.Timestamp(before)]
            if days is not None:
                h = h[h["timestamp"] >= pd.Timestamp(before) - pd.Timedelta(days=days)]
        return h.drop(columns=["is_fraud", "scenario"])

    def device_history(self, device_id: str, before: datetime | None = None) -> pd.DataFrame:
        idx = self._idx_by_device.get(device_id)
        if idx is None:
            return self.transactions.iloc[0:0]
        h = self.transactions.iloc[idx]
        if before is not None:
            h = h[h["timestamp"] < pd.Timestamp(before)]
        return h.drop(columns=["is_fraud", "scenario"])

    def counterparty_history(self, counterparty_id: str, before: datetime | None = None) -> pd.DataFrame:
        idx = self._idx_by_cp.get(counterparty_id)
        if idx is None:
            return self.transactions.iloc[0:0]
        h = self.transactions.iloc[idx]
        if before is not None:
            h = h[h["timestamp"] < pd.Timestamp(before)]
        return h.drop(columns=["is_fraud", "scenario"])

    def day_of(self, ts: datetime) -> int:
        return int((pd.Timestamp(ts) - pd.Timestamp(self.start)).total_seconds() // 86400)

    @cached_property
    def confirmed_fraud(self) -> pd.Series:
        fc = self.fraud_cases[self.fraud_cases["status"] == "confirmed"]
        return fc.groupby("entity_id")["confirmed_day"].min()


_repo: DataRepository | None = None


def get_repository() -> DataRepository:
    global _repo
    if _repo is None:
        _repo = DataRepository()
    return _repo
