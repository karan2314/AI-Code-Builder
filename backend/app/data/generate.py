"""Seeded synthetic BFSI dataset generator for FraudLens AI.

Produces pseudonymous customers, accounts, devices, counterparties (merchants + recipients), INR
transactions, entity links and confirmed fraud cases, with labelled fraud scenarios and the hero
demo customer CUST-HERO01 (BRD section 25). No real PII is generated.

Usage:  uv run python -m app.data.generate --seed 42 --customers 1200 --days 90
"""

from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from app.config import settings

START = datetime(2026, 7, 1)
SEGMENTS = ["salaried", "student", "business", "senior"]
SEG_MEDIAN_RUPEES = {"salaried": 3500, "student": 900, "business": 9000, "senior": 2200}
SEG_RATE = {"salaried": 1.6, "student": 1.2, "business": 2.6, "senior": 0.8}
CHANNELS = ["upi", "card", "netbanking", "imps"]
MCC = ["grocery", "fuel", "electronics", "travel", "dining", "utilities", "pharmacy", "apparel", "education", "ecommerce"]

HERO_CUSTOMER = "CUST-HERO01"
HERO_TXN = "TXN-HERO-185K"
BENIGN_CUSTOMER = "CUST-BENIGN01"
BENIGN_TXN = "TXN-BENIGN-150K"


@dataclass
class Builder:
    rng: np.random.Generator
    days: int
    tx: list[dict] = field(default_factory=list)
    links: list[dict] = field(default_factory=list)

    def add(self, cust: dict, ts: datetime, rupees: float, cp: str, device: str, channel: str,
            is_fraud: int = 0, scenario: str = "normal", txn_id: str | None = None) -> None:
        self.tx.append({
            "transaction_id": txn_id,
            "customer_id": cust["customer_id"],
            "account_id": cust["account_id"],
            "timestamp": ts,
            "amount_paise": max(100, int(round(rupees * 100))),
            "currency": "INR",
            "channel": channel,
            "counterparty_id": cp,
            "device_id": device,
            "is_fraud": is_fraud,
            "scenario": scenario,
        })


def _ts(day: int, hour: float) -> datetime:
    hour = float(np.clip(hour, 0.0, 23.99))
    return START + timedelta(days=day, hours=hour)


