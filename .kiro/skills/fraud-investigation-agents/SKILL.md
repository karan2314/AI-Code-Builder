---
name: fraud-investigation-agents
description: Implement the FraudLens agentic investigation - ADK Orchestrator with Customer Behavior, Transaction Analysis and Fraud Network specialist agents, deterministic tools that emit evidence IDs, tool guard callbacks, trajectory capture, bounded evidence package, Gemini InvestigationSummary synthesis with citation validation, timeout and deterministic fallback. Use when building or debugging agents, tools, prompts, or the investigate endpoint.
---

# Fraud Investigation Agents

Read `fraud-domain.md`, `genai-standards.md`, and the spec design (`.kiro/specs/fraudlens-mvp/design.md`) first.

## Build order

1. **Tools first** (`app/tools/*.py`): pure functions over `DataRepository` and the graph, with typed args and
   docstrings that explain when to use them. Each returns a Pydantic result. Unit-test them against the hero fixture.
2. **Evidence capture**: `InvestigationContext` (case_id, evidence list, trajectory, call counter),
   stored in ADK session state or a contextvar keyed by case_id.
3. **Deterministic fallback** `deterministic_investigation(case)`: calls behavior + network (+ transaction)
   tools in a fixed order. This is the safety net and the test double.
4. **Specialist agents** (`behavior.py`, `network.py`, `transaction.py`): `LlmAgent` with only their own tools,
   an instruction that says to "call tools, then return a JSON list of key observations citing the tool results", and `output_key`.
5. **Orchestrator** (`agent.py`, `root_agent`): wraps the specialists as `AgentTool`s. Its instruction covers: always run
   behavior + network; run transaction analysis when velocity/device signals are present or the ML top features
   mention them; ask for one more round only if critical evidence is `unavailable`; then stop.
6. **Callbacks**:
   ```python
   def guard_tool_call(tool, args, tool_context):
       ctx = get_ctx(tool_context)
       if tool.name in {"simulate_restriction", "record_action", "create_case"}:
           return {"error": "action tools are not available to agents"}
       if ctx.calls >= settings.max_tool_calls:
           return {"error": "tool budget exhausted; summarize with current evidence"}
       validate_ids(args)  # TXN-/CUST-/ACC-/DEV- patterns, window bounds
       ctx.calls += 1
       return None  # proceed

   def capture_evidence(tool, args, tool_context, tool_response):
       ctx = get_ctx(tool_context)
       ctx.evidence.extend(to_evidence(ctx.case_id, tool.name, tool_response))
       ctx.trajectory.append(step(tool_context.agent_name, tool.name, args, tool_response))
       return None
   ```
   Wrap each tool body in try/except + a timeout so failures produce `unavailable` evidence.
7. **Runner**: `Runner(agent=root_agent, app_name="fraudlens", session_service=InMemorySessionService())`;
   run under `asyncio.wait_for(..., timeout=25)`.
8. **Synthesis**: build `<evidence_package>` JSON (IDs, kinds, summaries, observed vs baseline, status;
   no raw rows) → `InvestigationSummary` → `validate()` → validity rate.
9. **Policy** → **case + audit** persistence → status `awaiting_review`.

## Progress for the UI

Update `case.progress` at each step: `screening_context`, `agent:<name>:start/done`, `tool:<name>`,
`synthesis`, `policy`, `persisted`. The UI polls every 1 s.

## Verify

- `uv run adk web app/agents` on the hero case: ≥ 2 specialists invoked; evidence includes amount_deviation,
  device_novelty, velocity, known_fraud_link.
- API test with mocked Gemini → the fallback path gives Tier 3 for the hero case and Tier ≤ 1 for `CUST-BENIGN01`.
- Real-Gemini eval: 0 invalid citations on the hero case; latency < 25 s.
- Cloud Logging shows `llm_call` and `tool_call` events with the case_id.
