# Requirements Document: FraudLens AI MVP

## Introduction

FraudLens AI is an agentic fraud detection, investigation, and response platform for bank fraud
analysts. A high-throughput rules + ML layer screens large synthetic transaction volumes. Only
suspicious candidates go to a Gemini-powered multi-agent investigation (ADK on Google Cloud) that
gathers tool-verified evidence on customer behavior, transactions, and fraud networks. Gemini then
produces an evidence-linked case summary, and a deterministic policy engine maps the case to a risk tier
(Monitor / Verify / Contain) with a **simulated** response, a persisted case, and an audit trail.

- **Theme / category:** Intelligent Risk, Fraud & Financial Experiences (BFSI). Confirm in Hack2skill;
  fallback category: Social Good.
- **Primary persona:** Fraud Analyst. Secondary: Risk/Banking Ops, Customer Protection, ML team, Judge.
- **Deadline:** 18 October 2026. Deployed on Cloud Run.
- **Success metrics (measured on held-out synthetic data):** precision, recall, PR-AUC, false
  positives per 10k, candidate rate, fraud value captured, P50/P95 latency, Gemini escalation rate,
  cost per 1,000 transactions, evidence validity rate.
- Source: `docs/BRD.md`.

## Glossary

- **Candidate**: a transaction whose first-stage risk score is ≥ the calibrated threshold.
- **Evidence item**: an immutable, ID'd (`EV-…`) result of a deterministic tool call.
- **Evidence package**: the bounded set of evidence items for one case, sent to Gemini.
- **Policy Engine**: deterministic, versioned code that maps evidence to a tier and allowed actions.
- **Simulated action**: an action recorded and displayed but never executed against any real system.

## Requirements

### Requirement 1: Synthetic data foundation `[Tech40] [Impact25] BRD§12`

**User Story:** As the ML team, I want a reproducible synthetic banking dataset with labeled fraud
scenarios, so that we can build and benchmark detection without real PII.

#### Acceptance Criteria

1. WHEN the generator runs with a seed THE SYSTEM SHALL produce identical customers, accounts, devices, merchants, recipients, transactions, and fraud labels for that seed.
2. THE SYSTEM SHALL generate at least 2,000 customers and at least 100,000 transactions over at least 90 days, with per-customer spending variation.
3. THE SYSTEM SHALL inject labeled scenarios: account takeover (new device + velocity + unusual amount), mule network (shared recipients/devices), card testing (many small txns), benign high-value purchases, and limited-history customers.
4. THE SYSTEM SHALL include the hero demo customer: 2–4 txns/day, median ≈ ₹6,000, then a ₹185,000 transfer from an unseen device after rapid transactions, to a recipient linked to confirmed-fraud accounts.
5. THE SYSTEM SHALL use only pseudonymous IDs (`CUST-`, `ACC-`, `DEV-`, `MER-`, `TXN-`) and contain no real PII.

### Requirement 2: Ingestion and validation `[Tech40] BRD§7,§17`

**User Story:** As banking operations, I want transactions to be validated on ingestion, so that malformed data never reaches scoring.

#### Acceptance Criteria

1. WHEN a transaction is submitted THE SYSTEM SHALL validate transaction_id, customer_id, account_id, timestamp, amount (> 0), and currency.
2. IF validation fails THEN THE SYSTEM SHALL return HTTP 422 with field-level errors and not score the transaction.
3. WHEN the same transaction_id is submitted twice THE SYSTEM SHALL return the original result (idempotency).

### Requirement 3: First-stage screening (rules + ML) `[Tech40] [Innov25] BRD§13`

**User Story:** As a fraud analyst, I want thousands of transactions screened automatically with reason codes, so that I only review meaningful candidates.

#### Acceptance Criteria

1. THE SYSTEM SHALL compute point-in-time features using only data earlier than each transaction: customer baseline deviation, velocity windows, limit utilization, device novelty, merchant familiarity, and network proximity to known fraud.
2. THE SYSTEM SHALL provide a rules-only baseline with human-readable reason codes.
3. THE SYSTEM SHALL train a supervised model (LightGBM) and an anomaly model (Isolation Forest) on a time-based train split.
4. WHEN a transaction is scored THE SYSTEM SHALL return risk_score, is_candidate, reason_codes, top_features, and model_version.
5. THE SYSTEM SHALL calibrate the candidate threshold on the validation split, targeting a candidate rate of 1–5%.
6. WHEN a batch is scored THE SYSTEM SHALL return summary metrics (count, candidate count, candidate rate, latency) and candidate IDs.
7. WHILE scoring THE SYSTEM SHALL NOT call Gemini.
8. THE SYSTEM SHALL score a single transaction in under 100 ms P95 server-side, excluding cold start.

### Requirement 4: Investigation tools `[Tech40] BRD§9`

