#!/usr/bin/env bash
# SessionStart hook: prints environment status so the agent knows what's available.
# Output goes to the agent context. Never fails the session.

echo "== FraudLens AI hackathon session context =="
deadline=$(date -j -f "%Y-%m-%d %H:%M" "2026-10-18 23:59" +%s 2>/dev/null)
if [ -n "$deadline" ]; then
  hrs=$(( (deadline - $(date +%s)) / 3600 ))
  echo "Deadline: 18 Oct 2026 (~${hrs}h left). Prioritize the MVP critical path in .kiro/specs/fraudlens-mvp/tasks.md."
fi
echo "Rules: GCP only (Cloud Run), Gemini via ADK + google-genai, synthetic data, simulated actions, numbers only from docs/metrics/*.json."

check() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "  [ok] $1 $($1 --version 2>/dev/null | head -1)"
  else
    echo "  [missing] $1 - $2"
  fi
}
echo "Tooling:"
check gcloud "install: brew install --cask google-cloud-sdk (see gcp-project-bootstrap skill)"
check firebase "install: npm install -g firebase-tools@15.34.0"
check uv "install: brew install uv (Python 3.12 for ADK)"
check node "required for MCP servers"

if command -v gcloud >/dev/null 2>&1; then
  project=$(gcloud config get-value project 2>/dev/null)
  region=$(gcloud config get-value run/region 2>/dev/null)
  echo "GCP project: ${project:-<not set>}  run/region: ${region:-<not set>}"
  if [ ! -f "$HOME/.config/gcloud/application_default_credentials.json" ]; then
    echo "  ADC missing: run 'gcloud auth application-default login' (needed by MCP servers and local Gemini calls)"
  fi
fi

[ -f docs/DECISIONS.md ] && echo "Latest decision: $(grep -E '^##' docs/DECISIONS.md | tail -1)"
tasks=.kiro/specs/fraudlens-mvp/tasks.md
if [ -f "$tasks" ]; then
  done_n=$(grep -cE '^\s*- \[x\]' "$tasks"); todo_n=$(grep -cE '^\s*- \[ \]' "$tasks")
  echo "Spec fraudlens-mvp: ${done_n} done / ${todo_n} open. Next open: $(grep -m1 -E '^\s*- \[ \] [0-9]+\.[0-9]+' "$tasks" | sed 's/^ *//')"
fi
ls docs/metrics/*.json 2>/dev/null | sed 's/^/Metrics: /'
exit 0
