"""Helpers shared by investigation tools.

Every tool returns {"status": "ok", "result": {...}, "evidence": [ {kind, indicator_family, summary,
observed, baseline?} ]}. The investigation context assigns evidence IDs (EV-<case>-<n>).
Tools are deterministic: all numbers are computed here, never by the LLM.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from app.services import get_services

ID_PATTERNS = {
    "transaction_id": r"^TXN-[A-Z0-9-]{3,40}$",
    "customer_id": r"^CUST-[A-Z0-9-]{3,30}$",
    "account_id": r"^ACC-[A-Z0-9-]{3,30}$",
    "device_id": r"^DEV-[A-Z0-9-]{2,30}$",
    "counterparty_id": r"^(MER|RCP)-[A-Z0-9-]{2,30}$",
    "entity_id": r"^(CUST|DEV|MER|RCP)-[A-Z0-9-]{2,30}$",
}


class ToolInputError(ValueError):
    pass


def validate_args(args: dict[str, Any]) -> None:
    for key, value in args.items():
        pattern = ID_PATTERNS.get(key)
        if pattern and not (isinstance(value, str) and re.match(pattern, value)):
            raise ToolInputError(f"invalid {key}: {value!r}")
        if key == "entity_ids":
            if not isinstance(value, list) or len(value) > 25:
                raise ToolInputError("entity_ids must be a list of at most 25 IDs")
            for v in value:
                if not (isinstance(v, str) and re.match(ID_PATTERNS["entity_id"], v)):
                    raise ToolInputError(f"invalid entity id: {v!r}")
        if key == "days" and not (isinstance(value, int) and 1 <= value <= 365):
            raise ToolInputError("days must be between 1 and 365")


def txn_or_raise(transaction_id: str) -> dict:
    t = get_services().repo.public_transaction(transaction_id)
    if t is None:
        raise ToolInputError(f"unknown transaction {transaction_id}")
    return t


def features_or_raise(transaction_id: str):
    row = get_services().scorer.features_row(transaction_id)
    if row is None:
        raise ToolInputError(f"no features for {transaction_id}")
    return row


def rupees(paise: float) -> float:
    return round(float(paise) / 100.0, 2)


def ok(result: dict, evidence: list[dict]) -> dict:
    return {"status": "ok", "result": result, "evidence": evidence}


def iso(ts: datetime) -> str:
    return ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
