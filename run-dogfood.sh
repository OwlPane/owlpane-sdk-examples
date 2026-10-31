#!/usr/bin/env bash
# One-shot: emit one Server span per language. --loop: continuous demo-server (traces, metrics, logs).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:-}"
if [ "$MODE" = "--loop" ] || [ "$MODE" = "-l" ]; then
  shift || true
  exec "$ROOT/scripts/run-local-demo.sh" --loop
fi
if [ -n "$MODE" ] && [ "$MODE" != "--once" ]; then
  echo "Usage: $0 [--once | --loop]" >&2
  echo "  --once  default — run all SDK example apps once (incl. rust, php, dotnet)" >&2
  echo "  --loop  continuous owlpane-demo-server (Ctrl+C to stop)" >&2
  echo "  Detached: ./scripts/run-dogfood-loop-daemon.sh start" >&2
  echo "  Foreground loop: ./scripts/run-dogfood-foreground.sh (demo + ticker, Ctrl+C)" >&2
  exit 1
fi
chmod +x "$ROOT/run-dogfood.sh" "$ROOT/_lib/dogfood-env.sh" "$ROOT"/apps/*/run.sh 2>/dev/null || true
# shellcheck source=./scripts/_lib/dogfood-sdk-source.sh
source "$ROOT/scripts/_lib/dogfood-sdk-source.sh"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [ ! -f "$ROOT/.env" ] || ! grep -q '^OWLPANE_INGEST_KEY_NODE=owl_ing_' "$ROOT/.env" 2>/dev/null; then
  echo "Onboarding SDK example projects via API (Projects & keys)…" >&2
  "$ROOT/scripts/onboard-dogfood.sh" --write-env
fi

# shellcheck source=_lib/dogfood-env.sh
source "$ROOT/_lib/dogfood-env.sh" node
echo "Ingest ${OWLPANE_INGEST_URL} · env ${OWLPANE_ENVIRONMENT}"
echo "Create one console project per app (see dogfood.manifest.json)."
echo ""

run_app() {
  local app_id="$1"
  echo "=== ${app_id} ==="
  (cd "$ROOT/apps/$app_id" && chmod +x run.sh && ./run.sh)
}

run_app node
run_app go
run_app python
run_app java
run_app ruby
run_app rust
run_app php
run_app dotnet
run_app react-native
run_app serverless
run_app browser
echo ""
echo "Done. Console → Applications (per runtime) or Traces · filter by service owlpane-sdk-* · env ${OWLPANE_ENVIRONMENT:-development}."
