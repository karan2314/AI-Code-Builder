# Implementation Plan: FraudLens AI MVP

Deadline 18 Oct 2026. Order = critical path. Tasks marked `*` are stretch; skip them if behind schedule.
Owner tags: (ML) AI/ML lead, (BE) backend/cloud lead, (FE) frontend/product lead.

- [x] 1. Foundation and deployed skeleton (BE)
  - [x] 1.1 Install toolchain and bootstrap the GCP project
    - gcloud, firebase-tools, uv + Python 3.12; ADC login; run `infra/setup.sh` (APIs: run, cloudbuild, artifactregistry, aiplatform, firestore, logging, storage; SA `fraudlens-run-sa`; Firestore native; bucket)
    - Verify: `gcloud config list`; Gemini smoke call succeeds with ADC
    - _Requirements: 12.1_
  - [x] 1.2 Scaffold the repo per `structure.md`
    - `backend/pyproject.toml` (pinned versions from `tech.md`), `app/main.py` with `/healthz` and static mount, `config.py`, `observability.py` (JSON logs), `.env.example`, `.gitignore`, `.gcloudignore`
    - `frontend/` Vite React TS + Tailwind with `/api` dev proxy, layout shell and demo banner
    - Verify: `uv run pytest -q` (health test), `npm run build`
    - _Requirements: 12.2, 12.5_
  - [x] 1.3 Root multi-stage Dockerfile and first Cloud Run deploy
    - Verify: `curl $URL/healthz` returns ok and the shell UI loads from the same URL
    - _Requirements: 12.1, 12.4_

- [x] 2. Synthetic data (ML)
  - [x] 2.1 Schemas: Transaction, Customer, Account, Device, Merchant, Recipient, FraudCase in `app/schemas`
    - _Requirements: 1.5, 2.1_
  - [x] 2.2 Seeded generator `app/data/generate.py` with the scenario mix + hero customer `CUST-HERO01`
    - Verify: same seed gives the same hash; scenario counts printed; hero txn of ₹185,000 present
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 2.3 `DataRepository` (in-memory pandas) loaded at startup from `./data` or GCS
    - _Requirements: 1.1_

- [x] 3. First-stage screening (ML)
  - [x] 3.1 Point-in-time feature builder + leakage unit test
    - _Requirements: 3.1, 11.1_
  - [x] 3.2 Rules baseline with reason codes
    - _Requirements: 3.2_
  - [x] 3.3 Train LightGBM + Isolation Forest on a time split, calibrate the threshold on val, version artifacts, write `docs/metrics/detection_metrics.json`
    - Verify: candidate rate within 1–5% on test; metrics JSON exists
    - _Requirements: 3.3, 3.5, 11.2, 11.4_
  - [x] 3.4 `score` / `score_batch` + `POST /api/transactions/score`, `/batch-score`, `GET /api/queue` (validation, idempotency)
    - Verify: API tests; P95 single-score latency logged < 100 ms locally
    - _Requirements: 2.1, 2.2, 2.3, 3.4, 3.6, 3.7, 3.8_

- [x] 4. Graph and investigation tools (ML + BE)
  - [x] 4.1 NetworkX graph build + `ego_graph` + `GET /api/network/{entity_id}`
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 4.2 Evidence model + tool-result → evidence conversion (incl. the `unavailable` status)
    - _Requirements: 4.2, 4.3_
  - [x] 4.3 Behavior tools: get_customer_profile, get_transaction_history (summary), get_account_limits, calculate_customer_deviation (with cohort fallback + `limited_history`)
    - _Requirements: 4.1, 4.4, 4.5_
  - [x] 4.4 Network tools: get_related_accounts, search_known_fraud_cases, analyze_fraud_network, get_device_history
    - _Requirements: 4.1, 10.2_
  - [x] 4.5 Transaction tools: calculate_velocity, get_merchant_history, get_ml_risk_score
    - _Requirements: 4.1_
  - [x] 4.6 Unit tests for every tool against the hero fixture (values match the generator ground truth)
    - _Requirements: 4.5_

