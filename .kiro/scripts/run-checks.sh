#!/usr/bin/env bash
# PostTaskExec hook: run whatever lint/tests exist for backend and frontend.
# Skips gracefully when a part of the stack doesn't exist yet.
set -u
status=0

if [ -f backend/pyproject.toml ] && command -v uv >/dev/null 2>&1; then
  echo "== backend: ruff + pytest =="
  (cd backend && uv run --quiet ruff check . 2>/dev/null; uv run --quiet pytest -q) || status=1
fi

if [ -f frontend/package.json ]; then
  echo "== frontend: lint + test + build =="
  (
    cd frontend || exit 1
    if grep -q '"lint"' package.json; then npm run --silent lint || exit 1; fi
    if grep -q '"test"' package.json; then CI=true npm test --silent -- --run || exit 1; fi
    npm run --silent build
  ) || status=1
fi

[ $status -eq 0 ] && echo "All checks passed." || echo "Checks FAILED - fix before marking the next task done."
exit $status
