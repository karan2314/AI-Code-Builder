# Security & Responsible AI

## Secrets & credentials

- No secrets in code, git, the frontend bundle, logs, or prompts. A pre-write hook blocks
  Google API keys, private keys, and service-account JSON.
- Backend auth to Google APIs uses **Application Default Credentials** from a dedicated Cloud
  Run service account (`<app>-run-sa@<project>.iam.gserviceaccount.com`). Never download SA keys.
- Least privilege IAM for that service account, typically: `roles/aiplatform.user`,
  `roles/datastore.user`, `roles/storage.objectUser` (bucket-scoped), `roles/secretmanager.secretAccessor`
  (secret-scoped), `roles/logging.logWriter`.
- Third-party keys → Secret Manager → `--set-secrets` on Cloud Run.
- Firebase web config (`apiKey`, `projectId`…) is public by design, but still load it from
  `import.meta.env.VITE_FIREBASE_*` or Hosting's `/__/firebase/init.json` and lock it down with
  Firebase Security Rules, App Check, and API key restrictions.
- `.env`, `*.json` key files, and `.firebase/` belong in `.gitignore`; commit `.env.example` only.

## Network-exposed endpoints

- Every public endpoint needs a stated auth model. Default: Firebase Auth ID token verified on
  the backend (anonymous auth allowed for guest/demo mode). If an endpoint is intentionally
  unauthenticated (e.g. `/healthz`, public demo), say so in code comments and the README.
- Cloud Run services that only the frontend/backend call should use `--no-allow-unauthenticated`
  plus IAM, or verify ID tokens.
- Rate limit AI endpoints per user/IP and cap request size; set Cloud Run `--max-instances` to
  bound cost. Set a GCP billing budget alert.
- Validate all input with Pydantic/Zod. Use parameterized queries. Restrictive CORS (only our
  Firebase Hosting domains + localhost).
- Firestore/Storage Security Rules: deny by default, allow per-user paths only.

## Prompt & AI safety

- Treat user input and retrieved documents as untrusted: keep them out of the system
  instruction, delimit them clearly, and never let model output trigger privileged actions
  without validation (schema-check tool arguments, allow-list actions).
- Configure Gemini safety settings explicitly; handle blocked responses with a friendly message.
- Healthcare / legal / financial content: show a "not professional advice" disclaimer, cite
  sources (grounding), and offer an escalation path to a human/professional.
- Don't log raw PII or full prompts containing PII. Redact before logging. Mention data
  retention in the README/privacy note.
- Mitigate hallucination: grounding, structured output, "I don't know" instructions, and
  displaying confidence/citations in the UI.

## FraudLens-specific controls

- **Auth model (MVP):** a public demo on synthetic data. Read endpoints are open. Mutating endpoints
  (`/api/cases/{id}/investigate`, `/api/cases/{id}/action`, `/api/transactions/*score`) are
  rate-limited per IP (e.g. 10/min for investigate) and request-size capped. The analyst identity
  is a demo identity (`analyst:demo`) written to the audit trail. Flag in the README that production
  would need Identity Platform/IAP + RBAC (analyst vs supervisor).
- **No real PII:** synthetic, pseudonymous IDs only. The pre-write hook blocks card-number-like and PAN-like values.
- **Prompt injection:** merchant names, memos, and recipient labels are attacker-controllable in real
  life. Treat them as data inside the evidence package, never as instructions.
- **Action safety:** no code path lets Gemini output trigger `simulate_restriction` directly. Only the
  policy engine result + analyst confirmation (or policy auto-action in demo, labelled SIMULATED) can.
- **Audit integrity:** audit events are append-only. Firestore rules deny client writes (the backend
  writes using its service account).
