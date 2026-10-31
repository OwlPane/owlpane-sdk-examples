#!/usr/bin/env bash
# Emitter apps (rust/php/…) use ../apps/node for dogfood-rich-emit.mjs.
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-${0}}")" && pwd)"
_EXAMPLES_ROOT="$(cd "${_LIB_DIR}/.." && pwd)"
# shellcheck source=dogfood-sdk-source.sh
source "$_LIB_DIR/dogfood-sdk-source.sh"

_EMITTER_NODE="$_EXAMPLES_ROOT/apps/node"
_LOCAL_PKG="${OWLPANE_SDK_LOCAL_PKG:-}"

install_local_node_sdk() {
  if [ -z "$_LOCAL_PKG" ] || [ ! -f "$_LOCAL_PKG/package.json" ]; then
    return 1
  fi
  if [ ! -f "$_LOCAL_PKG/dist/index.js" ]; then
    echo "[ensure-emitter] building @owlpane/node from workspace…" >&2
    (cd "$_LOCAL_PKG" && npm run build --silent)
  fi
  (cd "$_EMITTER_NODE" && npm install "$_LOCAL_PKG" --no-audit --no-fund --silent)
}

if [ "${OWLPANE_SDK_SOURCE}" = "local" ]; then
  install_local_node_sdk || true
  return 0 2>/dev/null || exit 0
fi

if [ "${OWLPANE_SDK_SOURCE}" = "published" ] && [ -f "$_EMITTER_NODE/node_modules/@owlpane/node/package.json" ]; then
  return 0 2>/dev/null || exit 0
fi

(cd "$_EMITTER_NODE" && npm install --no-audit --no-fund --silent)
