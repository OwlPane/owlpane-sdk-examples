#!/usr/bin/env bash
# WS20: Wave 1 + API/console parity smoke.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"

"$ROOT/scripts/competitor-plan-exit-tests.sh"

echo "== api test (pipeline + ai + alerting ADR 0012) =="
(cd "$REPO/api" && npm test -- test/ai-tool-plan.test.ts test/pipeline-enrichment.test.ts test/vrl-allowlist.test.ts test/telemetry-landed.test.ts test/alert-event-eval.test.ts test/alert-eval-schedule.test.ts test/apm-menu-rollup.test.ts test/composite-expression.test.ts test/gap-wave3-parity.test.ts)
echo "== ingest test (telemetry-landed parse) =="
(cd "$REPO/ingest" && npm test -- test/telemetry-landed-parse.test.ts test/telemetry-landed-coalesce.test.ts)
(cd "$REPO/api" && npm test -- test/alert-telemetry-inbox.test.ts)
node "$REPO/api/scripts/check-gap-register-evidence.mjs"

echo "== gap-register evidence file =="
test -f "$REPO/api/docs/competitive/gap-register.csv"

echo "== optional live E2E (deployed API) =="
if [[ -n "${OWLPANE_API_URL:-}" ]] && [[ -n "${OWLPANE_ONBOARD_EMAIL:-}${OWLPANE_BEARER_TOKEN:-}" ]]; then
  node "$ROOT/scripts/e2e-parity-smoke.mjs"
else
  echo "skip e2e-parity-smoke (set OWLPANE_API_URL + login env in repo-root .env)"
fi

echo "Full parity exit script completed (local e2e: cd api && npm run test:parity:e2e with e2e:api on :4199)."
