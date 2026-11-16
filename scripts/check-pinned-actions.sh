#!/usr/bin/env bash
# Fails if a workflow step uses a third-party action by tag or branch: tags are movable, so a hijacked tag runs in CI with our secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
bad=$(grep -rnE '^\s*-?\s*uses:\s*[^ ]+' .github/workflows .github/actions 2>/dev/null \
  | grep -vE 'uses:\s*\./' \
  | grep -vE 'uses:\s*[^@ ]+@[0-9a-f]{40}(\s|$)' || true)
if [[ -n "$bad" ]]; then
  echo "Unpinned actions (pin to a full commit SHA, keep the tag in a trailing comment):" >&2
  echo "$bad" >&2
  exit 1
fi
echo "all actions pinned to commit SHAs"
