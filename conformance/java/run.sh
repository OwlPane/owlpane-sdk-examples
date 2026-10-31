#!/usr/bin/env bash
# Runs the sample against a throwaway local receiver. Never contacts a real Owlpane endpoint.
# Downloads (once, into ./lib, gitignored): the OpenTelemetry Java agent and the opentelemetry-api jar.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p lib out
[ -f lib/opentelemetry-javaagent.jar ] || curl -fsSL -o lib/opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
API_VER=1.49.0
[ -f lib/opentelemetry-api.jar ] || curl -fsSL -o lib/opentelemetry-api.jar \
  "https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-api/$API_VER/opentelemetry-api-$API_VER.jar"
[ -f lib/opentelemetry-context.jar ] || curl -fsSL -o lib/opentelemetry-context.jar \
  "https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-context/$API_VER/opentelemetry-context-$API_VER.jar"
CP=lib/opentelemetry-api.jar:lib/opentelemetry-context.jar
javac -cp "$CP" -d out App.java
PORTFILE=$(mktemp); rm -f "$PORTFILE"
node ../../_receiver/receiver.mjs --port-file "$PORTFILE" --service java-example --span hello-owlpane --timeout 90 & RPID=$!
trap 'kill $RPID 2>/dev/null || true' EXIT
until [ -s "$PORTFILE" ]; do sleep 0.2; done
export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:$(cat "$PORTFILE")"
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_HEADERS="${HEADERS_VALUE:-Authorization=Bearer%20owl_ing_test_local_key}"
export OTEL_SERVICE_NAME=java-example
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=production,service.version=1.0.0"
export OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none
java -javaagent:lib/opentelemetry-javaagent.jar -cp "out:$CP" App
wait $RPID
