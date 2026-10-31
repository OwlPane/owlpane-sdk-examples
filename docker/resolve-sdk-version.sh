#!/usr/bin/env bash
# Docker: SDK_VERSION build-arg (CI) or /sdk-published.version (local docker build).
set -euo pipefail
if [ -n "${SDK_VERSION:-}" ]; then
  printf '%s' "${SDK_VERSION}"
else
  for f in /sdk-published.version /app/sdk-published.version ./sdk-published.version; do
    if [ -f "$f" ]; then
      tr -d ' \n\r' < "$f"
      exit 0
    fi
  done
  echo "resolve-sdk-version: missing sdk-published.version (or set SDK_VERSION)" >&2
  exit 1
fi
