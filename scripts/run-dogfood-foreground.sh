#!/usr/bin/env bash
# Foreground dogfood loop: demo-server (Node) + runtime ticker. Ctrl+C stops both.
# Not detached — use run-dogfood-loop-daemon.sh for background.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./_lib/dogfood-sdk-source.sh
source "$ROOT/scripts/_lib/dogfood-sdk-source.sh"
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
export OWLPANE_API_URL="${OWLPANE_API_URL:-http://127.0.0.1:4100}"
export OWLPANE_INGEST_URL="${OWLPANE_INGEST_URL:-http://127.0.0.1:4318}"
export OWLPANE_ENVIRONMENT="${OWLPANE_ENVIRONMENT:-development}"
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
export DOGFOOD_RUNTIME_TICK_SEC="${DOGFOOD_RUNTIME_TICK_SEC:-45}"

if [ ! -f "$ROOT/.env" ] || ! grep -q '^OWLPANE_INGEST_KEY_NODE=owl_ing_' "$ROOT/.env" 2>/dev/null; then
  "$ROOT/scripts/onboard-dogfood.sh" --write-env
fi

chmod +x "$ROOT/scripts/run-dogfood-runtime-ticker.sh" "$ROOT"/apps/*/run.sh 2>/dev/null || true

# shellcheck source=./_lib/dogfood-target.sh
source "$ROOT/scripts/_lib/dogfood-target.sh"
dogfood_print_target

if dogfood_is_saas; then
  PF="$ROOT/scripts/saas-ingest-port-forward.sh"
  "$PF" start || true
  if ! "$PF" check 2>/dev/null; then
    "$PF" start
  fi
else
  export OWLPANE_INGEST_URL="${OWLPANE_INGEST_URL:-http://127.0.0.1:4318}"
  export OWLPANE_API_URL="${OWLPANE_API_URL:-http://127.0.0.1:4100}"
fi
if ! node "$ROOT/scripts/check-dogfood-cell.mjs"; then
  if dogfood_is_saas; then
    echo "[dogfood-foreground] SaaS preflight failed — fix remote Postgres / port-forward, or switch to LOCAL (.env.local.example)" >&2
  else
    echo "[dogfood-foreground] local preflight failed — start API (:4100), ingest (:4318), then ./scripts/onboard-dogfood.sh --write-env" >&2
  fi
  exit 1
fi

DEMO_PID=""
cleanup() {
  if [ -n "$DEMO_PID" ] && kill -0 "$DEMO_PID" 2>/dev/null; then
    echo ""
    echo "[dogfood-foreground] stopping demo-server (pid $DEMO_PID)"
    kill "$DEMO_PID" 2>/dev/null || true
    wait "$DEMO_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[dogfood-foreground] ingest ${OWLPANE_INGEST_URL} · env ${OWLPANE_ENVIRONMENT} · tick every ${DOGFOOD_RUNTIME_TICK_SEC}s"
echo "[dogfood-foreground] starting demo-server → ${OWLPANE_INGEST_URL} (http://127.0.0.1:4399)"
# Demo runs as a child job; lines are prefixed so you see traffic in this terminal.
(
  "$ROOT/apps/demo-server/run.sh" 2>&1 | while IFS= read -r line; do
    printf '[demo-server] %s\n' "$line"
  done
) &
DEMO_PID=$!

for _ in $(seq 1 20); do
  if curl -sf "http://127.0.0.1:4399/demo" >/dev/null 2>&1; then
    echo "[dogfood-foreground] demo-server ready (pid $DEMO_PID)"
    break
  fi
  sleep 1
done

echo "[dogfood-foreground] runtime ticker (Ctrl+C to stop)"
exec "$ROOT/scripts/run-dogfood-runtime-ticker.sh"
