#!/usr/bin/env bash
# Static checks: manifest ↔ helm examples, dogfood-env without Node, no secrets in git.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHART="${SDK_EXAMPLES_HELM_CHART:-$ROOT/../../../SEO2LS/seo-infra/helm-charts/owlpane-sdk-examples}"
MANIFEST="$ROOT/dogfood.manifest.json"
FAIL=0

echo "==> Manifest apps"
MANIFEST_IDS="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$MANIFEST','utf8')).apps.map(a=>a.id).sort().join(' '))")"

if [[ ! -f "$CHART/values.yaml" ]]; then
  echo "SKIP helm chart (not found at $CHART)"
  exit 0
fi

echo "==> Helm examples ids"
HELM_IDS="$(grep 'id:' "$CHART/values.yaml" | awk '{print $3}' | sort | tr '\n' ' ')"

for id in $MANIFEST_IDS; do
  if ! grep -q "id: $id" "$CHART/values.yaml"; then
    echo "MISSING in helm values: $id" >&2
    FAIL=1
  fi
done

echo "==> dogfood-env (python3-only, no node on PATH)"
(
  export PATH="/usr/bin:/bin"
  command -v node >/dev/null 2>&1 && { echo "skip: node still on PATH"; exit 0; }
  command -v python3 >/dev/null 2>&1 || { echo "need python3 for test"; exit 0; }
  cd "$ROOT"
  export OWLPANE_INGEST_URL=http://ingest.test:4318
  export OWLPANE_INGEST_KEY=owl_ing_0123456789abcdef0123456789abcdef0123456789abcdef
  export OTEL_SERVICE_NAME=owlpane-sdk-node
  # shellcheck source=../_lib/dogfood-env.sh
  source _lib/dogfood-env.sh node
  [[ "$OWLPANE_INGEST_URL" == "http://ingest.test:4318" ]] || FAIL=1
)

echo "==> Dockerfiles for each manifest app (except disabled browser)"
for id in $MANIFEST_IDS; do
  if [[ "$id" == "browser" ]]; then continue; fi
  if [[ "$id" == "demo-server" || "$id" == "pii-canary" || "$id" == "node" || "$id" == "go" || "$id" == "python" || "$id" == "java" || "$id" == "ruby" ]]; then
    f="$ROOT/docker/apps/${id}.Dockerfile"
  else
    f="$ROOT/docker/apps/emitter.Dockerfile"
  fi
  if [[ ! -f "$f" ]]; then
    echo "MISSING Dockerfile for $id ($f)" >&2
    FAIL=1
  fi
done

if [[ -f "$ROOT/.env" ]] && grep -qE '^OWLPANE_INGEST_KEY.*=owl_ing_' "$ROOT/.env"; then
  if git -C "$ROOT" check-ignore -q .env 2>/dev/null || [[ -f "$ROOT/.gitignore" ]] && grep -q '^\.env' "$ROOT/.gitignore"; then
    echo "==> .env present but gitignored (ok)"
  else
    echo "WARN: .env with ingest keys may not be gitignored" >&2
  fi
fi

echo "==> helm template (enabled)"
helm template v "$CHART" -f "$CHART/values.yaml" --set enabled=true --set imageTag=ci-test >/dev/null

DEPLOYS="$(helm template v "$CHART" -f "$CHART/values.yaml" --set enabled=true --set imageTag=ci-test | grep -c 'kind: Deployment' || true)"
echo "Deployments rendered: $DEPLOYS (expect 12 with browser disabled)"

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
echo "OK"
