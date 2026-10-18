# Decision Log

## 2026-10-16 · Scope frozen to BRD §22 MVP
One spec (`.kiro/specs/fraudlens-mvp`), critical path first. Jev, BigQuery and PDF export are stretch. *[Tech40]*

## 2026-10-16 · scikit-learn HistGradientBoosting instead of LightGBM
LightGBM's macOS wheel needs a system `libomp` (no Homebrew on the dev machine). HistGradientBoosting gives
comparable results for tabular data with no native dependency, and the image stays simple. *[Tech40]*

## 2026-10-16 · FastAPI pinned to 0.141.1
`google-adk==2.12.0` requires `opentelemetry-api<=1.42.1`, which conflicts with FastAPI 0.143. *[Tech40]*

## 2026-10-16 · Harder synthetic data
The first dataset gave near-perfect scores (unrealistic). Added legitimate device changes, legitimate bursts, young
legitimate recipients, subtle ATO, scams to unlinked mules and first-party fraud. Test PR-AUC dropped from 1.00 to
0.90, which is more credible. *[Impact25]*

## 2026-10-16 · Network paths only through shared devices / other customers
Paths through popular merchants or through the investigated customer created false "2 hops from fraud" links for
the benign scenario. Fraud links now require a direct match, or a path via shared devices / other customers. *[Tech40]*

## 2026-10-16 · Single Cloud Run service
FastAPI serves the API and the built React app: one URL for judges, no CORS, one deploy. *[UX10]*

## 2026-10-16 · Evidence completion after agents
If the agents skip a critical tool (deviation, network, known-fraud lookup), the deterministic path completes the
evidence so the policy engine never decides on partial data. *[Tech40]*

## 2026-10-18 · ADK uses Vertex AI via ADC, never API keys
ADK's Gemini class builds its own client from environment variables, so `config.py` sets
`GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT` and `GOOGLE_CLOUD_LOCATION`. The first real run fell back
because ADK looked for an API key. *[Tech40]*

## 2026-10-18 · Low thinking level + retries
Evidence is computed by tools, so deep model reasoning added latency and tokens without better grounding.
Agents and synthesis use `thinking_level=LOW`. Exponential-backoff retries (5 attempts) on 429/5xx after a burst
of agent calls hit a transient 429. *[Tech40]*

## 2026-10-18 · Policy 2026.10.2: ML score is not an independent indicator family
In the first real-Gemini benchmark, 4 of 4 legitimate candidates were escalated to Tier 2: every candidate has a
high ML score by construction, so "ML + one behaviour signal" counted as two families. The ML score now only feeds
the conflict check. On validation-split candidates (deterministic evidence) Tier ≥ 2 precision is 0.984 and recall
0.724. *[Impact25]*

## 2026-10-18 · Citation guard: valid ID list + one bounded repair
One hero synthesis cited non-existent IDs (validity 0.0, all findings dropped). The package now ends with the list
of valid IDs, and if more than half of the cited IDs are invalid, one repair call names them. The final benchmark
shows 0 invalid citations. *[Tech40] [Innov25]*

## 2026-10-18 · Cost controls for Cloud Run
Investigations run inside the request (request-based billing, no always-on CPU); scale to zero by default; max 2
instances of 1 vCPU / 1 GiB (measured ~0.5 GB peak); daily cap of 60 AI investigations per instance; demo cases
are reused instead of re-investigated; Artifact Registry keeps the 3 newest images; budget alert at ₹2,000
(50/90/100%). Cloud Armor and VPC were skipped (they need a paid load balancer, and Gemini/Firestore are reached
over Google's network). *[Tech40]*

## 2026-10-18 · Laya replaces Jev for Variant C; measured, then kept OFF in production
Laya (Convai Innovations, Apache-2.0 open weights, `laya==0.4.11`, checkpoint
`convaiinnovations/laya-typed-decisions` pinned at revision `1a793eb5…`) replaces the closed Jev API. It runs as a
**private** Cloud Run service (`fraudlens-laya`: IAM-only, no data access, scale to zero, weights baked into the
image, offline at runtime) and is exposed to the Transaction Analysis Agent as `get_laya_decision`. It is advisory
evidence (family `ml`): it never sets the tier, and disagreements are flagged.

Benchmark on all 221 test-split candidates (`docs/metrics/laya_eval.json`): zero-shot Laya routed **100% to
"investigate"**, so Variant C equals Baseline B (precision 0.8235, recall 0.8505) with **no reduction** in Gemini
escalations. Its probabilities barely separate fraud from legitimate candidates (AUC: account-takeover 0.3451,
mule-payment 0.6974, urgency 0.3476). Latency on 2 vCPU CPU is p50 9.4 s / p95 10.5 s, versus the vendor's 33 ms
on a T4 GPU. As the BRD prescribes, it stays **off the critical path** (`ENABLE_LAYA=false`). Fine-tuning Laya on
labelled fraud decisions (supported by its RLCD training loop) or running it on a GPU is the documented next step.
*[Tech40] [Innov25]*
