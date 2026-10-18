#!/usr/bin/env bash
# Smoke test a FraudLens deployment (or local server).
# Usage: ./infra/smoke.sh https://fraudlens-xxxx.run.app     (default http://localhost:8080)
set -euo pipefail
URL="${1:-http://localhost:8080}"
py() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "1. health"
curl -fsS "$URL/api/health" | py 'assert d["status"]=="ok", d; print("  ", d)'

echo "2. frontend"
curl -fsS "$URL/" | grep -q '<div id="root">' || fail "SPA not served"
echo "   index.html served"

echo "3. batch screening (test split)"
curl -fsS -X POST "$URL/api/transactions/batch-score" -H 'Content-Type: application/json' -d '{"dataset":"test"}' \
  | py 'print("   ", d["count"], "screened,", d["candidates"], "candidates, rate", d["candidate_rate"], ",", d["latency_ms"], "ms")'

echo "4. hero investigation"
DEMO=$(curl -fsS -X POST "$URL/api/demo/hero")
CASE=$(echo "$DEMO" | py 'print(d["case_id"])')
if [ "$(echo "$DEMO" | py 'print(d["needs_investigation"])')" = "True" ]; then
  curl -fsS -m 120 -X POST "$URL/api/cases/$CASE/investigate?cached=true" >/dev/null
fi
curl -fsS "$URL/api/cases/$CASE" | py '
t=d["decision"]["tier"]; m=d["investigation_mode"]
print("   case", d["case_id"], "status", d["status"], "tier", t, "mode", m, "evidence", len(d["evidence"]),
      "validity", d["evidence_validity_rate"], "ai_error", d["ai_error"])
assert t == 3, "hero case should be Tier 3"'

echo "5. metrics"
curl -fsS "$URL/api/metrics" | py 'print("   ", d["live"]["transactions_screened"], "screened; detection metrics present:", d["detection"] is not None)'
echo "SMOKE OK"
