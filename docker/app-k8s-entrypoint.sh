#!/usr/bin/env bash
# In-cluster: env from Kubernetes (ingest URL, one ingest key, OTEL_SERVICE_NAME).
set -euo pipefail
APP_ID="${OWLPANE_DOGFOOD_APP_ID:?set OWLPANE_DOGFOOD_APP_ID}"
EXAMPLES_ROOT="${EXAMPLES_ROOT:-/app/examples}"
INTERVAL="${DOGFOOD_INTERVAL_SEC:-45}"
MODE="${OWLPANE_EXAMPLE_MODE:-loop}"

cd "$EXAMPLES_ROOT"

run_app() {
  if [[ -d "apps/${APP_ID}" && -x "apps/${APP_ID}/run.sh" ]]; then
    (cd "apps/${APP_ID}" && exec ./run.sh)
  elif [[ -d "${APP_ID}" && -x "${APP_ID}/run.sh" ]]; then
    (cd "${APP_ID}" && exec ./run.sh)
  else
    echo "missing run.sh for app id=${APP_ID}" >&2
    exit 1
  fi
}

if [[ "$MODE" == "server" ]]; then
  run_app
fi

while true; do
  if [[ -d "apps/${APP_ID}" ]]; then
    (cd "apps/${APP_ID}" && ./run.sh) || echo "[sdk-example-${APP_ID}] run failed" >&2
  else
    (cd "${APP_ID}" && ./run.sh) || echo "[sdk-example-${APP_ID}] run failed" >&2
  fi
  sleep "$INTERVAL"
done
