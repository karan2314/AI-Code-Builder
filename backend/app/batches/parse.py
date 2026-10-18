"""Parse and validate uploaded transaction files (CSV or JSON) for the Upload & Test feature.

Strict by design: a file with any invalid row is rejected with a row-level error report, so a
batch is always internally consistent. Only pseudonymous IDs are accepted; files containing values
that look like personal data (card numbers, PAN, Aadhaar, emails, phone numbers) are refused.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pandas as pd

from app.data.generate import START

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 5000
MAX_AMOUNT_RUPEES = 10_000_000  # ₹1 crore per transaction
CHANNELS = {"upi", "card", "netbanking", "imps"}
REQUIRED = ["transaction_id", "customer_id", "account_id", "timestamp", "amount_rupees", "channel",
            "counterparty_id", "device_id"]
OPTIONAL = ["is_fraud"]
ID_RULES = {
    "transaction_id": re.compile(r"^TXN-[A-Z0-9-]{3,40}$"),
    "customer_id": re.compile(r"^CUST-[A-Z0-9-]{3,30}$"),
    "account_id": re.compile(r"^ACC-[A-Z0-9-]{3,30}$"),
    "counterparty_id": re.compile(r"^(MER|RCP)-[A-Z0-9-]{2,30}$"),
    "device_id": re.compile(r"^DEV-[A-Z0-9-]{2,30}$"),
}
PII_RULES = [
    (re.compile(r"\b(?:\d[ -]?){13,19}\b"), "card-number-like digits"),
    (re.compile(r"\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b"), "PAN-like identifier"),
    (re.compile(r"\b[2-9]\d{3}[ -]\d{4}[ -]\d{4}\b"), "Aadhaar-like number"),
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "email address"),
    (re.compile(r"(?<![\d.])(?:\+?91[ -]?)?[6-9]\d{9}(?![\d.])"), "phone number"),
]


class UploadError(ValueError):
    def __init__(self, message: str, errors: list[dict] | None = None) -> None:
        super().__init__(message)
        self.errors = errors or []


@dataclass
class ParsedBatch:
    rows: pd.DataFrame                     # normalized transactions (amount_paise, UTC-naive timestamps)
    labels: dict[str, int] = field(default_factory=dict)
    has_labels: bool = False


def _luhn(digits: str) -> bool:
    total = 0
    for i, d in enumerate(reversed([int(c) for c in digits])):
        total += (d * 2 - 9 if d * 2 > 9 else d * 2) if i % 2 else d
    return total % 10 == 0


def pii_findings(text: str) -> list[str]:
    found = []
    for rx, label in PII_RULES:
        for m in rx.finditer(text):
            if label == "card-number-like digits":
                digits = re.sub(r"\D", "", m.group(0))
                if not _luhn(digits):
                    continue
            found.append(label)
            break
    return found


def _decode(raw: bytes) -> str:
    if len(raw) > MAX_BYTES:
        raise UploadError(f"file too large: {len(raw):,} bytes (max {MAX_BYTES:,})")
    if not raw.strip():
        raise UploadError("file is empty")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise UploadError("file must be UTF-8 text (CSV or JSON)") from e


def _records(text: str, fmt: str) -> list[dict]:
    if fmt == "json":
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise UploadError(f"invalid JSON: {e.msg} (line {e.lineno})") from e
        if isinstance(data, dict):
            data = data.get("transactions")
        if not isinstance(data, list) or not all(isinstance(r, dict) for r in data):
            raise UploadError('JSON must be a list of transaction objects or {"transactions": [...]}')
        return data
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise UploadError("CSV has no header row")
    headers = [h.strip() for h in reader.fieldnames]
    missing = [c for c in REQUIRED if c not in headers]
    if missing:
        raise UploadError(f"missing required columns: {', '.join(missing)}",
                          [{"row": 1, "field": c, "error": "required column missing"} for c in missing])
    unknown = [h for h in headers if h not in REQUIRED + OPTIONAL]
    if unknown:
        raise UploadError(f"unknown columns: {', '.join(unknown[:5])}")
    return [{(k or "").strip(): (v or "").strip() for k, v in r.items()} for r in reader]


def _ts(value: str) -> datetime:
    t = pd.Timestamp(value)
    if t.tzinfo is not None:
        t = t.tz_convert("UTC").tz_localize(None)
    return t.to_pydatetime()


def parse_upload(raw: bytes, fmt: str) -> ParsedBatch:
    if fmt not in ("csv", "json"):
        raise UploadError("only CSV or JSON files are accepted")
    text = _decode(raw)
    pii = pii_findings(text)
    if pii:
        raise UploadError(f"file appears to contain personal data ({', '.join(sorted(set(pii)))}); "
                          "use pseudonymous IDs only (e.g. CUST-000123)")
    records = _records(text, fmt)
    if not records:
        raise UploadError("file contains no transactions")
    if len(records) > MAX_ROWS:
        raise UploadError(f"too many rows: {len(records):,} (max {MAX_ROWS:,})")

    now = datetime.now(UTC).replace(tzinfo=None)
    errors: list[dict] = []
    out: list[dict] = []
    labels: dict[str, int] = {}
    seen: set[str] = set()
    has_labels = any(str(r.get("is_fraud", "")).strip() != "" for r in records)
    for i, r in enumerate(records, start=2 if fmt == "csv" else 1):
        def err(field_name: str, msg: str, row_no=i) -> None:
            if len(errors) < 200:
                errors.append({"row": row_no, "field": field_name, "error": msg})

        row: dict = {}
        for col in REQUIRED:
            v = r.get(col)
            if v is None or str(v).strip() == "":
                err(col, "required")
                continue
            row[col] = str(v).strip()
        for col, rx in ID_RULES.items():
            if col in row:
                row[col] = row[col].upper()
                if not rx.match(row[col]):
                    err(col, f"invalid format '{row[col][:40]}'")
        if "transaction_id" in row:
            if row["transaction_id"] in seen:
                err("transaction_id", "duplicate in file")
            seen.add(row["transaction_id"])
        if "amount_rupees" in row:
            try:
                amt = float(row["amount_rupees"].replace(",", ""))
                if not (0 < amt <= MAX_AMOUNT_RUPEES):
                    err("amount_rupees", f"must be > 0 and <= {MAX_AMOUNT_RUPEES:,}")
                row["amount_paise"] = int(round(amt * 100))
            except ValueError:
                err("amount_rupees", "not a number")
        if "channel" in row:
            row["channel"] = row["channel"].lower()
            if row["channel"] not in CHANNELS:
                err("channel", f"must be one of {', '.join(sorted(CHANNELS))}")
        if "timestamp" in row:
            try:
                ts = _ts(row["timestamp"])
                if ts < START or ts > now + timedelta(days=1):
                    err("timestamp", f"must be between {START:%Y-%m-%d} and today")
                row["timestamp"] = ts
            except (ValueError, TypeError):
                err("timestamp", "invalid ISO-8601 timestamp (e.g. 2026-09-29T14:05:00)")
        if has_labels:
            lv = str(r.get("is_fraud", "")).strip()
            if lv not in ("0", "1", "0.0", "1.0", "true", "false", "True", "False"):
                err("is_fraud", "must be 0 or 1 when labels are provided")
            elif "transaction_id" in row:
                labels[row["transaction_id"]] = 1 if lv in ("1", "1.0", "true", "True") else 0
        out.append(row)
    if errors:
        raise UploadError(f"{len({e['row'] for e in errors})} row(s) have errors; nothing was imported", errors)
    df = pd.DataFrame(out)[["transaction_id", "customer_id", "account_id", "timestamp", "amount_paise", "channel",
                            "counterparty_id", "device_id"]]
    df["currency"] = "INR"
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return ParsedBatch(rows=df.sort_values("timestamp", kind="stable").reset_index(drop=True),
                       labels=labels, has_labels=has_labels)
