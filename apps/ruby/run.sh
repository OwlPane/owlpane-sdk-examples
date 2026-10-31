#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# Bundler 4 + modern OTel gems need Ruby ≥ 3; prefer Homebrew Ruby over macOS system 2.6.
for rb in /opt/homebrew/opt/ruby/bin /usr/local/opt/ruby/bin; do
  if [ -x "$rb/ruby" ]; then
    export PATH="$rb:$PATH"
    break
  fi
done
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh ruby
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
bundle config set --local path vendor/bundle
bundle install --quiet
bundle exec ruby app.rb
node ../../_lib/dogfood-emit-log.mjs || true
