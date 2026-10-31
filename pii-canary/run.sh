#!/usr/bin/env bash
# Start the PII canary against a running Owlpane ingest gateway.
#   OWLPANE_ENDPOINT=http://127.0.0.1:4319 OWLPANE_INGEST_KEY=owl_ing_... ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../_lib/dogfood-env.sh
source ../_lib/dogfood-env.sh pii-canary
export OWLPANE_ENDPOINT="$OWLPANE_INGEST_URL"
export OWLPANE_INGEST_KEY="$OWLPANE_INGEST_KEY"
if [ -f .npmrc.ghpackages ]; then
  cp .npmrc.ghpackages .npmrc
  export GITHUB_PACKAGES_TOKEN="${GITHUB_PACKAGES_TOKEN:-$(gh auth token 2>/dev/null || true)}"
fi
if [ "${OWLPANE_SDK_SOURCE:-}" != "published" ] || [ ! -f node_modules/@owlpane/node/package.json ]; then
  npm install --include=dev --no-audit --no-fund
fi
npm run start
