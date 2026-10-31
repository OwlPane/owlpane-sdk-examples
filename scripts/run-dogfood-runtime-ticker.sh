#!/usr/bin/env bash
# Re-emit one rich burst per runtime on an interval (Java/Python/Ruby/Go/Rust/PHP/.NET/RN/Serverless).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INTERVAL="${DOGFOOD_RUNTIME_TICK_SEC:-45}"
APPS=(go java python ruby rust php dotnet react-native serverless node browser)

# shellcheck source=./_lib/dogfood-target.sh
source "$ROOT/scripts/_lib/dogfood-target.sh"
if dogfood_is_saas; then
  PF="$ROOT/scripts/saas-ingest-port-forward.sh"
  "$PF" start || true
  if ! "$PF" check 2>/dev/null; then
    "$PF" start
  fi
fi
if ! node "$ROOT/scripts/check-dogfood-cell.mjs"; then
  echo "[dogfood-ticker] preflight failed (see messages above)" >&2
  exit 1
fi
if dogfood_is_saas && [[ "${OWLPANE_SAAS_PF_WATCH:-}" == "1" ]]; then
  PF="$ROOT/scripts/saas-ingest-port-forward.sh"
  "$PF" watch &
  disown
  echo "[dogfood-ticker] background port-forward watch (OWLPANE_SAAS_PF_WATCH=1)"
fi

while true; do
  for id in "${APPS[@]}"; do
    tick="$ROOT/apps/$id/run.sh"
    if [[ "$id" == "browser" && -x "$ROOT/apps/browser/dogfood-tick.sh" ]]; then
      tick="$ROOT/apps/browser/dogfood-tick.sh"
    fi
    if [[ -x "$tick" ]]; then
      echo "[dogfood-ticker] $id"
      "$tick" || echo "[dogfood-ticker] $id failed (continuing)" >&2
    fi
  done
  sleep "$INTERVAL"
done
