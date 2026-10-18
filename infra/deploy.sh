#!/usr/bin/env bash
# Build (Cloud Build) and deploy FraudLens AI to Cloud Run as one service.
# Usage: PROJECT_ID=my-project REGION=us-central1 [MIN_INSTANCES=0] ./infra/deploy.sh
#
# Cost controls:
#  - request-based billing (CPU only while serving requests); MIN_INSTANCES=0 scales to zero when idle.
#    Use MIN_INSTANCES=1 only during the judging window (avoids cold starts), then set it back to 0.
#  - max 2 instances, 1 vCPU / 1 GiB (measured peak ~0.5 GB), per-IP rate limits, daily AI investigation cap.
#  - Gemini is only called for investigations of candidates; screening never uses the LLM.
#  - Artifact Registry cleanup keeps only the 3 most recent images.
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.5-flash}"
AI_CAP="${MAX_AI_INVESTIGATIONS_PER_DAY:-60}"
# Optional Variant C: the private Laya decision service (deploy it first with ./infra/deploy_laya.sh).
ENABLE_LAYA="${ENABLE_LAYA:-false}"
LAYA_URL="${LAYA_URL:-}"
if [ "$ENABLE_LAYA" = "true" ] && [ -z "$LAYA_URL" ]; then
  LAYA_URL=$(gcloud run services describe fraudlens-laya --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/backend/data/scored.parquet" ] || [ ! -f "$ROOT/backend/models/screening.joblib" ]; then
  echo "Generating synthetic data and training screening models (seed 42)..."
  (cd "$ROOT/backend" && uv run python -m app.data.generate && uv run python -m app.ml.train)
fi

# Build in Cloud Build into the "fraudlens" Artifact Registry repo (cleanup policy keeps the 3 newest images).
REPO="fraudlens"
gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT_ID" --quiet
TAG="$(date -u +%Y%m%d-%H%M%S)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/app:${TAG}"
gcloud builds submit "$ROOT" --project "$PROJECT_ID" --region "$REGION" --tag "$IMAGE" \
  --machine-type e2-highcpu-8 --timeout 1800s --quiet

# Public demo: synthetic data only, every action simulated, mutating routes rate-limited, security headers on.
gcloud run deploy fraudlens \
  --image "$IMAGE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service-account "fraudlens-run-sa@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,GEMINI_ENABLED=true,GEMINI_MODEL=${GEMINI_MODEL},GEMINI_MODEL_SYNTH=${GEMINI_MODEL},FIRESTORE_ENABLED=true,DEMO_MODE=true,MAX_AI_INVESTIGATIONS_PER_DAY=${AI_CAP},ENABLE_LAYA=${ENABLE_LAYA},LAYA_URL=${LAYA_URL},UPLOADS_BUCKET=${PROJECT_ID}-fraudlens-uploads" \
  --cpu 1 --memory 2Gi \
  --cpu-throttling \
  --cpu-boost \
  --min-instances "$MIN_INSTANCES" \
  --max-instances 2 \
  --concurrency 20 \
  --timeout 300 \
  --ingress all \
  --allow-unauthenticated \
  --labels app=fraudlens,env=hackathon \
  --quiet

URL=$(gcloud run services describe fraudlens --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
echo "Deployed: $URL"
"$ROOT/infra/smoke.sh" "$URL"
