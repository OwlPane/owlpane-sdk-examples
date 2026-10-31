#!/usr/bin/env bash
# Single pin: sdk-published.version (override with OWLPANE_SDK_VERSION in .env or CI).
set -euo pipefail

sdk_examples_root() {
  local here="${1:-${BASH_SOURCE[1]:-${BASH_SOURCE[0]}}}"
  cd "$(dirname "$here")/.." && pwd
}

read_sdk_published_version() {
  if [ -n "${OWLPANE_SDK_VERSION:-}" ]; then
    printf '%s' "${OWLPANE_SDK_VERSION}"
    return 0
  fi
  local root file
  root="$(sdk_examples_root "${1:-}")"
  file="${root}/sdk-published.version"
  if [ ! -f "$file" ]; then
    echo "sdk-version: missing $file (or set OWLPANE_SDK_VERSION)" >&2
    return 1
  fi
  tr -d ' \n\r' < "$file"
}

# Docker / CI may pass SDK_VERSION; else read pin file.
resolve_sdk_version() {
  if [ -n "${SDK_VERSION:-}" ]; then
    printf '%s' "${SDK_VERSION}"
    return 0
  fi
  read_sdk_published_version "${1:-}"
}
