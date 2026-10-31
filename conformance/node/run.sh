#!/usr/bin/env bash
# Posts one OTLP/JSON trace to the local conformance receiver.
set -euo pipefail
cd "$(dirname "$0")"
PORTFILE=$(mktemp); rm -f "$PORTFILE"
node ../../_receiver/receiver.mjs --port-file "$PORTFILE" --service node-example --span hello-owlpane --timeout 20 &
RPID=$!
trap 'kill $RPID 2>/dev/null || true' EXIT
until [ -s "$PORTFILE" ]; do sleep 0.2; done
PORT=$(cat "$PORTFILE")
curl -sf -X POST "http://127.0.0.1:${PORT}/v1/traces" \
  -H "Authorization: Bearer owl_ing_test_local_key" \
  -H "content-type: application/json" \
  -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"node-example"}},{"key":"deployment.environment.name","value":{"stringValue":"production"}},{"key":"service.version","value":{"stringValue":"1.0.0"}}]},"scopeSpans":[{"spans":[{"name":"hello-owlpane"}]}]}]}' >/dev/null
wait $RPID
