"""Deterministic, versioned risk policy engine (BRD section 11).

Pure function: no I/O, no randomness, no LLM. Gemini's recommended tier is recorded alongside the
policy tier but never decides it. Thresholds are prototype policy values calibrated on synthetic
validation data; they are not banking standards.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas import Evidence, InvestigationSummary, PolicyDecision, ScoreResult

POLICY_VERSION = "2026.10.2"  # .2: ML score no longer counted as an independent indicator family

TIER_NAMES = {1: "Monitor", 2: "Verify / Investigate", 3: "Contain"}
TIER_ACTIONS = {
    1: ["monitoring_alert"],
    2: ["customer_verification_simulated", "analyst_escalation"],
    3: ["restriction_simulated", "immediate_escalation"],
}
# Independent corroborating families. The first-stage ML score is deliberately NOT one of them: every
# candidate has a high ML score by construction (that is why it is investigated), so counting it would
# let a single extra signal escalate legitimate customers. ML still feeds the R5 conflict check.
SCORED_FAMILIES = ("behavior", "velocity", "device", "network")


@dataclass(frozen=True)
class PolicyConfig:
    amount_ratio_median: float = 5.0
    amount_ratio_p95: float = 1.5
    limit_utilisation: float = 0.9
    velocity_10m: int = 3
    velocity_1h: int = 6
    young_counterparty_days: int = 60
    network_hops: int = 2
    ml_risk: float = 0.69
    ml_conflict_low: float = 0.2


def _critical(e: Evidence, cfg: PolicyConfig) -> bool:
    o = e.observed
    match e.kind:
        case "amount_deviation":
            if o.get("limited_history"):
                return o.get("ratio_to_median", 0) >= cfg.amount_ratio_median * 2
            return o.get("ratio_to_median", 0) >= cfg.amount_ratio_median or o.get("ratio_to_p95", 0) >= cfg.amount_ratio_p95
        case "limit_utilization":
            return max(o.get("txn_limit_utilisation", 0), o.get("daily_limit_utilisation", 0)) >= cfg.limit_utilisation
        case "counterparty_familiarity":
            return bool(o.get("is_new_counterparty")) and o.get("counterparty_age_days", 9999) < cfg.young_counterparty_days
        case "velocity":
            return o.get("count_10m", 0) >= cfg.velocity_10m or o.get("count_1h", 0) >= cfg.velocity_1h
        case "device_novelty":
            return bool(o.get("is_new_device")) or o.get("other_customers_on_device", 0) > 0 \
                or o.get("prior_payments_to_confirmed_fraud", 0) > 0
        case "known_fraud_link":
            return o.get("status") == "confirmed" and bool(o.get("direct"))
        case "network_metrics":
            hops = o.get("min_hops_to_fraud")
            return hops is not None and hops <= cfg.network_hops
        case "ml_score":
            return o.get("risk_score", 0) >= cfg.ml_risk
    return False


def _strong_fraud_link(evidence: list[Evidence], cfg: PolicyConfig) -> bool:
    for e in evidence:
        if e.status != "ok":
            continue
        if e.kind == "known_fraud_link" and e.observed.get("status") == "confirmed" and e.observed.get("direct"):
            return True
        if e.kind == "network_metrics":
            hops = e.observed.get("min_hops_to_fraud")
            if hops is not None and hops <= cfg.network_hops:
                return True
    return False


def decide(evidence: list[Evidence], summary: InvestigationSummary | None, ml: ScoreResult,
           cfg: PolicyConfig | None = None) -> PolicyDecision:
    cfg = cfg or PolicyConfig()
    hits: list[str] = []
    flags: list[str] = []

    ok_evidence = [e for e in evidence if e.status == "ok"]
    families = sorted({e.indicator_family for e in ok_evidence
                       if e.indicator_family in SCORED_FAMILIES and _critical(e, cfg)})
    unavailable = sorted({e.source_tool for e in evidence if e.status == "unavailable"})
    stale = [e for e in evidence if e.status == "stale"]
    limited = any(e.observed.get("limited_history") for e in evidence if e.kind in ("amount_deviation", "history_summary"))
    strong_link = _strong_fraud_link(evidence, cfg)
    other_families = [f for f in families if f != "network"]

    # R5 (deterministic conflict): strong indicator families but a very low ML score, or vice versa
    conflict = (len(families) >= 3 and ml.risk_score < cfg.ml_conflict_low) or \
               (ml.risk_score >= 0.95 and not [f for f in families if f != "ml"])

    if strong_link and other_families:
        tier = 3
        hits.append("R1_fraud_link_plus_suspicious_activity")
    elif len(families) >= 3:
        tier = 3
        hits.append("R2_three_or_more_critical_families")
    elif len(families) >= 2:
        tier = 2
        hits.append("R3_two_independent_families")
    else:
        tier = 1
        hits.append("R4_single_signal_or_ml_only")

    requires_review = False
    if conflict:
        hits.append("R5_conflicting_evidence_capped")
        requires_review = True
        if tier == 3 and "R1_fraud_link_plus_suspicious_activity" not in hits:
            tier = 2
    if stale:
        hits.append("R6_stale_fraud_link_needs_validation")
        flags.append("stale_fraud_link")
        requires_review = True
    if limited:
        hits.append("R7_limited_history_cohort_baseline")
        flags.append("limited_history")
        requires_review = True
    manual = summary is None
    if manual:
        hits.append("R8_no_ai_summary_manual_review")
        requires_review = True
    if unavailable:
        flags.append("evidence_unavailable:" + ",".join(unavailable))
        requires_review = True
    if summary is not None and summary.conflicting_evidence:
        flags.append("ai_reported_conflicts")
        requires_review = True

    # Laya (advisory decision model) is recorded and compared, never used to set the tier.
    laya = next((e for e in evidence if e.kind == "laya_decision" and e.status == "ok"), None)
    laya_route = laya.observed.get("route") if laya else None
    laya_disagreement = bool(laya_route) and ((laya_route == "investigate") != (tier >= 2))
    if laya_disagreement:
        flags.append(f"laya_suggests_{laya_route}")

    llm_tier = summary.recommended_tier if summary else None
    return PolicyDecision(
        laya_route=laya_route, laya_disagreement=laya_disagreement,
        tier=tier, tier_name=TIER_NAMES[tier], allowed_actions=TIER_ACTIONS[tier], rule_hits=hits,
        critical_families=families, requires_review=requires_review, manual_review=manual, flags=flags,
        policy_version=POLICY_VERSION, llm_recommended_tier=llm_tier,
        disagreement=llm_tier is not None and llm_tier != tier,
    )
