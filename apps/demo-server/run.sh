#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh demo-server

# shellcheck source=../../scripts/_lib/dogfood-sdk-source.sh
source ../../scripts/_lib/dogfood-sdk-source.sh
if [ "${OWLPANE_SDK_SOURCE}" = "local" ]; then
  # shellcheck source=../../_lib/ensure-emitter-node-deps.sh
  source ../../_lib/ensure-emitter-node-deps.sh
elif [ ! -f node_modules/@owlpane/node/package.json ]; then
  npm install --include=dev --no-audit --no-fund
fi
npm run start
