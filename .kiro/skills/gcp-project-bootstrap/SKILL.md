---
name: gcp-project-bootstrap
description: Set up a Google Cloud project for the hackathon - install/auth gcloud and Firebase CLI, enable APIs, create a least-privilege Cloud Run service account, Firestore, Artifact Registry, Secret Manager, and a billing budget. Use when starting the project, when gcloud is not configured, or when a deploy fails due to missing APIs/permissions.
---

# GCP Project Bootstrap

## 0. Tooling (macOS)

```bash
brew install --cask google-cloud-sdk     # gcloud
npm install -g firebase-tools@15.34.0    # firebase CLI
brew install uv && uv python install 3.12  # system python is 3.9; ADK needs >= 3.10
gcloud auth login
gcloud auth application-default login    # ADC for local dev + MCP servers
firebase login
```

## 1. Project

```bash
export PROJECT_ID="<unique-id>" REGION="us-central1" APP="fraudlens"
gcloud projects create "$PROJECT_ID"               # or reuse an existing one
gcloud config set project "$PROJECT_ID"
gcloud billing projects link "$PROJECT_ID" --billing-account "<BILLING_ACCOUNT_ID>"
gcloud config set run/region "$REGION"
```

Ask the user before creating projects or linking billing (cost-bearing, shared resource).

## 2. Generate `infra/setup.sh` (idempotent) containing

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${PROJECT_ID:?}" "${REGION:=us-central1}" "${APP:=fraudlens}"
SA="${APP}-run-sa@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com aiplatform.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com logging.googleapis.com iamcredentials.googleapis.com \
  storage.googleapis.com bigquery.googleapis.com firebase.googleapis.com --project "$PROJECT_ID"

BUCKET="${PROJECT_ID}-fraudlens"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access --project "$PROJECT_ID"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:${SA}" --role roles/storage.objectViewer >/dev/null

gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${APP}-run-sa" --display-name "${APP} Cloud Run" --project "$PROJECT_ID"

for role in roles/aiplatform.user roles/datastore.user roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:${SA}" --role "$role" --condition=None >/dev/null
done

gcloud firestore databases describe --database="(default)" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud firestore databases create --location="$REGION" --type=firestore-native --project "$PROJECT_ID"

gcloud artifacts repositories describe "$APP" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$APP" --repository-format=docker --location "$REGION" --project "$PROJECT_ID"

echo "Done. Service account: $SA"
```

Add bucket- and secret-scoped bindings (`roles/storage.objectUser`,
`roles/secretmanager.secretAccessor`) only when those resources exist.

## 3. Firebase

```bash
firebase projects:addfirebase "$PROJECT_ID"
firebase use "$PROJECT_ID"
firebase init hosting firestore   # public dir: frontend/dist, SPA: yes
```

Enable Authentication providers (Google + Anonymous) in the Firebase console.

## 4. Cost guardrails

- Budget alert: `gcloud billing budgets create --billing-account=<ID> --display-name="hackathon" --budget-amount=50USD --threshold-rule=percent=0.5 --threshold-rule=percent=0.9`
- Cloud Run `--max-instances`, `max_output_tokens` caps, rate limiting.

## 5. Verify

```bash
gcloud config list
gcloud services list --enabled | grep -E "run|aiplatform|firestore"
# Gemini smoke test (inside backend/, after `uv add google-genai==2.31.0`)
GOOGLE_GENAI_USE_VERTEXAI=true GOOGLE_CLOUD_PROJECT="$PROJECT_ID" GOOGLE_CLOUD_LOCATION=global \
  uv run python -c "from google import genai; print(genai.Client().models.generate_content(model='gemini-3.5-flash', contents='Say hi').text)"
```

Then deploy a minimal "hello Gemini" service (see `cloud-run-deploy` skill) on day one.
