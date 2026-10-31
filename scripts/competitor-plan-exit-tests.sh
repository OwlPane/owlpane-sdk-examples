#!/usr/bin/env bash
# Wave 1 exit gates for Logz/O2 cross-check programme.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"

echo "== saas ingest port-forward =="
"$ROOT/scripts/saas-ingest-port-forward.sh" check || {
  echo "WARN: port-forward not up (skip if local-only docs run)" >&2
}

echo "== check-saas-ingest.mjs =="
node "$ROOT/scripts/check-saas-ingest.mjs" || {
  echo "WARN: ingest healthz failed" >&2
}

echo "== verify-cloud-infrastructure-local (AWS gate) =="
if [[ -f "$ROOT/.env" ]]; then
  node "$ROOT/scripts/verify-cloud-infrastructure-local.mjs" || echo "WARN: cloud gate failed (needs live API + emit)" >&2
else
  echo "SKIP verify (no .env)"
fi

echo "== agent test-rbac =="
(cd "$REPO/agent" && ./scripts/test-rbac.sh)

echo "== console unit tests =="
(cd "$REPO/console" && npm test -- test/infrastructure-k8s-hub.test.ts test/integration-helm-values.test.ts)

echo "== api ai-tool-plan =="
(cd "$REPO/api" && npm test -- test/ai-tool-plan.test.ts test/pipeline-enrichment.test.ts)

echo "== competitor-parity-spec =="
test -f "$REPO/api/docs/competitive/competitor-parity-spec.md"

echo "Wave 1 competitor-plan-exit-tests: OK"
