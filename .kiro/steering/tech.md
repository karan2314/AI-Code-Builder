# Tech Stack: FraudLens AI on Google Cloud ONLY

## Hard rules

- **Google Cloud Platform only. Do NOT use AWS** (no boto3, `@aws-sdk/*`, CDK, Lambda, S3,
  Bedrock, SageMaker, DynamoDB, Cognito, Amplify) or Azure. The pre-write hook blocks them.
- **Deploy target: Cloud Run.** Firebase Hosting is optional for the frontend.
- **Generative AI = Gemini** via the Google Gen AI SDK on Gemini Enterprise Agent Platform
  (formerly Vertex AI). No OpenAI or Anthropic SDKs in the product.
- **Jev (TypeSafe AI, a third-party typed decision model) is OPTIONAL and off the critical path.**
  Only behind `ENABLE_JEV=false` by default, benchmark-only (BRD Variant C). It is not a Google
  model, so it can't be the AI that satisfies the hackathon requirement. Drop it if time is short.
- **Model IDs from config only.** No retired models (Gemini 1.x/2.0/2.5) or legacy SDKs
  (`google-generativeai`, `@google/generative-ai`, `vertexai.generative_models`).
- Pin exact dependency versions.

## Stack (versions checked 16 Oct 2026)

| Layer | Choice |
|---|---|
| Language | Python 3.12 (managed by `uv`; system Python 3.9 is too old) |
| API | FastAPI 0.143.3, Pydantic 2.14.1, pydantic-settings 2.16.0, uvicorn 0.54.0 |
| Agents | Google ADK `google-adk==2.12.0` (orchestrator + specialist agents, function tools) |
| LLM SDK | `google-genai==2.31.0`, Vertex mode (`GOOGLE_GENAI_USE_VERTEXAI=true`, location `global`) |
| ML | scikit-learn 1.9.1, lightgbm 4.7.0 (primary), xgboost 3.4.1 (optional), Isolation Forest |
| Data | pandas 3.0.6, numpy 2.5.4, Parquet files in the image or GCS for the MVP; BigQuery (`google-cloud-bigquery==3.46.2`) for the scale story |
| Graph | networkx 3.7 (server); Cytoscape.js 3.34.4 (UI) |
| State | Firestore (`google-cloud-firestore==2.34.1`) for cases, audit, and reviewer actions |
| Artifacts | Cloud Storage (`google-cloud-storage==3.17.1`) for datasets, model files, and case exports |
| Synthetic data | Faker 40.43.0 + numpy RNG with a fixed seed |
| Frontend | React 19.3.1, Vite 8.3.4, TypeScript, Tailwind 4.3.3, TanStack Query 5.104.3, React Router 7.18.4, Recharts 3.10.1, Cytoscape |
| Tests | pytest 9.1.1, ruff 0.17.1, httpx 0.28.1; vitest 5.0.5 |
| Observability | Structured JSON logs → Cloud Logging; Cloud Monitoring dashboard; optional Cloud Trace |

## Model selection

| Step | Env var | Default |
|---|---|---|
| Orchestrator agent (planning, tool choice) | `GEMINI_MODEL` | `gemini-3.5-flash` |
| Evidence synthesis / case summary | `GEMINI_MODEL_SYNTH` | `gemini-3.5-flash` (try `gemini-3.1-pro-preview` if quality needs it) |
| Cheap helpers (reason-code phrasing) | `GEMINI_MODEL_FAST` | `gemini-3.5-flash-lite` |

Verify IDs at https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/model-versions

## Deployment shape (MVP)

- **One Cloud Run service `fraudlens`**: FastAPI serves `/api/**` and the built React app
  (`frontend/dist` copied into the image). One URL for judges, no CORS.
- Dedicated service account `fraudlens-run-sa` with `roles/aiplatform.user`, `roles/datastore.user`,
  `roles/logging.logWriter`, bucket-scoped `roles/storage.objectViewer`, and
  `roles/bigquery.jobUser` + dataset-scoped `roles/bigquery.dataViewer` only if BigQuery is used.
- Region `us-central1` (alt `asia-south1`). Gemini location `global`.
- Demo day: `--min-instances 1 --max-instances 5`.
- Batch scoring of the full dataset runs at startup or as a Cloud Run Job and writes the results to GCS or Firestore.

## AWS → GCP map (if a tutorial suggests AWS)

Lambda/ECS → Cloud Run · S3 → Cloud Storage · DynamoDB → Firestore · Redshift/Athena → BigQuery ·
Bedrock/SageMaker → Gemini Enterprise Agent Platform · Step Functions → Workflows ·
SQS/SNS → Pub/Sub · CloudWatch → Cloud Logging/Monitoring · Secrets Manager → Secret Manager ·
Neptune → NetworkX (MVP) / Spanner Graph (scale story).

## Commands

```bash
# backend (from backend/)
uv sync
uv run python -m app.data.generate --seed 42 --customers 2000 --days 90   # synthetic data
uv run python -m app.ml.train                                            # train + metrics JSON
uv run uvicorn app.main:app --reload --port 8080
uv run pytest -q && uv run ruff check .
uv run python -m evals.run_benchmark                                     # rules vs ML vs agentic
# frontend (from frontend/)
npm ci && npm run dev        # proxies /api to :8080
npm run build && npm test -- --run
# deploy (from repo root; builds frontend + backend into one image)
gcloud run deploy fraudlens --source . --region us-central1
```

## MCP servers (dev-time helpers; see `.kiro/mcp.recommended.json`)

| Server | Use it for |
|---|---|
| `gcloud` | Any gcloud operation (APIs, IAM, config) |
| `cloud-run` | Deploy (`deploy-local-folder`), list services, read service logs |
| `gcp-observability` | Query Cloud Logging for `llm_call` / `tool_call` events and errors |
| `bigquery` | Load and inspect the synthetic dataset at scale (stretch task 8.5) |
| `firestore` | Inspect cases and audit records during debugging |
| `chrome-devtools` | Lighthouse, accessibility tree, UI smoke test of the live URL |
| `context7` | Up-to-date docs for ADK, google-genai, LightGBM, Cytoscape |

Deploys, deletes, and IAM/billing changes still need user confirmation (the `confirm-cloud-changes` hook).
