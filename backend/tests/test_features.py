import numpy as np
import pandas as pd

from app.data.generate import HERO_TXN
from app.features.build import FEATURE_COLUMNS, compute_features


def _features(repo, tx):
    return compute_features(tx, repo.accounts, repo.counterparties, repo.fraud_cases, repo.entity_links, repo.start)


def test_no_future_leakage(services):
    """Features of a transaction must not change when all later transactions are removed."""
    repo = services.repo
    tx = repo.transactions
    hero_ts = tx.loc[tx.transaction_id == HERO_TXN, "timestamp"].iloc[0]
    full = _features(repo, tx).loc[HERO_TXN, FEATURE_COLUMNS]
    # perturb the future: drop everything after the hero txn and add a fake future burst
    past = tx[tx["timestamp"] <= hero_ts]
    future = tx[tx["customer_id"] == "CUST-HERO01"].tail(5).copy()
    future["timestamp"] = hero_ts + pd.Timedelta(minutes=1)
    future["transaction_id"] = [f"TXN-FUTURE-{i}" for i in range(len(future))]
    perturbed = pd.concat([past, future], ignore_index=True)
    trimmed = _features(repo, perturbed).loc[HERO_TXN, FEATURE_COLUMNS]
    assert np.allclose(full.to_numpy(), trimmed.to_numpy(), equal_nan=True)


def test_hero_feature_values(services):
    f = services.scorer.features_row(HERO_TXN)
    assert f["amount_rupees"] == 185000
    assert 5500 <= f["prior_median"] <= 6600
    assert f["device_new"] == 1
    assert f["cnt_10m"] >= 3


def test_hero_is_candidate_benign_is_not(services):
    assert services.scorer.score_existing(HERO_TXN).is_candidate
    assert not services.scorer.score_existing("TXN-BENIGN-150K").is_candidate


def test_generator_is_deterministic():
    from app.data.generate import generate

    a = generate(seed=7, n_customers=500, days=30)["transactions"]
    b = generate(seed=7, n_customers=500, days=30)["transactions"]
    pd.testing.assert_frame_equal(a, b)
