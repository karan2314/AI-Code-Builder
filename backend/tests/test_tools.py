"""Every investigation tool against the hero fixture; values must match the generator ground truth."""

import pytest

from app.data.generate import HERO_CUSTOMER, HERO_TXN
from app.tools import ALL_TOOLS
from app.tools.common import ToolInputError

T = HERO_TXN


def obs(resp, i=0):
    assert resp["status"] == "ok"
    return resp["evidence"][i]["observed"]


def test_profile(services):
    r = ALL_TOOLS["get_customer_profile"](customer_id=HERO_CUSTOMER)
    assert r["result"]["segment"] == "salaried" and r["result"]["account_age_days"] == 1460


def test_history_is_aggregate_only_and_before_txn(services):
    r = ALL_TOOLS["get_transaction_history"](customer_id=HERO_CUSTOMER, transaction_id=T, days=90)["result"]
    assert 5400 <= r["median_rupees"] <= 6600 and 2 <= r["txns_per_active_day"] <= 4.5
    assert r["max_rupees"] < 185000  # the investigated transaction is not in its own history
    assert "transactions" not in r


def test_limits(services):
    o = obs(ALL_TOOLS["get_account_limits"](account_id="ACC-HERO01", transaction_id=T))
    assert 0 < o["txn_limit_utilisation"] <= 1


def test_deviation(services):
    o = obs(ALL_TOOLS["calculate_customer_deviation"](customer_id=HERO_CUSTOMER, transaction_id=T))
    assert o["amount_rupees"] == 185000 and o["ratio_to_median"] > 25 and not o["limited_history"]


def test_deviation_rejects_wrong_customer(services):
    with pytest.raises(ToolInputError):
        ALL_TOOLS["calculate_customer_deviation"](customer_id="CUST-000001", transaction_id=T)


def test_velocity(services):
    o = obs(ALL_TOOLS["calculate_velocity"](transaction_id=T))
    assert o["count_10m"] == 4  # the 4 rapid transactions injected before the 185K transfer


def test_device_history(services):
    o = obs(ALL_TOOLS["get_device_history"](device_id="DEV-HERO-NEW", transaction_id=T))
    assert o["is_new_device"] and o["other_customers_on_device"] == 2 and o["prior_payments_to_confirmed_fraud"] >= 1


def test_counterparty(services):
    o = obs(ALL_TOOLS["get_merchant_history"](customer_id=HERO_CUSTOMER, counterparty_id="RCP-MULE-07", transaction_id=T))
    assert o["is_new_counterparty"] and o["counterparty_age_days"] < 90


def test_ml_score(services):
    o = obs(ALL_TOOLS["get_ml_risk_score"](transaction_id=T))
    assert o["is_candidate"] and o["risk_score"] > 0.9


def test_related_accounts(services):
    r = ALL_TOOLS["get_related_accounts"](entity_id="RCP-MULE-07", transaction_id=T)["result"]
    assert "DEV-MULE-2" in r["related_by_type"].get("device", [])


def test_known_fraud(services):
    r = ALL_TOOLS["search_known_fraud_cases"](entity_ids=["RCP-MULE-07", "RCP-MULE-08"], transaction_id=T)["result"]
    ids = {m["entity_id"]: m for m in r["matches"]}
    assert "RCP-MULE-07" not in ids  # the hero recipient itself is not confirmed...
    assert ids["RCP-MULE-08"]["status"] == "confirmed" and not ids["RCP-MULE-08"]["direct"]  # ...but its neighbour is


def test_network(services):
    o = obs(ALL_TOOLS["analyze_fraud_network"](transaction_id=T))
    assert o["counterparty_hops_to_fraud"] == 2 and o["linked_confirmed_fraud"] >= 3


def test_network_benign_not_linked(services):
    o = obs(ALL_TOOLS["analyze_fraud_network"](transaction_id="TXN-BENIGN-150K"))
    assert o["min_hops_to_fraud"] is None
