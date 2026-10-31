#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh python
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
[ -d .venv ] || python3 -m venv .venv
REQ=requirements.txt
if [ "${OWLPANE_SDK_SOURCE:-}" = "published" ]; then
  REQ=requirements-published.txt
fi
if [ "${OWLPANE_SDK_SOURCE:-}" != "published" ] || ! .venv/bin/python -c "import owlpane" 2>/dev/null; then
  .venv/bin/pip install -q -r "$REQ"
fi
.venv/bin/python app.py
node ../../_lib/dogfood-emit-log.mjs || true
