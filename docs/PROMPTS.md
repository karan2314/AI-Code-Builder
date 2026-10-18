# Prompt Design (PROMPT_VERSION 2026.10.1)

Source: `backend/app/agents/fraudlens/prompts.py`.

## Principles
1. **Tools compute, Gemini reasons.** Every agent instruction forbids calculating or inventing values; numbers
   come from deterministic tools.
2. **Evidence IDs everywhere.** Tool responses are rewritten by `after_tool_callback` into evidence items with IDs
   (`EV-<case>-<n>`). Agents and the synthesis step must cite them.
3. **Data is not instructions.** Tool output and the evidence package are wrapped and declared as data
   (prompt-injection defence for attacker-controlled fields such as merchant names).
4. **Narrow roles.** Each specialist sees only its own tools; the orchestrator sees only the specialists
   (as AgentTools) and cannot call action tools. The guard callback enforces this as well.
5. **Advisory, not authoritative.** The synthesis prompt states that a deterministic policy engine decides the tier.

## Agents
| Agent | Tools | Output |
|---|---|---|
| `fraudlens_orchestrator` | customer_behavior_agent, transaction_analysis_agent, fraud_network_agent | which specialists were used and why |
| `customer_behavior_agent` | profile, history summary, limits, customer deviation | observations + evidence IDs |
| `transaction_analysis_agent` | velocity, device history, counterparty familiarity, ML score | observations + evidence IDs |
| `fraud_network_agent` | network analysis, known-fraud search, related accounts | observations + evidence IDs |

## Synthesis
A single `generate_content` call with `response_schema=InvestigationSummary`, `temperature=0.1`. Output: headline,
pattern, 3–7 findings (observed_fact vs interpretation, severity, evidence_ids), conflicting and missing evidence,
advisory tier, confidence and next questions. Post-validation drops findings citing unknown IDs and lowers
confidence if more than 20% of claims were invalid.
