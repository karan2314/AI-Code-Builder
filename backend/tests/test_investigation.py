
from app.agents.context import InvestigationContext
from app.ai.synthesis import build_evidence_package, validate_citations
from app.cases import service
from app.data.generate import BENIGN_TXN, HERO_TXN
from app.schemas import AnalystAction, Finding, InvestigationSummary


def test_hero_case_reaches_contain_without_llm(services):
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=False)
    assert case.decision.tier == 3
    assert case.investigation_mode == "deterministic_fallback"
    kinds = {e.kind for e in case.evidence}
    assert {"amount_deviation", "velocity", "device_novelty", "network_metrics", "known_fraud_link"} <= kinds
    assert all(a["simulated"] for a in case.simulated_actions)
    events = [a.event_type for a in services.cases.audit(case.case_id)]
    assert events[0] == "case_created" and "policy_decision" in events and "simulated_action" in events


def test_benign_high_value_is_monitor(services):
    case = service.investigate(service.create_case(BENIGN_TXN).case_id, use_ai=False)
    assert case.decision.tier == 1


def test_tool_failure_becomes_unavailable_evidence(services):
    txn = services.repo.public_transaction(HERO_TXN)
    with InvestigationContext("CASE-TFAIL", txn) as ctx:
        r = ctx.run_tool("t", "get_device_history", device_id="DEV-DOES-NOT-EXIST", transaction_id="TXN-NOPE-1")
        assert r["status"] == "unavailable"
        assert ctx.evidence[-1].status == "unavailable"


def test_guard_blocks_action_tools_and_bad_ids(services):
    txn = services.repo.public_transaction(HERO_TXN)
    with InvestigationContext("CASE-GUARD", txn) as ctx:
        assert ctx.run_tool("t", "simulate_restriction", account_id="ACC-HERO01")["status"] == "blocked"
        assert ctx.run_tool("t", "calculate_velocity", transaction_id="DROP TABLE")["status"] == "blocked"
        assert not ctx.evidence


def test_citation_validation_drops_unknown_ids():
    s = InvestigationSummary(headline="h", pattern="account_takeover", findings=[
        Finding(statement="ok", kind="observed_fact", evidence_ids=["EV-A-01"], severity="high"),
        Finding(statement="made up", kind="interpretation", evidence_ids=["EV-ZZ-99"], severity="high"),
    ], conflicting_evidence=[], missing_evidence=[], recommended_tier=3, confidence="high", next_questions=[])
    clean, rate, dropped = validate_citations(s, {"EV-A-01"})
    assert len(clean.findings) == 1 and dropped == 1 and rate == 0.5 and clean.confidence == "low"


def test_evidence_package_is_bounded_and_label_free(services):
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=False)
    pkg = build_evidence_package(case.case_id, services.repo.public_transaction(HERO_TXN), case.ml, case.evidence)
    assert len(pkg) < 26_000 and "is_fraud" not in pkg and "scenario" not in pkg


def test_api_end_to_end(client):
    assert client.get("/healthz").json()["status"] == "ok"
    q = client.get("/api/queue").json()
    assert q["items"][0]["demo"] is True
    r = client.post("/api/demo/hero").json()
    case_id = r["case_id"]
    if r["needs_investigation"]:
        c = client.post(f"/api/cases/{case_id}/investigate", params={"cached": "true"}).json()
    else:
        c = client.get(f"/api/cases/{case_id}").json()
    assert c["decision"]["tier"] == 3 and c["audit"]
    # demo endpoint never triggers new AI work for an already-investigated case (cost control)
    assert client.post("/api/demo/hero").json()["needs_investigation"] is False
    bad = client.post(f"/api/cases/{case_id}/action", json={"action": "modify", "reason": ""})
    assert bad.status_code == 409
    ok = client.post(f"/api/cases/{case_id}/action", json={"action": "approve", "reason": "confirmed ATO"})
    assert ok.json()["status"] == "approved"
    assert client.get("/api/network/RCP-MULE-07", params={"transaction_id": HERO_TXN}).json()["nodes"]
    assert client.get("/api/metrics").json()["live"]["transactions_screened"] > 100_000


def test_api_validation(client):
    bad = client.post("/api/transactions/score", json={"transaction_id": "nope"})
    assert bad.status_code == 422


def test_score_new_transaction(client):
    body = {"transaction_id": "TXN-API-0001", "customer_id": "CUST-HERO01", "account_id": "ACC-HERO01",
            "timestamp": "2026-09-29T20:00:00", "amount_paise": 650000, "channel": "upi",
            "counterparty_id": "MER-0001", "device_id": "DEV-HERO-01"}
    r1 = client.post("/api/transactions/score", json=body).json()
    r2 = client.post("/api/transactions/score", json=body).json()
    assert r1 == r2 and 0 <= r1["risk_score"] <= 1


def test_analyst_action_requires_investigation():
    import pytest

    case = service.create_case("TXN-HERO-R1")
    with pytest.raises(service.CaseError):
        service.record_analyst_action(case.case_id, AnalystAction(action="approve"))


def test_rate_limit_ignores_spoofed_forwarded_for():
    from starlette.requests import Request

    from app.api.routes import client_ip

    req = Request({"type": "http", "headers": [(b"x-forwarded-for", b"1.2.3.4, 203.0.113.9")], "client": ("10.0.0.1", 1)})
    assert client_ip(req) == "203.0.113.9"
