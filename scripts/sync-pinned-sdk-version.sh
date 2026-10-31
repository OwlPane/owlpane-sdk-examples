#!/usr/bin/env bash
# Set sdk-published.version (single pin). Docker/CI/apps read it or OWLPANE_SDK_VERSION / SDK_VERSION.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="${1:-}"
if [ -z "$V" ]; then
  V="$(tr -d ' \n\r' < "$ROOT/sdk-published.version")"
  echo "Current pin: ${V}"
  echo "Usage: $0 <semver>   # e.g. 0.1.10"
  exit 0
fi
printf '%s\n' "$V" > "$ROOT/sdk-published.version"
echo "Updated sdk-published.version → ${V}"
echo "Optional: export OWLPANE_SDK_VERSION=${V} in .env to override locally."
echo "CI passes SDK_VERSION build-arg from the same file (publish-sdk-example-images workflow)."
