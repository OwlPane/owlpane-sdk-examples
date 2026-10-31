#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh node

# shellcheck source=../../_lib/dogfood-sdk-source.sh
source ../../_lib/dogfood-sdk-source.sh
if [ "${OWLPANE_SDK_SOURCE}" = "local" ]; then
  # shellcheck source=../../_lib/ensure-emitter-node-deps.sh
  source ../../_lib/ensure-emitter-node-deps.sh
elif [ ! -f node_modules/@owlpane/node/package.json ]; then
  npm pkg set "dependencies.@owlpane/node=${OWLPANE_SDK_VERSION}"
  npm install --include=dev --no-audit --no-fund
fi
npm run start
