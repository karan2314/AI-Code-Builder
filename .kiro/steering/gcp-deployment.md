---
inclusion: fileMatch
fileMatchPattern: "{**/Dockerfile,**/cloudbuild.yaml,**/firebase.json,**/.firebaserc,**/apphosting.yaml,**/.gcloudignore,infra/**,**/service.yaml}"
---

# GCP Deployment Standards (Cloud Run + Firebase)

## Cloud Run container contract

- Listen on `0.0.0.0:$PORT` (default 8080). Never hardcode the port.
- Stateless; write only to `/tmp` (in-memory). Persist to Firestore / Cloud Storage.
- Start fast: slim base image, no work at import time that calls the network.
- Handle `SIGTERM` gracefully. Log JSON to stdout.
- Run as a non-root user.
- `GET /healthz` for startup/liveness probes.

FraudLens ships as **one image**: the React build and the FastAPI backend (API + static files).

```dockerfile
# ./Dockerfile (repo root)
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
# libgomp1 is required by LightGBM
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /bin/uv
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/app ./app
COPY backend/models ./models
COPY backend/data ./data
COPY --from=web /web/dist ./static
RUN useradd -m appuser && chown -R appuser /app
USER appuser
CMD ["sh", "-c", "/app/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
```

## Deploy command baseline

Demo day: `--min-instances 1` avoids cold starts (set it back to 0 after judging). `--max-instances` is the cost guardrail.

```bash
gcloud run deploy fraudlens \
  --source . \
  --region "$REGION" \
  --service-account "fraudlens-run-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-3.5-flash,DEMO_MODE=true" \
  --min-instances 1 \
  --max-instances 5 \
  --cpu 2 --memory 2Gi --timeout 300 --cpu-boost \
  --allow-unauthenticated
```

`--allow-unauthenticated` is acceptable here only because the app serves synthetic data, every
action is simulated, and mutating endpoints are rate-limited and gated by `DEMO_MODE` (see `security.md`).
State this in the README.

- Required APIs: `run`, `cloudbuild`, `artifactregistry`, `aiplatform`, `firestore`,
  `secretmanager`, `logging`, `iamcredentials` (see `infra/setup.sh`).
- Use a dedicated service account per service, never the default compute SA.
- Websockets/SSE: set `--timeout` high enough and consider `--session-affinity`.
- Gemma on GPU: `--gpu 1 --gpu-type nvidia-l4 --no-cpu-throttling` in a GPU-supported region.

## Firebase

- Frontend → Firebase Hosting; route API calls through Hosting rewrites to Cloud Run so the
  app is same-origin (no CORS, one URL for judges):

```json
{
  "hosting": {
    "public": "frontend/dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [
      { "source": "/api/**", "run": { "serviceId": "impact-api", "region": "us-central1" } },
      { "source": "**", "destination": "/index.html" }
    ],
    "headers": [
      { "source": "**", "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]}
    ]
  }
}
```

- Next.js / Angular SSR → Firebase App Hosting (`apphosting.yaml`, backed by Cloud Run).
- Ship `firestore.rules` and `storage.rules` (deny by default) and deploy them with the app.
- Use preview channels (`firebase hosting:channel:deploy demo`) for safe pre-demo testing.

## CI/CD (optional but adds technical-merit points)

`infra/cloudbuild.yaml`: test → build → push to Artifact Registry → deploy Cloud Run → deploy
Hosting. Trigger on push to `main`.

## Before every deploy

- Tests pass, no secrets in the diff, `.env.example` updated.
- After deploy: hit `/healthz`, run the hero flow on the live URL, check Cloud Logging for errors.
