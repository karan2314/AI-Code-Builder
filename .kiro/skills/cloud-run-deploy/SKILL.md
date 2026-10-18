---
name: cloud-run-deploy
description: Containerize and deploy the backend or full app to Google Cloud Run (source deploy or Cloud Build + Artifact Registry), wire secrets and service accounts, tune scaling for demo day, and troubleshoot failed revisions with logs. Use when deploying, redeploying, or debugging a Cloud Run service.
---

# Cloud Run Deploy

Follow `gcp-deployment.md` for the container contract.

## Pre-flight

1. `gcloud config get-value project` is the hackathon project; region set.
2. APIs enabled and service account exists (`gcp-project-bootstrap`).
3. Tests pass locally; `Dockerfile` listens on `$PORT`; `/healthz` exists.
4. No secrets in the repo; secrets exist in Secret Manager.
5. `.gcloudignore` excludes `.venv`, `node_modules`, `.env`, `tests`, `.git`.

## Deploy

Option A – source deploy (fastest):
```bash
gcloud run deploy fraudlens --source . --region "$REGION" \
  --service-account "fraudlens-run-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global" \
  --max-instances 10 --memory 1Gi --timeout 300 --allow-unauthenticated
```
State the auth model when using `--allow-unauthenticated` (backend must verify Firebase ID
tokens or the endpoint is intentionally public demo).

Option B – Cloud Run MCP server (`cloud-run` in mcp.json): `deploy-local-folder` tool, then
`get-service-log` to check startup.

Option C – CI: `gcloud builds submit --config infra/cloudbuild.yaml`.

## Post-deploy verification (always)

```bash
URL=$(gcloud run services describe fraudlens --region "$REGION" --format='value(status.url)')
curl -fsS "$URL/healthz"
curl -fsS -X POST "$URL/api/<hero-endpoint>" -H 'Content-Type: application/json' -d @backend/evals/sample_request.json
gcloud run services logs read fraudlens --region "$REGION" --limit 50
```

## Demo-day tuning

- `gcloud run services update fraudlens --min-instances 1` (warm; revert to 0 after judging).
- CPU boost on startup: `--cpu-boost`.
- Concurrency default 80 is fine for I/O-bound Gemini calls.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Container failed to start and listen on PORT" | Bind `0.0.0.0:$PORT`; check CMD; read logs |
| 403 calling Gemini | SA missing `roles/aiplatform.user`; wrong project env var |
| Build fails on source deploy | Missing lockfile / wrong Python version; test `docker build` or check Cloud Build logs |
| Cold start slow | min-instances 1, lighter image, lazy imports |
| 504 on long AI calls | Increase `--timeout`, stream responses |

Rollback: `gcloud run services update-traffic fraudlens --to-revisions <prev-rev>=100`.
