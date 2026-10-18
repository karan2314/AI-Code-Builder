#!/usr/bin/env bash
# One-time, idempotent GCP setup for FraudLens AI (cost-conscious, least privilege).
# Usage: PROJECT_ID=my-project REGION=us-central1 [BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX BUDGET_AMOUNT=2000] ./infra/setup.sh
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-us-central1}"
APP="fraudlens"
SA="${APP}-run-sa@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "1/5 Enabling only the APIs we use..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  aiplatform.googleapis.com firestore.googleapis.com logging.googleapis.com monitoring.googleapis.com \
  iamcredentials.googleapis.com --project "$PROJECT_ID"

echo "2/5 Runtime service account ${SA} (no keys are ever created)..."
gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "${APP}-run-sa" --display-name "FraudLens Cloud Run runtime" --project "$PROJECT_ID"
# Least privilege: call Gemini, read/write Firestore, write logs and metrics. Nothing else.
for role in roles/aiplatform.user roles/datastore.user roles/logging.logWriter roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${SA}" --role "$role" \
    --condition=None --quiet >/dev/null
done

echo "3/5 Build identity for 'gcloud run deploy --source' (Cloud Build uses the compute default SA)..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:${BUILD_SA}" \
  --role roles/run.builder --condition=None --quiet >/dev/null

echo "4/5 Firestore (native mode, ${REGION})..."
gcloud firestore databases describe --database="(default)" --project "$PROJECT_ID" >/dev/null 2>&1 || \
  gcloud firestore databases create --location="$REGION" --type=firestore-native --project "$PROJECT_ID"

echo "5/5 Budget alert..."
if [ -n "${BILLING_ACCOUNT:-}" ]; then
  gcloud services enable billingbudgets.googleapis.com --project "$PROJECT_ID"
  # The budget must use the billing account's currency, and the filter needs the project NUMBER.
  CURRENCY=$(gcloud billing accounts describe "$BILLING_ACCOUNT" --format='value(currencyCode)')
  gcloud billing budgets create --billing-account "$BILLING_ACCOUNT" --display-name "fraudlens-hackathon" \
    --budget-amount "${BUDGET_AMOUNT:-2000}${CURRENCY}" --filter-projects "projects/${PROJECT_NUMBER}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
else
  echo "   skipped (set BILLING_ACCOUNT [and BUDGET_AMOUNT in the account currency] for 50/90/100% email alerts)"
fi

echo "Done. Deploy with: PROJECT_ID=${PROJECT_ID} REGION=${REGION} ./infra/deploy.sh"
echo "Optional: deny all client-SDK access to Firestore (the backend uses the server SDK):"
echo "  npx -y firebase-tools@15.34.0 login && npx -y firebase-tools@15.34.0 deploy --only firestore:rules --project ${PROJECT_ID}"
