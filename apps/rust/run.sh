#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh rust
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
if [ -x ./target/release/owlpane-dogfood-rust ]; then
  exec ./target/release/owlpane-dogfood-rust
fi
exec cargo run --quiet --release --locked