def generate(seed: int = 42, n_customers: int = 1200, days: int = 90) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    b = Builder(rng=rng, days=days)

    # ---- counterparties -------------------------------------------------------------------------
    n_merchants, n_recipients = 900, 1400
    merchants = pd.DataFrame({
        "counterparty_id": [f"MER-{i:04d}" for i in range(1, n_merchants + 1)],
        "kind": "merchant",
        "category": rng.choice(MCC, n_merchants),
        "created_day": rng.integers(-2000, -30, n_merchants),
    })
    recipients = pd.DataFrame({
        "counterparty_id": [f"RCP-{i:05d}" for i in range(1, n_recipients + 1)],
        "kind": "recipient",
        "category": "p2p",
        "created_day": rng.integers(-2500, -20, n_recipients),
    })
    # Mule recipients: newly opened accounts, clustered by shared devices
    n_mules = 40
    mules = pd.DataFrame({
        "counterparty_id": [f"RCP-MULE-{i:02d}" for i in range(1, n_mules + 1)],
        "kind": "recipient",
        "category": "p2p",
        "created_day": rng.integers(0, 40, n_mules),
    })
    mule_ids = mules["counterparty_id"].tolist()
    # Unclustered fresh mules (no device links, never confirmed) - hard to catch
    n_fresh = 30
    fresh_mules = pd.DataFrame({
        "counterparty_id": [f"RCP-FM{i:03d}" for i in range(1, n_fresh + 1)],
        "kind": "recipient", "category": "p2p",
        "created_day": rng.integers(0, 80, n_fresh),
    })
    fresh_mule_ids = fresh_mules["counterparty_id"].to_numpy()
    # Legitimate young recipients (new friends, landlords, small shops) - realistic false-positive pressure
    n_young = 220
    young_legit = pd.DataFrame({
        "counterparty_id": [f"RCP-N{i:04d}" for i in range(1, n_young + 1)],
        "kind": "recipient", "category": "p2p",
        "created_day": rng.integers(0, 85, n_young),
    })
    young_ids = young_legit["counterparty_id"].to_numpy()
    young_created = dict(zip(young_legit["counterparty_id"], young_legit["created_day"], strict=True))
    clusters = [mule_ids[i:i + 6] for i in range(0, n_mules, 6)]
    for ci, members in enumerate(clusters):
        dev = f"DEV-MULE-{ci + 1}"
        for m in members:
            b.links.append({"entity_a": m, "entity_b": dev, "relation": "account_uses_device"})
    # Hero recipient RCP-MULE-07 sits in cluster 2 (MULE-07..12) sharing DEV-MULE-2

    # Confirmed fraud cases (entity level). Some are stale (> 1 year old).
    fraud_cases = []
    confirmed = [m for m in mule_ids if m not in ("RCP-MULE-07",)]
    confirmed = list(rng.choice(confirmed, 18, replace=False))
    for m in ("RCP-MULE-08", "RCP-MULE-09", "RCP-MULE-11"):  # hero network: 3 confirmed neighbours
        if m not in confirmed:
            confirmed.append(m)
    for i, ent in enumerate(sorted(confirmed)):
        day = int(rng.integers(5, 60)) if ent not in ("RCP-MULE-08", "RCP-MULE-09", "RCP-MULE-11") else int(rng.integers(20, 50))
        fraud_cases.append({"case_id": f"FC-{i + 1:04d}", "entity_id": ent, "entity_type": "recipient",
                            "status": "confirmed", "confirmed_day": day})
    # Stale links: ordinary recipients that were involved in fraud long ago
    stale = rng.choice(recipients["counterparty_id"], 12, replace=False)
    for j, ent in enumerate(stale):
        fraud_cases.append({"case_id": f"FC-S{j + 1:03d}", "entity_id": ent, "entity_type": "recipient",
                            "status": "confirmed", "confirmed_day": int(rng.integers(-700, -400))})

    # ---- customers ----------------------------------------------------------------------------
    custs = []
    for i in range(1, n_customers + 1):
        seg = SEGMENTS[int(rng.choice(4, p=[0.45, 0.2, 0.2, 0.15]))]
        median = SEG_MEDIAN_RUPEES[seg] * float(np.exp(rng.normal(0, 0.55)))
        custs.append({
            "customer_id": f"CUST-{i:06d}",
            "account_id": f"ACC-{i:06d}",
            "segment": seg,
            "account_age_days": int(rng.integers(60, 3650)),
            "median_rupees": median,
            "rate": SEG_RATE[seg] * float(np.exp(rng.normal(0, 0.35))),
            "pref_hour": float(rng.normal(14, 2.5)),
            "devices": [f"DEV-{i:06d}A"] + ([f"DEV-{i:06d}B"] if rng.random() < 0.35 else []),
            "start_day": 0,
        })
    # limited-history customers join late
    limited_idx = rng.choice(n_customers, 70, replace=False)
    for k in limited_idx:
        custs[k]["start_day"] = int(rng.integers(days - 12, days - 3))
        custs[k]["account_age_days"] = int(rng.integers(3, 20))

    hero = {"customer_id": HERO_CUSTOMER, "account_id": "ACC-HERO01", "segment": "salaried",
            "account_age_days": 1460, "median_rupees": 6000.0, "rate": 3.0, "pref_hour": 13.0,
            "devices": ["DEV-HERO-01"], "start_day": 0}
    benign = {"customer_id": BENIGN_CUSTOMER, "account_id": "ACC-BENIGN01", "segment": "business",
              "account_age_days": 2900, "median_rupees": 8000.0, "rate": 2.5, "pref_hour": 15.0,
              "devices": ["DEV-BENIGN-01"], "start_day": 0}
    all_custs = custs + [hero, benign]

    merchant_ids = merchants["counterparty_id"].to_numpy()
    recipient_ids = recipients["counterparty_id"].to_numpy()
    for c in all_custs:
        c["familiar"] = list(rng.choice(merchant_ids, int(rng.integers(8, 22)), replace=False)) + \
            list(rng.choice(recipient_ids, int(rng.integers(2, 8)), replace=False))
        c["daily_limit_rupees"] = float(max(100000, round(c["median_rupees"] * 60, -3)))
        c["txn_limit_rupees"] = float(max(50000, round(c["median_rupees"] * 40, -3)))

    # ---- normal behaviour ---------------------------------------------------------------------
    for c in all_custs:
        is_special = c["customer_id"] in (HERO_CUSTOMER, BENIGN_CUSTOMER)
        # ~15% of customers legitimately change phones during the period
        change_day = int(rng.integers(c["start_day"] + 5, days)) if (not is_special and rng.random() < 0.15
                                                                     and c["start_day"] + 5 < days) else None
        new_dev = f"DEV-{c['customer_id'][-6:]}N"
        for day in range(c["start_day"], days):
            n = int(rng.integers(2, 5)) if c["customer_id"] == HERO_CUSTOMER else int(rng.poisson(c["rate"]))
            for _ in range(n):
                hour = rng.normal(c["pref_hour"], 2.2)
                amt = c["median_rupees"] * float(np.exp(rng.normal(0, 0.55)))
                scen = "normal"
                if not is_special and rng.random() < 0.006:  # legitimate big purchase
                    amt = c["median_rupees"] * float(rng.uniform(8, 20))
                    scen = "benign_high_value"
                r = rng.random()
                if is_special or r < 0.86:
                    cp = str(rng.choice(c["familiar"]))
                elif r < 0.95:
                    cp = str(rng.choice(merchant_ids))
                else:  # legit payment to a young recipient that already exists on that day
                    cand = str(rng.choice(young_ids))
                    cp = cand if young_created[cand] < day else str(rng.choice(merchant_ids))
                    if cp == cand and rng.random() < 0.3:
                        amt *= float(rng.uniform(2, 6))  # e.g. rent / deposit
                dev = c["devices"][0] if (len(c["devices"]) == 1 or rng.random() < 0.8) else c["devices"][1]
                if change_day is not None and day >= change_day:
                    dev = new_dev
                ch = CHANNELS[int(rng.choice(4, p=[0.6, 0.25, 0.1, 0.05]))]
                b.add(c, _ts(day, hour), amt, cp, dev, ch, 0, scen)
            # occasional legitimate bursts (market / split bills): 3-5 quick small payments
            if not is_special and rng.random() < 0.012:
                t0 = _ts(day, rng.normal(c["pref_hour"], 2))
                dev = new_dev if (change_day is not None and day >= change_day) else c["devices"][0]
                for k in range(int(rng.integers(3, 6))):
                    b.add(c, t0 + timedelta(minutes=float(k * rng.uniform(0.5, 2.5))),
                          float(rng.uniform(20, 400)), str(rng.choice(merchant_ids)), dev, "upi", 0, "normal")

    regular = [c for c in custs if c["start_day"] == 0]
    pool = list(rng.permutation(len(regular)))

    def take(k: int) -> list[dict]:
        out = [regular[pool.pop()] for _ in range(k)]
        return out

    # ---- fraud: account takeover --------------------------------------------------------------
    ato_shared_dev = [f"DEV-ATO-S{i}" for i in range(1, 6)]
    for c in take(70):
        day = int(rng.integers(15, days))
        hour = float(rng.uniform(0, 23))
        dev = str(rng.choice(ato_shared_dev)) if rng.random() < 0.4 else f"DEV-ATO-{c['customer_id'][-6:]}"
        t0 = _ts(day, hour)
        for k in range(int(rng.integers(2, 6))):
            t = t0 + timedelta(minutes=float(k * rng.uniform(0.6, 2.5)))
            b.add(c, t, c["median_rupees"] * float(rng.uniform(0.3, 1.2)), str(rng.choice(recipient_ids)),
                  dev, "upi", 1, "account_takeover")
        big_cp = str(rng.choice(mule_ids)) if rng.random() < 0.7 else str(rng.choice(recipient_ids))
        b.add(c, t0 + timedelta(minutes=float(rng.uniform(6, 14))), c["median_rupees"] * float(rng.uniform(8, 35)),
              big_cp, dev, "imps", 1, "account_takeover")

    # ---- fraud: authorised push payment scams to mule network (victim's own device) -----------
    for c in take(70):
        day = int(rng.integers(10, days))
        b.add(c, _ts(day, rng.normal(c["pref_hour"], 2)), c["median_rupees"] * float(rng.uniform(4, 25)),
              str(rng.choice(mule_ids)), c["devices"][0], "upi", 1, "mule_network")

    # ---- fraud: card testing -------------------------------------------------------------------
    for c in take(40):
        day = int(rng.integers(10, days))
        dev = f"DEV-CT-{c['customer_id'][-6:]}"
        t0 = _ts(day, float(rng.uniform(0, 6)))
        for k in range(int(rng.integers(8, 20))):
            b.add(c, t0 + timedelta(minutes=float(k * rng.uniform(0.3, 1.0))), float(rng.uniform(1, 99)),
                  str(rng.choice(merchant_ids)), dev, "card", 1, "card_testing")

    # ---- subtle fraud: ATO via remote-access on the victim's own device, moderate amounts -------
    for c in take(45):
        day = int(rng.integers(10, days))
        b.add(c, _ts(day, rng.normal(c["pref_hour"], 3)), c["median_rupees"] * float(rng.uniform(1.5, 5)),
              str(rng.choice(np.concatenate([fresh_mule_ids, recipient_ids]))), c["devices"][0],
              str(rng.choice(["upi", "imps"])), 1, "account_takeover_subtle")

    # ---- subtle fraud: scams paid to fresh, unlinked mules at modest amounts ---------------------
    for c in take(45):
        day = int(rng.integers(10, days))
        b.add(c, _ts(day, rng.normal(c["pref_hour"], 2)), c["median_rupees"] * float(rng.uniform(1.2, 4)),
              str(rng.choice(fresh_mule_ids)), c["devices"][0], "upi", 1, "scam_fresh_mule")

    # ---- first-party fraud: looks like normal behaviour (largely undetectable by design) --------
    for c in take(30):
        day = int(rng.integers(10, days))
        b.add(c, _ts(day, rng.normal(c["pref_hour"], 2)), c["median_rupees"] * float(rng.uniform(0.8, 2.5)),
              str(rng.choice(c["familiar"])), c["devices"][0], "card", 1, "first_party")

    # ---- fraud among limited-history customers --------------------------------------------------
    for k in limited_idx[:15]:
        c = custs[k]
        b.add(c, _ts(days - 1, float(rng.uniform(8, 22))), float(rng.uniform(40000, 120000)),
              str(rng.choice(mule_ids)), f"DEV-LH-{c['customer_id'][-6:]}", "imps", 1, "limited_history_fraud")

    # ---- hero scenario (deterministic, BRD section 25) ----------------------------------------
    last = days - 1
    hero_t0 = START + timedelta(days=last, hours=14, minutes=2)
    # the hero's new device was also seen on two other (compromised) accounts
    for victim in take(2):
        t = START + timedelta(days=last - 3, hours=float(rng.uniform(1, 5)))
        b.add(victim, t, victim["median_rupees"] * 0.8, str(rng.choice(recipient_ids)), "DEV-HERO-NEW", "upi", 1, "account_takeover")
        b.add(victim, t + timedelta(minutes=4), victim["median_rupees"] * 15, "RCP-MULE-09", "DEV-HERO-NEW", "imps", 1, "account_takeover")
    rapid = [2400.0, 3100.0, 1800.0, 2750.0]
    for k, amt in enumerate(rapid):
        b.add(hero, hero_t0 + timedelta(minutes=k * 1.5), amt, f"RCP-{int(rng.integers(1, n_recipients)):05d}",
              "DEV-HERO-NEW", "upi", 1, "account_takeover", txn_id=f"TXN-HERO-R{k + 1}")
    b.add(hero, hero_t0 + timedelta(minutes=6), 185000.0, "RCP-MULE-07", "DEV-HERO-NEW", "imps", 1,
          "account_takeover", txn_id=HERO_TXN)

    # ---- benign counter-example: large purchase at a familiar merchant on a known device --------
    fam_merchant = next(m for m in benign["familiar"] if m.startswith("MER-"))
    for d in (20, 47, 71):  # occasional big purchases establish history
        b.add(benign, _ts(d, 15), 60000.0 + d * 100, fam_merchant, "DEV-BENIGN-01", "card", 0, "benign_high_value")
    b.add(benign, START + timedelta(days=last, hours=15, minutes=30), 150000.0, fam_merchant, "DEV-BENIGN-01",
          "card", 0, "benign_high_value", txn_id=BENIGN_TXN)

    # ---- assemble -------------------------------------------------------------------------------
    tx = pd.DataFrame(b.tx).sort_values(["timestamp", "customer_id"], kind="stable").reset_index(drop=True)
    seq = (tx.index + 1).map(lambda i: f"TXN-{i:07d}")
    tx["transaction_id"] = tx["transaction_id"].where(tx["transaction_id"].notna(), seq)

    customers = pd.DataFrame([{
        "customer_id": c["customer_id"], "account_id": c["account_id"], "segment": c["segment"],
        "account_age_days": c["account_age_days"], "home_device": c["devices"][0],
    } for c in all_custs])
    accounts = pd.DataFrame([{
        "account_id": c["account_id"], "customer_id": c["customer_id"],
        "txn_limit_paise": int(c["txn_limit_rupees"] * 100), "daily_limit_paise": int(c["daily_limit_rupees"] * 100),
    } for c in all_custs])
    counterparties = pd.concat([merchants, recipients, mules, fresh_mules, young_legit], ignore_index=True)
    links = pd.DataFrame(b.links)
    fraud = pd.DataFrame(fraud_cases)
    return {"transactions": tx, "customers": customers, "accounts": accounts,
            "counterparties": counterparties, "entity_links": links, "fraud_cases": fraud}


def write(tables: dict[str, pd.DataFrame], out: Path, seed: int) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"seed": seed, "start": START.isoformat(), "tables": {}}
    for name, df in tables.items():
        path = out / f"{name}.parquet"
        df.to_parquet(path, index=False)
        manifest["tables"][name] = {"rows": len(df), "sha256": hashlib.sha256(
            pd.util.hash_pandas_object(df, index=False).values.tobytes()).hexdigest()}
    tx = tables["transactions"]
    manifest["fraud_rate"] = round(float(tx["is_fraud"].mean()), 5)
    manifest["scenarios"] = tx["scenario"].value_counts().to_dict()
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=settings.dataset_seed)
    ap.add_argument("--customers", type=int, default=1200)
    ap.add_argument("--days", type=int, default=90)
    ap.add_argument("--out", type=Path, default=settings.data_dir)
    args = ap.parse_args()
    manifest = write(generate(args.seed, args.customers, args.days), args.out, args.seed)
    print(json.dumps({k: manifest[k] for k in ("fraud_rate", "scenarios")}, indent=2))
    print({k: v["rows"] for k, v in manifest["tables"].items()})


if __name__ == "__main__":
    main()
