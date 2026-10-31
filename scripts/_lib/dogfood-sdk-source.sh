#!/usr/bin/env bash
# Default to published npm/PyPI packages (this repo has no monorepo SDK checkout).
set -euo pipefail
if [ -n "${OWLPANE_SDK_SOURCE:-}" ]; then
  return 0 2>/dev/null || exit 0
fi
export OWLPANE_SDK_SOURCE=published
