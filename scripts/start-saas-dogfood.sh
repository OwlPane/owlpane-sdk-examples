#!/usr/bin/env bash
# Populate Owlpane SaaS (crikiq API + in-cluster ingest via port-forward).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.dogfood-laptop-off" ]]; then
  echo "Laptop SaaS dogfood is disabled ($ROOT/.dogfood-laptop-off)." >&2
  echo "Use in-cluster sdk-examples (seo-infra owlpane-sdk-examples) or: rm $ROOT/.dogfood-laptop-off" >&2
  exit 1
fi

if [[ ! -f .env ]] || ! grep -q 'owlpane-api.crikiq.com' .env 2>/dev/null; then
  if [[ -f .env.production-saas.bak ]]; then
    cp .env.production-saas.bak .env
    echo "Copied .env.production-saas.bak → .env"
  else
    echo "Missing SaaS .env — copy .env.saas.example and fill login + ingest URL (14318)." >&2
    exit 1
  fi
fi

"$ROOT/scripts/saas-ingest-port-forward.sh" start
set -a
# shellcheck disable=SC1091
source .env
set +a
node scripts/onboard-dogfood.mjs --write-env
OWLPANE_DOGFOOD_MODE=rich ./run-dogfood.sh --once
"$ROOT/scripts/run-dogfood-loop-daemon.sh" restart
echo "SaaS dogfood running. Console: ${OWLPANE_CONSOLE_URL:-Amplify} · env ${OWLPANE_ENVIRONMENT:-production}"
