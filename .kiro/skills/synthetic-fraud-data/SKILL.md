---
name: synthetic-fraud-data
description: Generate the seeded, reproducible synthetic BFSI dataset for FraudLens AI - customers, accounts, devices, merchants, recipients, INR transactions, known fraud cases, and labeled scenarios (account takeover, mule network, card testing, benign high-value, limited history) including the hero demo customer. Use when creating, changing, or debugging the dataset or demo scenarios.
---

# Synthetic Fraud Data

## Output (`backend/data/*.parquet`, gitignored; tiny fixtures in `backend/tests/fixtures/`)

| Table | Key columns |
|---|---|
| customers | customer_id, segment (salaried/student/business/senior), account_age_days, home_city, typical_hours, median_amount_paise, daily_txn_rate |
| accounts | account_id, customer_id, txn_limit_paise, daily_limit_paise, opened_at |
| devices | device_id, first_seen, os, is_emulator |
| customer_devices | customer_id, device_id, first_used |
| merchants | merchant_id, name, mcc_category, city |
| recipients | recipient_id, account_hash, bank_code, created_at |
| transactions | transaction_id, customer_id, account_id, timestamp, amount_paise, currency, channel, merchant_id?, recipient_id?, device_id, ip_hash, geo_city |
| fraud_cases | case_id, entity_type, entity_id, status (confirmed/suspected), confirmed_at |
| labels | transaction_id, is_fraud, scenario |

## Generation recipe (`app/data/generate.py`, CLI `--seed --customers --days --out`)

1. `rng = np.random.default_rng(seed)`; `Faker.seed(seed)`. No wall-clock dependence (fix `START = 2026-07-01`).
2. Customers: lognormal median amount per segment (e.g. ₹500–₹20,000), Poisson daily rate 0.5–6,
   preferred hours, 1–2 devices, 10–40 familiar merchants/recipients.
3. Normal transactions: Poisson arrivals per day, amount = median × lognormal(0, 0.6), occasional
   (~1%) legit big purchases (benign high-value, labeled `benign_high_value`, is_fraud=0).
4. Scenarios (~0.5–1% of transactions are fraud):
   - **ATO**: new device + 3–8 rapid txns within 10 min + large transfer to a new recipient (often a mule).
   - **Mule network**: 5–15 recipients sharing devices/IPs, receiving from many victims, linked to `fraud_cases`.
   - **Card testing**: 10–30 small card txns (₹1–₹100) at new merchants in minutes.
   - **Limited history**: customers with < 5 prior txns (some fraud, some legit).
   - **Stale link**: recipient linked to a fraud case > 365 days old (tests policy rule R6).
5. **Hero customer `CUST-HERO01`** (deterministic, injected last): 90 days of 2–4 txns/day, median
   ≈ ₹6,000; on the final day, 4 rapid txns in 6 minutes from new device `DEV-HERO-NEW`, then
   `TXN-HERO-185K` = ₹185,000 to `RCP-MULE-07`, which links to 3 confirmed fraud cases.
6. Also inject the counterexample `CUST-BENIGN01`: a large but familiar purchase on a known device (it should land in Tier 1, or stay a non-candidate).
7. Write Parquet + `data/manifest.json` {seed, counts per table and scenario, sha256 per file}.

## Verify

- Same seed → identical sha256 in the manifest (unit test).
- Hero assertions: median ≈ ₹6,000 ± 10%, the 185K txn exists, the device is new, the recipient links to confirmed fraud.
- Fraud rate and scenario counts printed. No real-looking PII (names come from Faker but aren't used in the product; prefer IDs only).
