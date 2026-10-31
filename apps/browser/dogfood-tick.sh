#!/usr/bin/env bash
# Browser SDK is not a headless Node app — emit OTLP logs + a RUM-style trace burst for the ticker.
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh browser
export OWLPANE_DOGFOOD_APP_ID=browser
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
# shellcheck source=../../_lib/ensure-emitter-node-deps.sh
source ../../_lib/ensure-emitter-node-deps.sh
node ../../_lib/dogfood-rich-emit.mjs
