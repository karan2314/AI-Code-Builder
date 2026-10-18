---
name: risk-policy-engine
description: Implement and test the FraudLens deterministic, versioned risk policy engine that maps evidence to Tier 1 Monitor, Tier 2 Verify/Investigate, or Tier 3 Contain, with allowed simulated actions, rule hits, conflict and stale-link handling, and LLM-disagreement flags. Use when changing tiers, thresholds, actions, or policy tests.
---

# Risk Policy Engine

## Contract

```python
POLICY_VERSION = "2026.10.1"

def decide(evidence: list[Evidence], summary: InvestigationSummary | None, ml: ScoreResult,
           cfg: PolicyConfig) -> PolicyDecision: ...
```

A pure function: no I/O, no randomness, no LLM. `PolicyConfig` is loaded from `app/policy/config.yaml`
(thresholds: amount ratio, velocity counts, ML score, fraud-link recency days).

## Steps

1. `critical_families = {e.indicator_family for e in evidence if e.status == "ok" and is_critical(e, cfg)}`
2. `has_confirmed_link` = any `known_fraud_link` with `status=ok`, case confirmed, and recency ≤ `cfg.link_recency_days`.
3. Apply rules R1–R8 from the design (in order; record every hit in `rule_hits`).
4. `requires_review` if there is conflicting evidence on a critical family, or `limited_history`, or no summary.
5. `allowed_actions` from the tier map; all action names end with `_simulated` or are alerts/escalations.
6. `disagreement = summary is not None and summary.recommended_tier != tier`.

## Tests (`tests/policy/test_engine.py`, table-driven)

One case per rule plus: hero → Tier 3 via R1; benign high-value → Tier 1; stale link only → not R1;
conflict → capped at 2 + review; no evidence → Tier 1 + manual_review; determinism (same input twice gives an equal output).

Changing a threshold means bumping `POLICY_VERSION` and adding a DECISIONS.md entry.
