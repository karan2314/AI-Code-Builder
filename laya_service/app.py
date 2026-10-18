"""FraudLens Laya decision service (Variant C).

A private Cloud Run service (IAM-authenticated, never public) that runs the open-weight Laya
"System One" decision model on CPU. It answers a FIXED set of typed fraud-triage questions about a
candidate transaction's tool-computed features - callers cannot send arbitrary questions.

Laya is advisory only: FraudLens' deterministic policy engine decides tiers; Gemini remains the
generative AI. Weights are baked into the image at a reviewed, pinned revision and loaded offline.
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_ID = os.environ.get("LAYA_MODEL", "convaiinnovations/laya-typed-decisions")
REVISION = os.environ.get("LAYA_REVISION_SHA", "1a793eb568e6718f15941d08f85432581df534e3")
QUESTIONS_VERSION = "2026.10.1"

# Fixed question set (typed decisions). Wording refers only to fields present in the state.
FRAUD_QUESTIONS: dict[str, dict[str, Any]] = {
    "route": {
        "type": "choice",
        "instructions": "A bank fraud screening model flagged this payment. What should happen next?",
        "criteria": {
            "investigate": "several independent risk signals together: new or shared device, burst of payments, "
                           "payment far above the customer's usual amount, or recipient linked to confirmed fraud",
            "monitor": "only one unusual signal, otherwise consistent with the customer's history",
            "dismiss": "consistent with the customer's normal behaviour on a known device to a known recipient",
        },
    },
    "account_takeover": {
        "type": "noul",
        "instructions": "Does this look like an account takeover: an unfamiliar or shared device combined with "
                        "unusual payment activity?",
    },
    "mule_payment": {
        "type": "noul",
        "instructions": "Is the money going to a recipient linked to confirmed fraud or mule accounts?",
    },
    "urgency": {
        "type": "score",
        "instructions": "How urgently should a fraud analyst review this payment?",
        "criteria": ["can wait", "review today", "review within the hour", "review immediately"],
    },
}


class _Json(logging.Formatter):
    def format(self, r: logging.LogRecord) -> str:
        return json.dumps({"severity": r.levelname, "message": r.getMessage(), **getattr(r, "fields", {})})


_h = logging.StreamHandler(sys.stdout)
_h.setFormatter(_Json())
log = logging.getLogger("laya-service")
log.handlers, log.level = [_h], logging.INFO


class TriageRequest(BaseModel):
    case_id: str = Field(pattern=r"^[A-Z0-9-]{3,40}$")
    state: dict[str, Any] = Field(description="Tool-computed, pseudonymous features only")


_agent = None
_lock = threading.Lock()


def get_agent():
    global _agent
    if _agent is None:
        with _lock:
            if _agent is None:
                import laya  # torch import is slow; done once

                t0 = time.perf_counter()
                _agent = laya.load(MODEL_ID, device="cpu", revision=REVISION)
                log.info("model_loaded", extra={"fields": {"model": MODEL_ID, "revision": REVISION,
                                                           "load_s": round(time.perf_counter() - t0, 1)}})
    return _agent


app = FastAPI(title="FraudLens Laya decision service", docs_url=None, redoc_url=None, openapi_url=None)


@app.on_event("startup")
def _warm() -> None:
    get_agent()


@app.get("/healthz")
@app.get("/v1/health")  # Cloud Run's front end reserves /healthz for external requests
def healthz() -> dict:
    return {"status": "ok", "model": MODEL_ID, "revision": REVISION, "loaded": _agent is not None,
            "questions_version": QUESTIONS_VERSION}


def _compact(answer: dict[str, Any]) -> dict[str, Any]:
    keep = ("choice", "probabilities", "noul", "score", "level", "confidence")
    return {k: v for k, v in answer.items() if k in keep}


@app.post("/v1/fraud-triage")
def fraud_triage(req: TriageRequest) -> dict:
    if len(json.dumps(req.state)) > 4000:
        raise HTTPException(413, "state too large")
    t0 = time.perf_counter()
    try:
        result = get_agent().predict(req.state, FRAUD_QUESTIONS)
    except Exception as e:  # never leak internals
        log.error("predict_failed", extra={"fields": {"case_id": req.case_id, "error": type(e).__name__}})
        raise HTTPException(500, "decision failed") from e
    latency = round((time.perf_counter() - t0) * 1000, 1)
    answers = {k: _compact(v) for k, v in (result.get("answers") or {}).items()}
    log.info("laya_decision", extra={"fields": {"case_id": req.case_id, "latency_ms": latency,
                                                "route": answers.get("route", {}).get("choice")}})
    return {"case_id": req.case_id, "answers": answers, "model": MODEL_ID, "revision": REVISION,
            "questions_version": QUESTIONS_VERSION, "latency_ms": latency}
