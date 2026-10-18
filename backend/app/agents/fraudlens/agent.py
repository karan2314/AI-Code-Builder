"""ADK multi-agent investigation: Orchestrator + Customer Behavior / Transaction Analysis / Fraud Network.

Specialists are wrapped as AgentTools so the orchestrator plans, calls and receives their results.
Callbacks enforce the tool guard (no action tools, budget, ID validation), convert every tool result into
evidence with IDs and record the trajectory shown in the UI.

Dev UI:  uv run adk web app/agents
"""

from __future__ import annotations

from typing import Any

from google.adk.agents import LlmAgent
from google.adk.models.google_llm import Gemini
from google.adk.tools.agent_tool import AgentTool
from google.genai import types

from app.agents.context import InvestigationContext
from app.agents.fraudlens import prompts
from app.config import settings
from app.tools import BEHAVIOR_TOOLS, NETWORK_TOOLS, transaction_tools


def _ctx(tool_context) -> InvestigationContext | None:
    case_id = None
    try:
        case_id = tool_context.state.get("case_id")
    except Exception:  # state may be unavailable in some contexts
        pass
    return InvestigationContext.lookup(case_id)


def _key(tool_context, tool) -> str:
    return f"{getattr(tool_context, 'function_call_id', None) or id(tool_context)}-{tool.name}"


def guard_tool_call(tool, args: dict[str, Any], tool_context) -> dict | None:
    ctx = _ctx(tool_context)
    if ctx is None or isinstance(tool, AgentTool):
        if ctx is not None:
            ctx.progress(f"agent:{tool.name}:start")
        return None
    blocked = ctx.guard(tool.name, args)
    if blocked:
        return ctx.fail(tool_context.agent_name, tool.name, args, blocked, _key(tool_context, tool), blocked=True)
    ctx.start(_key(tool_context, tool))
    return None


def capture_evidence(tool, args: dict[str, Any], tool_context, tool_response: Any) -> dict | None:
    ctx = _ctx(tool_context)
    if ctx is None:
        return None
    if isinstance(tool, AgentTool):
        ctx.progress(f"agent:{tool.name}:done")
        return None
    if isinstance(tool_response, dict) and tool_response.get("status") == "ok" and "result" in tool_response:
        return ctx.capture(tool_context.agent_name, tool.name, args, tool_response, _key(tool_context, tool))
    return None


def tool_error(tool, args: dict[str, Any], tool_context, error: Exception) -> dict | None:
    ctx = _ctx(tool_context)
    if ctx is None or isinstance(tool, AgentTool):
        return None
    return ctx.fail(tool_context.agent_name, tool.name, args, f"{type(error).__name__}: {error}", _key(tool_context, tool))


def record_usage(callback_context, llm_response):
    """Accumulate token usage from EVERY agent (sub-agents run inside AgentTools and don't surface
    their events to the parent runner), so cost metrics are complete."""
    case_id = None
    try:
        case_id = callback_context.state.get("case_id")
    except Exception:
        pass
    ctx = InvestigationContext.lookup(case_id)
    um = getattr(llm_response, "usage_metadata", None)
    if ctx is not None and um is not None:
        u = ctx.usage
        u["llm_calls"] = u.get("llm_calls", 0) + 1
        u["input_tokens"] = u.get("input_tokens", 0) + (um.prompt_token_count or 0)
        u["output_tokens"] = u.get("output_tokens", 0) + (um.candidates_token_count or 0)
        u["thinking_tokens"] = u.get("thinking_tokens", 0) + (getattr(um, "thoughts_token_count", 0) or 0)
    return None


_CFG = types.GenerateContentConfig(
    temperature=0.1, max_output_tokens=2048,
    thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel(settings.agent_thinking_level)),
)
_callbacks = {"before_tool_callback": guard_tool_call, "after_tool_callback": capture_evidence,
              "on_tool_error_callback": tool_error, "after_model_callback": record_usage}


def _gemini(model_id: str) -> Gemini:
    # Exponential backoff on 429/5xx (shared Vertex quota can briefly throttle bursts of agent calls).
    return Gemini(model=model_id, retry_options=types.HttpRetryOptions(attempts=5, initial_delay=1.5, max_delay=20))


def build_root_agent(model: Any = None) -> LlmAgent:
    """`model` is a Gemini model ID (default from settings) or a BaseLlm instance (used by tests)."""
    model = model or settings.gemini_model
    if isinstance(model, str):
        model = _gemini(model)
    behavior = LlmAgent(name="customer_behavior_agent", model=model, instruction=prompts.BEHAVIOR_PROMPT,
                        description="Compares the transaction with the customer's own baseline, history and limits.",
                        tools=list(BEHAVIOR_TOOLS), generate_content_config=_CFG, **_callbacks)
    transaction = LlmAgent(name="transaction_analysis_agent", model=model, instruction=prompts.TRANSACTION_PROMPT,
                           description="Analyses velocity, device novelty/sharing, counterparty familiarity and ML score.",
                           tools=transaction_tools(), generate_content_config=_CFG, **_callbacks)
    network = LlmAgent(name="fraud_network_agent", model=model, instruction=prompts.NETWORK_PROMPT,
                       description="Investigates links between counterparty, device, related accounts and known fraud.",
                       tools=list(NETWORK_TOOLS), generate_content_config=_CFG, **_callbacks)
    return LlmAgent(
        name="fraudlens_orchestrator", model=model, instruction=prompts.ORCHESTRATOR_PROMPT,
        description="Plans the investigation and delegates to specialist agents.",
        tools=[AgentTool(behavior), AgentTool(transaction), AgentTool(network)],
        generate_content_config=_CFG, **_callbacks,
    )


root_agent = build_root_agent()
