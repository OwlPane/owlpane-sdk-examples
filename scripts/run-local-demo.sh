#!/usr/bin/env bash
# End-to-end local stack runner for Owlpane SDK examples.
# Usage:
#   ./scripts/run-local-demo.sh --once   # emit rich traces, metrics, logs, and RUM across all SDKs
#   ./scripts/run-local-demo.sh --loop   # run continuous demo-server traffic against local cell (:4318)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:---once}"

export OWLPANE_API_URL="${OWLPANE_API_URL:-http://127.0.0.1:4100}"
export OWLPANE_INGEST_URL="${OWLPANE_INGEST_URL:-http://127.0.0.1:4318}"
export OWLPANE_ENVIRONMENT="${OWLPANE_ENVIRONMENT:-development}"
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"

if [ ! -f "$ROOT/.env" ] || ! grep -q '^OWLPANE_INGEST_KEY_NODE=owl_ing_' "$ROOT/.env" 2>/dev/null; then
  echo "Onboarding SDK example projects against ${OWLPANE_API_URL}…"
  node "$ROOT/scripts/onboard-dogfood.mjs" --write-env
fi

if [ "$MODE" = "--loop" ]; then
  echo "Starting continuous demo-server (Node.js) + runtime ticker every ${DOGFOOD_RUNTIME_TICK_SEC:-45}s…"
  chmod +x "$ROOT/apps/demo-server/run.sh" "$ROOT/scripts/run-dogfood-runtime-ticker.sh" "$ROOT"/apps/*/run.sh 2>/dev/null || true
  "$ROOT/scripts/run-dogfood-runtime-ticker.sh" &
  TICKER_PID=$!
  trap 'kill "$TICKER_PID" 2>/dev/null || true' EXIT INT TERM
  exec "$ROOT/apps/demo-server/run.sh"
else
  echo "Running one-shot rich telemetry pass across all example apps…"
  chmod +x "$ROOT/run-dogfood.sh"
  "$ROOT/run-dogfood.sh"
  echo ""
  CONSOLE="${OWLPANE_CONSOLE_URL:-http://127.0.0.1:4200}"
  echo "Local Console Verification Checklist (${CONSOLE}):"
  echo "  1. Applications -> Node.js / Python / Go / Java / Ruby (env: ${OWLPANE_ENVIRONMENT})"
  echo "  2. Requests     -> /observability/requests — owlpane-sdk-* (GET /demo -> SELECT orders & POST /checkout)"
  echo "  3. Logs         -> Group histogram by customer.tier; show more values on Fields (L3/L17)"
  echo "  4. Search       -> What's different? baseline 'Just before' (T3)"
  echo "  5. Metrics      -> /observability/explorer — owlpane.dogfood.requests or http.server.request.duration"
  echo "  6. Frontend/RUM -> owlpane-sdk-browser page load, feature flag, exception spans"
  echo "  7. Dashboards   -> /observability/dashboards/library or /templates — install a starter pack"
fi
