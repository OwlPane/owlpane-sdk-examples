#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh go
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
export OWLPANE_RUNTIME_METRICS="${OWLPANE_RUNTIME_METRICS:-1}"
export OWLPANE_DOGFOOD_METRICS_SLEEP_SEC="${OWLPANE_DOGFOOD_METRICS_SLEEP_SEC:-8}"
if [ "${OWLPANE_SDK_SOURCE:-published}" = "published" ]; then
  go mod edit -require="github.com/OwlPane/owlpane-sdk/packages/go@v${OWLPANE_SDK_VERSION}"
fi
go mod tidy
go run .
node ../../_lib/dogfood-emit-log.mjs || true