**User Story:** As the orchestrator agent, I want deterministic tools that return verified evidence, so that every fact in a case is traceable.

#### Acceptance Criteria

1. THE SYSTEM SHALL implement these tools: get_customer_profile, get_transaction_history, get_account_limits, calculate_customer_deviation, calculate_velocity, get_device_history, get_merchant_history, get_related_accounts, search_known_fraud_cases, analyze_fraud_network, get_ml_risk_score, create_case, record_action, and simulate_restriction.
2. WHEN a tool returns THE SYSTEM SHALL convert the result into one or more evidence items with unique IDs, source tool, observed values, and status.
3. IF a tool fails or times out THEN THE SYSTEM SHALL record an evidence item with status "unavailable" and continue the investigation.
4. WHEN a customer has fewer than the minimum number of prior transactions THE SYSTEM SHALL use cohort baselines and flag `limited_history`.
5. THE SYSTEM SHALL perform all numeric calculations in tools, never in the LLM.

### Requirement 5: Agentic investigation (ADK + Gemini) `[Tech40] [Innov25] BRD§8`

**User Story:** As a fraud analyst, I want an AI orchestrator to investigate a candidate by choosing the right specialist analyses, so that I get a complete evidence picture in seconds.

#### Acceptance Criteria

1. WHEN an analyst starts an investigation on a candidate THE SYSTEM SHALL run the FraudLens Orchestrator Agent, which plans and invokes specialist agents.
2. THE SYSTEM SHALL provide a Customer Behavior Agent, a Fraud Network Agent, and a Transaction Analysis Agent (stretch), each restricted to its own tools.
3. THE SYSTEM SHALL invoke at least two specialist capabilities per investigation.
4. WHILE investigating THE SYSTEM SHALL cap tool calls per case (default 12) and additional evidence rounds (default 2).
5. THE SYSTEM SHALL record the agent trajectory (agent, tool, arguments, latency, status) for display.
6. THE SYSTEM SHALL prevent agents from calling action tools (simulate_restriction, record_action).
7. IF Gemini or the agent runtime fails or exceeds 25 s THEN THE SYSTEM SHALL keep the ML/rules score, set the case status to `manual_review`, and inform the analyst.

### Requirement 6: Evidence-grounded Gemini synthesis `[Tech40] [Innov25] BRD§10`

**User Story:** As a fraud analyst, I want an analyst-readable summary in which every claim links to evidence, so that I can trust and verify the AI's reasoning.

#### Acceptance Criteria

1. WHEN agents complete THE SYSTEM SHALL send only the bounded evidence package (no raw history dumps, no PII) to Gemini.
2. THE SYSTEM SHALL require Gemini to return JSON that matches the InvestigationSummary schema (headline, pattern, findings with evidence_ids, conflicting_evidence, missing_evidence, recommended_tier, confidence, next_questions).
3. WHEN the response is received THE SYSTEM SHALL validate that every cited evidence ID exists in the package and drop findings that cite unknown IDs.
4. THE SYSTEM SHALL compute and store the evidence validity rate for each case.
5. THE SYSTEM SHALL label each finding as observed_fact or interpretation.
6. IF evidence is insufficient or conflicting THEN THE SYSTEM SHALL surface it in missing_evidence or conflicting_evidence and lower confidence.

### Requirement 7: Deterministic policy engine `[Tech40] [Impact25] BRD§11`

**User Story:** As risk operations, I want a versioned, deterministic policy to decide risk tiers and allowed actions, so that decisions are consistent, auditable, and never LLM-only.

#### Acceptance Criteria

1. WHEN the evidence package and synthesis are ready THE SYSTEM SHALL compute tier (1 Monitor, 2 Verify/Investigate, 3 Contain), allowed_actions, rule_hits, and policy_version deterministically.
2. THE SYSTEM SHALL assign Tier 3 only when a known-compromise/fraud link combines with suspicious activity, or when ≥ 3 critical indicator families are present.
3. IF evidence conflicts THEN THE SYSTEM SHALL require analyst review and not auto-assign Tier 3 on that basis.
4. IF a known-fraud link is stale or unverified THEN THE SYSTEM SHALL treat it as a signal needing validation.
5. THE SYSTEM SHALL record Gemini's recommended_tier alongside the policy tier and flag disagreement.
6. WHEN a tier is assigned THE SYSTEM SHALL execute only the corresponding simulated action, labeled "SIMULATED".

### Requirement 8: Case management and audit `[Tech40] [Impact25] BRD§19,§21`

**User Story:** As a fraud analyst, I want every case, decision, and action stored with full provenance, so that investigations are reviewable and auditable.

#### Acceptance Criteria

