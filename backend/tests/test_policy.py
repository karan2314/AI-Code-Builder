from datetime import UTC, datetime

import pytest

from app.policy.engine import POLICY_VERSION, decide
from app.schemas import Evidence, Finding, InvestigationSummary, ScoreResult


def ev(kind, family, observed, status="ok", i=[0]):  # noqa: B006 - simple counter
    i[0] += 1
    return Evidence(id=f"EV-T-{i[0]:02d}", case_id="CASE-T", source_tool="t", kind=kind, indicator_family=family,
                    summary=kind, observed=observed, status=status, created_at=datetime.now(UTC))


def ml(score=0.9):
    return ScoreResult(transaction_id="TXN-T01", risk_score=score, rules_score=0.5, ml_score=score, anomaly_score=0.5,
                       is_candidate=score > 0.69, reason_codes=[], top_features=[], model_version="m")


SUMMARY = InvestigationSummary(headline="h", pattern="account_takeover",
                               findings=[Finding(statement="s", kind="observed_fact", evidence_ids=["EV-T-01"], severity="high")],
                               conflicting_evidence=[], missing_evidence=[], recommended_tier=3, confidence="high",
                               next_questions=[])

BIG_AMOUNT = ("amount_deviation", "behavior", {"ratio_to_median": 30, "ratio_to_p95": 8, "limited_history": False})
SMALL_AMOUNT = ("amount_deviation", "behavior", {"ratio_to_median": 1.1, "ratio_to_p95": 0.5, "limited_history": False})
FAST = ("velocity", "velocity", {"count_10m": 4, "count_1h": 5})
NEW_DEVICE = ("device_novelty", "device", {"is_new_device": True, "other_customers_on_device": 0})
DIRECT_FRAUD = ("known_fraud_link", "network", {"status": "confirmed", "direct": True})
LINKED_NET = ("network_metrics", "network", {"min_hops_to_fraud": 2})


def test_r1_fraud_link_plus_activity_is_contain():
    d = decide([ev(*DIRECT_FRAUD), ev(*BIG_AMOUNT)], SUMMARY, ml())
    assert d.tier == 3 and "R1_fraud_link_plus_suspicious_activity" in d.rule_hits


def test_r1_via_network_hops():
    assert decide([ev(*LINKED_NET), ev(*FAST)], SUMMARY, ml()).tier == 3


def test_r2_three_families_without_fraud_link():
    d = decide([ev(*BIG_AMOUNT), ev(*FAST), ev(*NEW_DEVICE)], SUMMARY, ml())
    assert d.tier == 3 and "R2_three_or_more_critical_families" in d.rule_hits


def test_r3_two_families_is_verify():
    d = decide([ev(*BIG_AMOUNT), ev(*NEW_DEVICE)], SUMMARY, ml(0.5))
    assert d.tier == 2 and d.allowed_actions == ["customer_verification_simulated", "analyst_escalation"]


def test_r4_single_signal_is_monitor():
    assert decide([ev(*BIG_AMOUNT)], SUMMARY, ml(0.3)).tier == 1


def test_fraud_link_alone_is_not_contain():
    assert decide([ev(*DIRECT_FRAUD), ev(*SMALL_AMOUNT)], SUMMARY, ml(0.3)).tier == 1


def test_r5_conflict_caps_tier_and_requires_review():
    d = decide([ev(*BIG_AMOUNT), ev(*FAST), ev(*NEW_DEVICE)], SUMMARY, ml(0.05))
    assert d.tier == 2 and d.requires_review and "R5_conflicting_evidence_capped" in d.rule_hits


def test_r6_stale_link_is_not_r1():
    stale = ev("known_fraud_link", "network", {"status": "stale", "direct": True}, status="stale")
    d = decide([stale, ev(*BIG_AMOUNT)], SUMMARY, ml(0.5))
    assert d.tier == 1 and "stale_fraud_link" in d.flags and d.requires_review


def test_r7_limited_history_flags_review():
    lim = ev("amount_deviation", "behavior", {"ratio_to_median": 3, "limited_history": True})
    d = decide([lim], SUMMARY, ml(0.5))
    assert "limited_history" in d.flags and d.requires_review


def test_r8_no_summary_is_manual_review():
    d = decide([ev(*BIG_AMOUNT)], None, ml())
    assert d.manual_review and "R8_no_ai_summary_manual_review" in d.rule_hits


def test_unavailable_evidence_is_flagged_not_inferred():
    missing = ev("analyze_fraud_network_unavailable", "network", {"error": "x"}, status="unavailable")
    d = decide([missing, ev(*BIG_AMOUNT)], SUMMARY, ml(0.5))
    assert d.tier == 1 and any(f.startswith("evidence_unavailable") for f in d.flags)


def test_llm_disagreement_recorded_but_not_decisive():
    d = decide([ev(*BIG_AMOUNT)], SUMMARY, ml(0.3))
    assert d.tier == 1 and d.llm_recommended_tier == 3 and d.disagreement


@pytest.mark.parametrize("_", range(3))
def test_deterministic(_):
    evidence = [ev(*BIG_AMOUNT), ev(*FAST)]
    assert decide(evidence, SUMMARY, ml()).model_dump() == decide(evidence, SUMMARY, ml()).model_dump()
    assert decide(evidence, SUMMARY, ml()).policy_version == POLICY_VERSION


def test_ml_score_is_not_an_independent_family():
    """A candidate's high ML score + one behaviour signal must not escalate to Tier 2 (regression for 2026.10.2)."""
    ml_ev = ev("ml_score", "ml", {"risk_score": 0.75})
    d = decide([ml_ev, ev(*BIG_AMOUNT)], SUMMARY, ml(0.75))
    assert d.tier == 1 and "ml" not in d.critical_families
