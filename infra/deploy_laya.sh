#!/usr/bin/env bash
# Build and deploy the PRIVATE Laya decision service (Variant C) to Cloud Run.
# Usage: PROJECT_ID=my-project REGION=us-central1 ./infra/deploy_laya.sh
#
# Security: --no-allow-unauthenticated; only the FraudLens runtime service account (and, for local
# benchmarking, the deploying user) gets roles/run.invoker. Its own service account has no data access.
# Cost: request-based billing, scale to zero, max 1 instance; image kept to the 3 newest versions.
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="fraudlens"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/laya:0.4.11-typed-1a793eb"
LAYA_SA="fraudlens-laya-sa@${PROJECT_ID}.iam.gserviceaccount.com"
APP_SA="fraudlens-run-sa@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud artifacts repositories describe "$REPO" --location "$REGION" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" --project "$PROJECT_ID" \
    --description "FraudLens images"

gcloud iam service-accounts describe "$LAYA_SA" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create fraudlens-laya-sa --display-name "FraudLens Laya (no data access)" --project "$PROJECT_ID"
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${LAYA_SA}" \
  --role roles/logging.logWriter --condition=None --quiet >/dev/null

echo "Building image (CPU torch + Laya, weights baked at the reviewed revision)..."
gcloud builds submit "$ROOT/laya_service" --project "$PROJECT_ID" --region "$REGION" --tag "$IMAGE" \
  --machine-type e2-highcpu-8 --timeout 1800s

gcloud run deploy fraudlens-laya \
  --image "$IMAGE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --service-account "$LAYA_SA" \
  --no-allow-unauthenticated \
  --cpu 2 --memory 4Gi \
  --cpu-throttling --cpu-boost \
  --min-instances 0 --max-instances 1 --concurrency 4 \
  --timeout 120 \
  --labels app=fraudlens,component=laya,env=hackathon

gcloud run services add-iam-policy-binding fraudlens-laya --project "$PROJECT_ID" --region "$REGION" \
  --member "serviceAccount:${APP_SA}" --role roles/run.invoker --quiet >/dev/null
ME=$(gcloud config get-value account 2>/dev/null)
gcloud run services add-iam-policy-binding fraudlens-laya --project "$PROJECT_ID" --region "$REGION" \
  --member "user:${ME}" --role roles/run.invoker --quiet >/dev/null

cat > /tmp/fraudlens-ar-cleanup.json <<'JSON'
[{"name": "keep-3-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 3}},
 {"name": "delete-old", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "1d"}}]
JSON
gcloud artifacts repositories set-cleanup-policies "$REPO" --project "$PROJECT_ID" --location "$REGION" \
  --policy /tmp/fraudlens-ar-cleanup.json --no-dry-run --quiet >/dev/null || true
rm -f /tmp/fraudlens-ar-cleanup.json

URL=$(gcloud run services describe fraudlens-laya --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
echo "Laya service (private): $URL"
echo "Unauthenticated access must be refused:"; curl -s -o /dev/null -w "  HTTP %{http_code}\n" "$URL/v1/health"
echo "Authenticated health check:"
curl -fsS -m 180 -H "Authorization: Bearer $(gcloud auth print-identity-token)" "$URL/v1/health" && echo