1. WHEN an investigation completes THE SYSTEM SHALL persist the case with evidence, summary, policy decision, model versions, prompt version, policy version, and trajectory in Firestore.
2. WHEN any system, agent, or analyst event occurs THE SYSTEM SHALL append an immutable audit event with actor, timestamp, and references.
3. WHEN an analyst approves, modifies the tier with a reason, or closes a case THE SYSTEM SHALL record the action and update the case status.
4. THE SYSTEM SHALL allow exporting a case as JSON (stretch: PDF).
5. IF Firestore is unavailable THEN THE SYSTEM SHALL fall back to in-memory storage and show a degraded-mode banner.

### Requirement 9: Analyst web application `[UX10] [Impact25] BRD§18`

**User Story:** As a fraud analyst, I want a clear dashboard and case workspace, so that I can go from alert to decision quickly.

#### Acceptance Criteria

1. THE SYSTEM SHALL show an operations dashboard with transactions screened, candidate rate, open cases, tier distribution, and Gemini escalation rate.
2. THE SYSTEM SHALL show a suspicious transaction queue with risk score, reason codes, and status, sortable and keyboard-navigable.
3. WHEN a case is opened THE SYSTEM SHALL show the AI summary with clickable evidence references, the evidence list, the investigation timeline, the network graph, the tier and action panel, and the audit trail.
4. THE SYSTEM SHALL show a Customer 360 view with profile, limits, baseline, and recent history.
5. WHILE an investigation runs THE SYSTEM SHALL display step-by-step progress.
6. THE SYSTEM SHALL provide a demo mode with a one-click hero scenario and a persistent "synthetic data / simulated actions" banner.
7. THE SYSTEM SHALL support keyboard operation of the core workflow, visible focus, text labels for tiers (not color alone), and a list alternative to the graph.

### Requirement 10: Fraud network intelligence `[Innov25] [Tech40] BRD§8.4`

**User Story:** As a fraud analyst, I want to see how accounts, devices, merchants, and recipients connect to known fraud, so that I can detect mule networks and compromise.

#### Acceptance Criteria

1. THE SYSTEM SHALL build an entity graph of customers, accounts, devices, merchants, and recipients.
2. WHEN queried for an entity THE SYSTEM SHALL return a ≤ 2-hop ego graph (≤ 150 nodes), with known-fraud flags, shared-device clusters, and path to the nearest known fraud.
3. THE SYSTEM SHALL present relationships as evidence with strength, not as proof of fraud.

### Requirement 11: Evaluation and benchmarking `[Tech40] [Impact25] BRD§14,§15`

**User Story:** As a judge or ML lead, I want measured comparisons of rules, ML, and agentic investigation, so that the claims are credible.

#### Acceptance Criteria

1. THE SYSTEM SHALL use a time-based train/validation/test split and include a leakage test.
2. THE SYSTEM SHALL compute precision, recall, PR-AUC, FP/10k, candidate rate, fraud value captured, and P50/P95 latency for Baseline A (rules) and B (ML) on the test split.
3. THE SYSTEM SHALL evaluate Variant D (screen + agentic) on golden scenarios and a sample of test candidates: tier accuracy, evidence validity rate, Gemini escalation rate, average latency, and cost per 1,000 transactions.
4. THE SYSTEM SHALL write all results to `docs/metrics/*.json` with seed, versions, and timestamp, and serve them via `GET /api/metrics`.
5. THE SYSTEM SHALL NOT display any metric that is not read from those files or computed live.
6. WHERE Jev is enabled (stretch) THE SYSTEM SHALL benchmark Variant C on the same test data and keep it off the critical path.

### Requirement 12: Deployment, observability, security `[Tech40] BRD§16,§19,§21`

**User Story:** As a judge, I want the prototype live on Google Cloud and reliable during evaluation, so that I can try it myself.

#### Acceptance Criteria

1. THE SYSTEM SHALL run as a Cloud Run service with a dedicated least-privilege service account and no embedded credentials.
2. THE SYSTEM SHALL expose `GET /healthz` and emit structured JSON logs for requests, tool calls, and LLM calls (model, latency, tokens).
3. THE SYSTEM SHALL rate-limit mutating endpoints and cap request sizes.
4. WHILE in evaluation THE SYSTEM SHALL keep at least one warm instance.
5. THE SYSTEM SHALL contain no secrets in source control.

## Non-Functional Requirements

| Area | Target |
|---|---|
| Performance | Single score < 100 ms P95; batch of 100k < 60 s; investigation P95 < 25 s |
| Availability | Reachable throughout judging (min instances 1, pre-seeded cases) |
| Explainability | 100% of displayed AI findings cite valid evidence IDs |
| Privacy | Synthetic, pseudonymous data; minimal data to the LLM |
| Accessibility | Keyboard-operable core flow, WCAG 2.2 AA contrast, aria-live progress |
| Cost | Gemini only on candidates; report cost per 1,000 transactions |
