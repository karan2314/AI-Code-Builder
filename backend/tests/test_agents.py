"""End-to-end agentic path with a scripted LLM (no network): ADK orchestration, AgentTools, callbacks,
evidence capture, guard, synthesis validation, policy and audit."""

import pytest

import app.agents.fraudlens.agent as agent_mod
import app.ai.synthesis as synth_mod
import app.cases.service as svc_mod
from app.cases import service
from app.data.generate import HERO_TXN
from app.schemas import Finding, InvestigationSummary
from tests.fake_llm import ScriptedLlm


@pytest.fixture
def scripted(monkeypatch):
    real = agent_mod.build_root_agent
    monkeypatch.setattr(agent_mod, "build_root_agent", lambda model=None: real(model=ScriptedLlm()))
    ScriptedLlm.calls = []

    def fake_synthesize(package: str, case_id: str):
        import re

        ids = re.findall(r'"id": "(EV-[A-Z0-9]+-\d+)"', package)
        summary = InvestigationSummary(
            headline="Likely account takeover via new device and mule network",
            pattern="account_takeover",
            findings=[Finding(statement="Amount far above baseline", kind="observed_fact", evidence_ids=[ids[0]], severity="high"),
                      Finding(statement="Invented claim", kind="interpretation", evidence_ids=["EV-FAKE-99"], severity="high")],
            conflicting_evidence=[], missing_evidence=[], recommended_tier=3, confidence="high", next_questions=["Call customer"])
        return summary, {"step": "synthesis", "input_tokens": 500, "output_tokens": 120}

    monkeypatch.setattr(synth_mod, "synthesize", fake_synthesize)
    return ScriptedLlm


def test_agentic_hero_investigation(services, scripted):
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=True)
    assert case.ai_error is None, case.ai_error
    assert case.investigation_mode == "agentic"
    agents = {t.agent for t in case.trajectory}
    assert {"customer_behavior_agent", "transaction_analysis_agent", "fraud_network_agent"} <= agents
    # the action tool requested by the scripted agent was blocked and produced no evidence
    blocked = [t for t in case.trajectory if t.tool == "simulate_restriction"]
    assert blocked and blocked[0].status == "blocked" and not blocked[0].evidence_ids
    kinds = {e.kind for e in case.evidence}
    assert {"amount_deviation", "velocity", "device_novelty", "network_metrics", "known_fraud_link"} <= kinds
    assert len({e.id for e in case.evidence}) == len(case.evidence)
    # citation validator dropped the invented finding
    assert case.dropped_findings == 1 and case.evidence_validity_rate == 0.5
    assert case.decision.tier == 3 and case.decision.llm_recommended_tier == 3
    assert case.usage["agents"]["llm_calls"] > 0


def test_agent_failure_falls_back(services, monkeypatch):
    def boom(model=None):
        raise RuntimeError("model unavailable")

    monkeypatch.setattr(agent_mod, "build_root_agent", boom)
    monkeypatch.setattr(synth_mod, "synthesize", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("gemini down")))
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=True)
    assert case.investigation_mode == "deterministic_fallback"
    assert "model unavailable" in case.ai_error and "gemini down" in case.ai_error
    assert case.status == "manual_review" and case.decision.tier == 3 and case.summary is None


def test_agent_timeout_falls_back(services, monkeypatch):
    import asyncio

    async def slow(*a, **k):
        await asyncio.sleep(5)

    monkeypatch.setattr(svc_mod, "_agentic_investigation", slow)
    monkeypatch.setattr(svc_mod.settings, "investigation_timeout_s", 0.2)
    monkeypatch.setattr(synth_mod, "synthesize", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("skip")))
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=True)
    assert "TimeoutError" in case.ai_error and case.investigation_mode == "deterministic_fallback"


def test_demo_cache_restores_last_good_result(services, scripted, monkeypatch):
    case_id = service.create_case(HERO_TXN).case_id
    good = service.investigate_with_cache(case_id, use_ai=True)
    assert good.investigation_mode == "agentic" and good.summary is not None
    # now the live AI breaks: the last good result is restored and labelled
    monkeypatch.setattr(agent_mod, "build_root_agent", lambda model=None: (_ for _ in ()).throw(RuntimeError("quota")))
    monkeypatch.setattr(synth_mod, "synthesize", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("quota")))
    restored = service.investigate_with_cache(case_id, use_ai=True)
    assert restored.summary is not None and "last good AI result" in restored.ai_error
    assert any(a.event_type == "restored_last_good_result" for a in services.cases.audit(case_id))


def test_daily_ai_budget_caps_gemini_usage(services, scripted, monkeypatch):
    monkeypatch.setattr(svc_mod.settings, "max_ai_investigations_per_day", 0)
    case = service.investigate(service.create_case(HERO_TXN).case_id, use_ai=True)
    assert case.investigation_mode == "deterministic_fallback"
    assert "budget" in case.ai_error and case.decision.tier == 3


def test_security_headers(client):
    h = client.get("/healthz").headers
    assert h["x-frame-options"] == "DENY" and "frame-ancestors 'none'" in h["content-security-policy"]
    assert client.get("/api/queue").headers["cache-control"] == "no-store"


def test_citation_repair_retries_once(services, monkeypatch):
    from app.schemas import Finding, InvestigationSummary

    calls = []

    def fake(package, case_id):
        calls.append(package)
        ids = ["EV-BAD-01"] if len(calls) == 1 else ["EV-OK-01"]
        return InvestigationSummary(headline="h", pattern="account_takeover", findings=[
            Finding(statement="s", kind="observed_fact", evidence_ids=ids, severity="high")],
            conflicting_evidence=[], missing_evidence=[], recommended_tier=3, confidence="high",
            next_questions=[]), {"input_tokens": 10, "output_tokens": 5, "latency_ms": 1}

    monkeypatch.setattr(synth_mod, "synthesize", fake)
    summary, usage = synth_mod.synthesize_grounded("pkg", "CASE-X", {"EV-OK-01"})
    assert len(calls) == 2 and "EV-BAD-01" in calls[1] and summary.findings[0].evidence_ids == ["EV-OK-01"]
    assert usage["repaired"] and usage["input_tokens"] == 20
