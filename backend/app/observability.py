"""Structured JSON logging (Cloud Logging parses JSON written to stdout)."""

import json
import logging
import sys
import time
from typing import Any

_LOGGER_NAME = "fraudlens"


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "severity": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
        }
        extra = getattr(record, "fields", None)
        if isinstance(extra, dict):
            payload.update(extra)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)


def get_logger() -> logging.Logger:
    return logging.getLogger(_LOGGER_NAME)


def log_event(event: str, level: int = logging.INFO, **fields: Any) -> None:
    """Log one structured event, e.g. log_event("llm_call", model=..., latency_ms=...)."""
    get_logger().log(level, event, extra={"fields": {"event": event, **fields}})
