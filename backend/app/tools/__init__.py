"""Deterministic investigation tools (BRD section 9). Action tools live in app.cases and are never exposed to agents."""

from app.tools.behavior import (
    calculate_customer_deviation,
    get_account_limits,
    get_customer_profile,
    get_transaction_history,
)
from app.tools.laya import get_laya_decision
from app.tools.network import analyze_fraud_network, get_related_accounts, search_known_fraud_cases
from app.tools.transaction import (
    calculate_velocity,
    get_device_history,
    get_merchant_history,
    get_ml_risk_score,
)

BEHAVIOR_TOOLS = [get_customer_profile, get_transaction_history, get_account_limits, calculate_customer_deviation]
TRANSACTION_TOOLS = [calculate_velocity, get_device_history, get_merchant_history, get_ml_risk_score]
NETWORK_TOOLS = [get_related_accounts, search_known_fraud_cases, analyze_fraud_network]
DECISION_MODEL_TOOLS = [get_laya_decision]
ALL_TOOLS = {f.__name__: f for f in BEHAVIOR_TOOLS + TRANSACTION_TOOLS + NETWORK_TOOLS + DECISION_MODEL_TOOLS}
ACTION_TOOLS = {"simulate_restriction", "record_action", "create_case"}


def transaction_tools() -> list:
    """Transaction Analysis Agent tools. Laya is NOT given to the agents: when ENABLE_LAYA=true the case service
    calls it in parallel with the agents (it is a separate model service, ~9 s warm, ~60-80 s cold)."""
    return list(TRANSACTION_TOOLS)
