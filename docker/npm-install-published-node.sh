#!/usr/bin/env bash
# Install @owlpane/node from npm for Docker (not file: workspace links).
set -euo pipefail
SDK_VERSION="${1:?SDK_VERSION}"
APP_DIR="${2:?APP_DIR}"
cd "$APP_DIR"
rm -f package-lock.json
if [ -f package.json ]; then
  npm pkg delete dependencies.@owlpane/node 2>/dev/null || true
  npm pkg set "dependencies.@owlpane/node=${SDK_VERSION}"
fi
npm install --no-audit --no-fund
