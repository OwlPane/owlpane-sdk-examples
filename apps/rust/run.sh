#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh rust
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
# shellcheck source=../../_lib/ensure-emitter-node-deps.sh
source ../../_lib/ensure-emitter-node-deps.sh
node ../../_lib/dogfood-rich-emit.mjs
