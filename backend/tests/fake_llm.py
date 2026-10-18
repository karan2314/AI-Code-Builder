"""Scripted stand-in for Gemini so the ADK agent wiring (AgentTools, callbacks, evidence capture,
trajectory) can be tested end to end without network access. It plays each role deterministically."""

from __future__ import annotations

import re
from collections.abc import AsyncGenerator

from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types

ID_RE = {
    "transaction_id": r"TXN-[A-Z0-9-]+", "customer_id": r"CUST-[A-Z0-9-]+", "account_id": r"ACC-[A-Z0-9-]+",
    "device_id": r"DEV-[A-Z0-9-]+", "counterparty_id": r"(?:RCP|MER)-[A-Z0-9-]+",
}


def _ids(text: str) -> dict[str, str]:
    out = {}
    for k, pattern in ID_RE.items():
        m = re.search(pattern, text)
        if m:
            out[k] = m.group(0).rstrip("-")
    return out


def _call(name: str, args: dict) -> types.Part:
    return types.Part(function_call=types.FunctionCall(name=name, args=args))


class ScriptedLlm(BaseLlm):
    model: str = "scripted-fake"
    calls: list[str] = []

    @classmethod
    def supported_models(cls) -> list[str]:
        return ["scripted-fake"]

    async def generate_content_async(self, llm_request: LlmRequest, stream: bool = False) -> AsyncGenerator[LlmResponse, None]:
        system = str(llm_request.config.system_instruction or "")
        texts, responded = [], set()
        for c in llm_request.contents or []:
            for p in c.parts or []:
                if p.text:
                    texts.append(p.text)
                if p.function_response:
                    responded.add(p.function_response.name)
        ids = _ids(" ".join(texts))
        tid = ids.get("transaction_id", "")
        plan: list[tuple[str, dict]]
        if "Role: FraudLens Orchestrator" in system:
            brief = f"Investigate {tid} customer {ids.get('customer_id')} account {ids.get('account_id')} " \
                    f"device {ids.get('device_id')} counterparty {ids.get('counterparty_id')}"
            plan = [(n, {"request": brief}) for n in ("customer_behavior_agent", "transaction_analysis_agent",
                                                       "fraud_network_agent")]
            role = "orchestrator"
        elif "Role: Customer Behavior Agent" in system:
            plan = [("calculate_customer_deviation", {"customer_id": ids["customer_id"], "transaction_id": tid}),
                    ("get_transaction_history", {"customer_id": ids["customer_id"], "transaction_id": tid, "days": 90}),
                    ("get_account_limits", {"account_id": ids["account_id"], "transaction_id": tid})]
            role = "behavior"
        elif "Role: Transaction Analysis Agent" in system:
            plan = [("calculate_velocity", {"transaction_id": tid}),
                    ("get_device_history", {"device_id": ids["device_id"], "transaction_id": tid}),
                    ("simulate_restriction", {"account_id": ids.get("account_id", "ACC-X01")}),  # must be blocked
                    ("get_ml_risk_score", {"transaction_id": tid})]
            role = "transaction"
        else:
            plan = [("analyze_fraud_network", {"transaction_id": tid}),
                    ("search_known_fraud_cases", {"entity_ids": [ids["counterparty_id"], ids["device_id"]],
                                                  "transaction_id": tid})]
            role = "network"
        pending = [(n, a) for n, a in plan if n not in responded]
        usage = types.GenerateContentResponseUsageMetadata(prompt_token_count=100, candidates_token_count=20)
        if pending:
            name, args = pending[0]
            ScriptedLlm.calls.append(f"{role}:{name}")
            yield LlmResponse(content=types.Content(role="model", parts=[_call(name, args)]), usage_metadata=usage)
        else:
            ScriptedLlm.calls.append(f"{role}:done")
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=f"{role} finished")]),
                              usage_metadata=usage)
