#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh browser

npm pkg set "dependencies.@owlpane/browser=${OWLPANE_SDK_VERSION}"
npm install --no-audit --no-fund
npm run start
