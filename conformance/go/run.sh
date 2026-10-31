#!/usr/bin/env bash
# Runs the sample against a throwaway local receiver. Never contacts a real Owlpane endpoint.
set -euo pipefail
cd "$(dirname "$0")"
PORTFILE=$(mktemp); rm -f "$PORTFILE"
node ../../_receiver/receiver.mjs --port-file "$PORTFILE" --service go-example --span hello-owlpane --timeout 60 & RPID=$!
trap 'kill $RPID 2>/dev/null || true' EXIT
until [ -s "$PORTFILE" ]; do sleep 0.2; done
export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:$(cat "$PORTFILE")"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS="${HEADERS_VALUE:-Authorization=Bearer%20owl_ing_test_local_key}"
export OTEL_SERVICE_NAME=go-example
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=production,service.version=1.0.0"
go run .
wait $RPID
