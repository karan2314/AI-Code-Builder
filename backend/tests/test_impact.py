import json

import numpy as np

from app.config import settings
from evals.run_impact import counts, curve


def test_counts_and_curve():
    y = np.array([1, 1, 0, 0, 1])
    flag = np.array([True, False, True, False, True])
    c = counts(flag, y)
    assert (c["caught"], c["missed"], c["false_alarms"], c["true_negatives"]) == (2, 1, 1, 1)
    pts = curve(y, np.array([0.9, 0.2, 0.8, 0.1, 0.7]))
    assert pts[0]["recall"] == 0 and all(0 <= p["precision"] <= 1 for p in pts)
    assert all(a["precision"] >= b["precision"] for a, b in zip(pts, pts[1:], strict=False))  # interpolated = monotone


def test_impact_file_is_consistent():
    d = json.loads((settings.metrics_dir / "impact.json").read_text())
    r, f = d["variants"]["rules"], d["variants"]["fraudlens"]
    assert d["headline"]["extra_frauds_caught"] == f["caught"] - r["caught"]
    assert f["caught"] + f["missed"] == d["test_fraud_transactions"] == r["caught"] + r["missed"]
    assert sum(d["funnel"]["policy_tiers"].values()) == d["funnel"]["alerts"] == f["alerts"]
    assert sum(t["fraudlens_caught"] for t in d["by_fraud_type"]) == f["caught"]
