"""Variant C (Laya decision model) integration: advisory evidence, failure handling, flag gating, service."""

import importlib.util
import sys
from pathlib import Path

import pytest

import app.ai.laya_client as laya_client
import app.cases.service as svc_mod
from app.agents.context import InvestigationContext
from app.cases import service
from app.data.generate import BENIGN_TXN, HERO_TXN
from app.tools.laya import laya_state

FAKE = {"answers": {"route": {"choice": "investigate", "probabilities": {"investigate": 0.8, "monitor": 0.15, "dismiss": 0.05},
                              "confidence": 0.8},
                    "account_takeover": {"noul": 0.91, "confidence": 0.91},
                    "mule_payment": {"noul": 0.77, "confidence": 0.77},
                    "urgency": {"score": 2.6, "confidence": 0.7}},
        "model": "convaiinnovations/laya-typed-decisions", "revision": "1a793eb568e6", "latency_ms": 41.0,
        "questions_version": "2026.10.1"}


@pytest.fixture
def laya_on(monkeypatch):
    monkeypatch.setattr(svc_mod.settings, "enable_laya", True)
    calls = []

    def fake(case_id, state):
        calls.append(state)
        return FAKE

    monkeypatch.setattr(laya_client, "triage", fake)
    return calls


def test_state_has_no_ids_or_labels(services):
    s = laya_state(HERO_TXN)
    text = str(s)
    assert "CUST-" not in text and "DEV-" not in text and "RCP-" not in text and "is_fraud" not in text
    assert s["velocity"]["payments_in_previous_10_min"] == 4 and s["device"]["new_for_customer"] is True


def test_laya_evidence_is_advisory(services, laya_on):
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=False)
    ev = [e for e in case.evidence if e.kind == "laya_decision"]
    assert len(ev) == 1 and ev[0].indicator_family == "ml" and ev[0].observed["route"] == "investigate"
    assert "ml" not in case.decision.critical_families
    assert case.decision.tier == 3 and case.decision.laya_route == "investigate" and not case.decision.laya_disagreement
    assert laya_on, "Laya service was called"


def test_laya_disagreement_is_flagged_not_decisive(services, laya_on):
    case = service.investigate(service.create_case(BENIGN_TXN).case_id, use_ai=False)
    assert case.decision.tier == 1  # Laya said "investigate", policy still decides
    assert case.decision.laya_disagreement and "laya_suggests_investigate" in case.decision.flags


def test_laya_failure_becomes_unavailable_evidence(services, monkeypatch):
    monkeypatch.setattr(svc_mod.settings, "enable_laya", True)

    def down(case_id, state):
        raise laya_client.LayaUnavailable("HTTP 503")

    monkeypatch.setattr(laya_client, "triage", down)
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=False)
    ev = [e for e in case.evidence if e.source_tool == "get_laya_decision"]
    assert ev and ev[0].status == "unavailable" and case.decision.tier == 3


def test_laya_disabled_by_default(services):
    txn = services.repo.public_transaction(HERO_TXN)
    with InvestigationContext("CASE-LOFF", txn) as ctx:
        assert ctx.run_tool("t", "get_laya_decision", transaction_id=HERO_TXN)["status"] == "blocked"
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=False)
    assert not [e for e in case.evidence if e.source_tool == "get_laya_decision"]


def test_client_refuses_when_disabled_or_insecure(monkeypatch):
    with pytest.raises(laya_client.LayaUnavailable):
        laya_client.triage("C-1", {})
    monkeypatch.setattr(laya_client.settings, "enable_laya", True)
    monkeypatch.setattr(laya_client.settings, "laya_url", "http://evil.example.com")
    with pytest.raises(laya_client.LayaUnavailable):
        laya_client.triage("C-1", {})


def _load_service_module():
    path = Path(__file__).resolve().parents[2] / "laya_service" / "app.py"
    spec = importlib.util.spec_from_file_location("laya_service_app", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["laya_service_app"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_laya_service_contract(monkeypatch):
    from fastapi.testclient import TestClient

    mod = _load_service_module()

    class FakeAgent:
        def predict(self, state, questions):
            assert set(questions) == {"route", "account_takeover", "mule_payment", "urgency"}
            return {"answers": {"route": {"type": "choice", "choice": "monitor", "probabilities": {"monitor": 0.6},
                                          "confidence": 0.6, "action": None, "legend": {}}}}

    monkeypatch.setattr(mod, "get_agent", lambda: FakeAgent())
    monkeypatch.setattr(mod, "_agent", object())
    with TestClient(mod.app) as c:
        r = c.post("/v1/fraud-triage", json={"case_id": "C-HERO-185K", "state": {"a": 1}}).json()
        assert r["answers"]["route"] == {"choice": "monitor", "probabilities": {"monitor": 0.6}, "confidence": 0.6}
        assert c.post("/v1/fraud-triage", json={"case_id": "bad id!", "state": {}}).status_code == 422
        assert c.post("/v1/fraud-triage", json={"case_id": "C-1", "state": {"x": "y" * 5000}}).status_code == 413
        assert c.get("/docs").status_code == 404
