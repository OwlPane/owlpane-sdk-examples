#!/usr/bin/env bash
# Propagate sdk-published.version to Docker args, package.json, and dogfood service.version fields.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$(tr -d ' \n\r' < "$ROOT/sdk-published.version")"
export V

echo "Pinning examples to SDK ${V}"

perl -pi -e 's/ARG SDK_VERSION=\K[0-9.]+/($ENV{V})/ge' "$ROOT"/docker/apps/*.Dockerfile "$ROOT"/docker/Dockerfile.demo-server 2>/dev/null || true
perl -pi -e 's/@owlpane\/node": "\K[0-9.]+/$ENV{V}/g' "$ROOT"/apps/node/package.json "$ROOT"/apps/demo-server/package.json "$ROOT"/pii-canary/package.json
perl -pi -e 's/@owlpane\/browser": "\K[0-9.]+/$ENV{V}/g' "$ROOT"/apps/browser/package.json
perl -pi -e 's/^owlpane==\K[0-9.]+/$ENV{V}/' "$ROOT"/apps/python/requirements-published.txt
perl -pi -e 's/github.com\/OwlPane\/owlpane-sdk\/packages\/go v\K[0-9.]+/$ENV{V}/' "$ROOT"/apps/go/go.mod
perl -pi -e 's/release: "\K[0-9.]+/$ENV{V}/g' "$ROOT"/apps/node/src/main.ts "$ROOT"/apps/browser/src/main.ts "$ROOT"/apps/demo-server/src/server.ts "$ROOT"/_lib/dogfood-rich-emit.mjs
perl -pi -e 's/service\.version=\K[0-9.]+/$ENV{V}/' "$ROOT"/_lib/dogfood-env.sh
perl -pi -e 's/"service\.version" => "\K[0-9.]+/$ENV{V}/' "$ROOT"/apps/ruby/app.rb
perl -pi -e 's/@owlpane\/node@\^\K[0-9.]+/$ENV{V}/' "$ROOT"/docker/Dockerfile.demo-server

echo "Done. Review: git diff"