- [x] 5. Policy engine and case service (BE)
  - [x] 5.1 `policy/engine.py` rules R1–R8 + `POLICY_VERSION`; table-driven tests
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 5.2 Case + audit repositories (Firestore + in-memory fallback), simulate_restriction / record_action, `POST /api/cases`, `GET /api/cases/{id}`, `POST /api/cases/{id}/action`, export
    - Verify: audit events are append-only (test that update/delete paths don't exist)
    - _Requirements: 7.6, 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 5.3 Deterministic investigation fallback (fixed tool order → evidence → policy → case)
    - Verify: the hero case reaches Tier 3 with no LLM involved
    - _Requirements: 5.7_

- [x] 6. Agentic investigation with Gemini (BE)
  - [x] 6.1 Gemini client + `InvestigationSummary` schema + evidence package builder (size cap, no PII) + validator (validity rate)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [x] 6.2 ADK agents: orchestrator + Customer Behavior + Fraud Network (AgentTool), callbacks (guard, evidence capture, trajectory), caps
    - Verify: `adk web` run on the hero case shows ≥ 2 specialists invoked
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [x] 6.3 `POST /api/cases/{id}/investigate` as a background task with progress steps, a 25 s timeout, and fallback to 5.3
    - _Requirements: 5.7, 9.5_
  - [x] 6.4 `POST /api/demo/hero` (create + investigate the hero case); cache the last good result for demo resilience
    - _Requirements: 9.6_
  - [x]* 6.5 Transaction Analysis Agent as a third specialist
    - _Requirements: 5.2_
  - [x] 6.6 Deploy and verify the hero investigation end to end on Cloud Run; check llm_call logs in Cloud Logging
    - _Requirements: 12.2_

- [x] 7. Analyst UI (FE)
  - [x] 7.1 Typed API client + types mirroring the schemas; dashboard KPIs from `/api/metrics`
    - _Requirements: 9.1_
  - [x] 7.2 Suspicious queue (sortable, keyboard-navigable, reason-code chips)
    - _Requirements: 9.2_
  - [x] 7.3 Case workspace: AI summary with clickable evidence chips, evidence list, investigation timeline with live progress, tier and action panel (policy vs Gemini, SIMULATED buttons), audit trail
    - _Requirements: 9.3, 9.5, 7.5, 7.6_
  - [x] 7.4 Network graph (Cytoscape) + list alternative
    - _Requirements: 10.2, 9.7_
  - [x] 7.5 Customer 360 (profile, limits, baseline, history chart)
    - _Requirements: 9.4_
  - [x] 7.6 Demo mode: hero button, persistent banner; accessibility pass (keyboard, focus, contrast, aria-live)
    - Verify: `accessibility-audit` skill; Lighthouse accessibility ≥ 90
    - _Requirements: 9.6, 9.7_

- [x] 8. Evaluation and benchmark (ML)
  - [x] 8.1 `evals/run_benchmark.py`: A rules vs B ML on test → `docs/metrics/benchmark.json`
    - _Requirements: 11.2, 11.4_
  - [x] 8.2 Agentic eval on golden scenarios + a sample of test candidates → `docs/metrics/agentic_eval.json` (tier accuracy, evidence validity, escalation rate, latency, cost/1k)
    - _Requirements: 11.3, 11.4_
  - [x] 8.3 `GET /api/metrics` + metrics page reading only those files + live ops counters
    - _Requirements: 11.5, 9.1_
  - [x]* 8.4 Laya (open-weight, replaces Jev) Variant C: private Cloud Run service + `get_laya_decision` tool + benchmark; measured no gain zero-shot, kept behind `ENABLE_LAYA=false`
    - _Requirements: 11.6_
  - [ ]* 8.5 Load the dataset into BigQuery and implement `BigQueryRepository` for the scale story
    - _Requirements: 1.2_

- [x] 9. Hardening and final deploy (BE)
  - [x] 9.1 Rate limiting + request-size caps on mutating routes; Firestore rules deny clients
    - _Requirements: 12.3_
  - [x] 9.2 Final deploy with `--min-instances 1`; run the smoke script (healthz, batch score, hero investigation, metrics) against the live URL
    - _Requirements: 12.4_

- [ ] 10. Submission assets (FE + all)
  - [ ] 10.1 README (live URL, category, architecture Mermaid, metrics table from JSON, setup, security notes), `docs/ARCHITECTURE.md`, `docs/PROMPTS.md`, `docs/DECISIONS.md`
  - [x] 10.2 Deck → PDF via the `pitch-deck-builder` skill (numbers only from `docs/metrics`)
  - [ ] 10.3 Video ≤ 3:00 via the `demo-video-script` skill; upload publicly and test logged-out
  - [ ] 10.4 Run the `rubric-self-review` skill; fix the top issues; submit before the deadline
