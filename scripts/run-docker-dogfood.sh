#!/usr/bin/env bash
# Run continuous demo-server in Docker (Docker Desktop). Ingest must be reachable at host :4318.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ ! -f "$ROOT/.env" ] || ! grep -q '^OWLPANE_INGEST_KEY_DEMO=owl_ing_' "$ROOT/.env" 2>/dev/null; then
  echo "Onboarding demo-server project…" >&2
  "$ROOT/scripts/onboard-dogfood.sh" --write-env
fi

set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

export OWLPANE_INGEST_URL="${OWLPANE_INGEST_URL:-http://host.docker.internal:4318}"

echo "Starting continuous dogfood (demo-server → ${OWLPANE_INGEST_URL})"
echo "Console: ${OWLPANE_CONSOLE_URL:-http://127.0.0.1:4200} · service owlpane-demo-server · env ${OWLPANE_ENVIRONMENT:-development}"
echo "Stop: docker compose -f docker-compose.dogfood.yml down"
echo ""

exec docker compose -f docker-compose.dogfood.yml up --build "$@"
