# Fraud Domain Rules (FraudLens AI)

These rules apply to every agent, tool, prompt, API, and UI change.

## Separation of responsibilities (BRD Appendix B)

| Concern | Who does it | Never done by |
|---|---|---|
| Arithmetic, statistics, velocity, percentiles | Deterministic Python tools | Gemini |
| Screening thousands of transactions | Rules + ML (LightGBM/XGBoost, Isolation Forest) | Gemini |
| Choosing which evidence to gather | Orchestrator Agent (Gemini via ADK) | Hard-coded only |
| Explaining, reconciling conflicts, flagging missing evidence | Gemini synthesis | Templates only |
| Mapping evidence to a tier and allowed action | Deterministic Policy Engine | Gemini |
| Executing an action | `simulate_restriction` / `record_action` after analyst or policy gate | Any LLM directly |

## Evidence model

- Every tool result becomes one or more **Evidence** items with a stable ID:
  `EV-<case_id>-<seq>` with `{id, source_tool, kind, observed_value, baseline_value?, unit,
  window?, status: ok|unavailable|stale|conflicting, model_version?, created_at}`.
- If a tool fails, create the evidence item with `status="unavailable"`. Never let the model fill the gap.
- Gemini gets a **bounded evidence package** (only the case's evidence items + minimal pseudonymous
  context, capped at ~8k tokens). No raw transaction dumps, no PII.
- Gemini output must validate against `InvestigationSummary` (see `genai-standards.md`). Every
  `finding` has `evidence_ids: [..]` (at least 1). Post-validate: every cited ID exists in the package.
  If not, drop the claim and log `evidence_validity_violation`.
- Track **evidence validity rate** = valid cited claims / total claims (a BRD metric).

## Risk tiers (prototype policy, thresholds calibrated on validation data)

| Tier | Name | Typical trigger | Simulated action |
|---|---|---|---|
| 1 | Monitor | Single anomaly; low/medium ML score | Monitoring alert |
| 2 | Verify / Investigate | ≥ 2 independent indicator families (behavior, device, velocity, network) | Customer verification simulation + analyst escalation |
| 3 | Contain | Known-compromise/fraud link + suspicious activity, or ≥ 3 critical indicators | Simulated restriction + immediate escalation |

Policy rules:
- Implemented in `backend/app/policy/engine.py` as pure functions. Versioned (`POLICY_VERSION`).
  Returns `{tier, allowed_actions, rule_hits[], policy_version}`.
- **Conflicting evidence → require review** (never auto-escalate to Tier 3 on conflict alone).
- **Limited history** (< N prior txns) → use cohort baselines and add the flag `limited_history`.
- **Stale/unverified fraud link** → treat as a signal that needs validation, not as proof.
- Gemini's `recommended_tier` is advisory and recorded next to the policy tier. Show any disagreement in the UI.

## Audit trail

Append-only `cases/{case_id}/audit/{event_id}` in Firestore: `{event_type, actor (system|agent:<name>|analyst:<id>),
timestamp, inputs_ref, outputs_ref, model (id + version), prompt_version, policy_version, evidence_ids}`.
Never update or delete audit events.

## Data & privacy

- Synthetic data only. IDs are pseudonymous (`CUST-000123`, `ACC-…`, `DEV-…`, `MER-…`).
- Currency is INR (₹). Store amounts as integer paise or Decimal, never float, in the policy/audit path.
- Don't log full transaction records or prompts. Log IDs, scores, latencies, and token counts.

## UI language

Use "suspicious", "indicators", and "recommended", never "fraudster" or "guilty". Every action
button and result reads **"SIMULATED"**. Show uncertainty and missing evidence explicitly.
