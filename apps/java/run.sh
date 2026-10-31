#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# macOS /usr/bin/java is a stub until a JDK is installed; prefer Homebrew OpenJDK.
if ! java -version >/dev/null 2>&1; then
  for jhome in /opt/homebrew/opt/openjdk@21 /opt/homebrew/opt/openjdk@17 /usr/local/opt/openjdk@21; do
    if [ -x "$jhome/bin/java" ]; then
      export JAVA_HOME="$jhome"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
fi
if ! java -version >/dev/null 2>&1; then
  echo "Java runtime not found. Install: brew install openjdk@21" >&2
  exit 1
fi
# shellcheck source=../../_lib/dogfood-env.sh
source ../../_lib/dogfood-env.sh java
export OWLPANE_DOGFOOD_MODE="${OWLPANE_DOGFOOD_MODE:-rich}"
mkdir -p lib out
OTEL_JAVAAGENT_VERSION="${OTEL_JAVAAGENT_VERSION:-2.14.0}"
[ -f lib/opentelemetry-javaagent.jar ] || curl -fsSL -o lib/opentelemetry-javaagent.jar \
  "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_JAVAAGENT_VERSION}/opentelemetry-javaagent.jar"
API_VER=1.49.0
[ -f lib/opentelemetry-api.jar ] || curl -fsSL -o lib/opentelemetry-api.jar \
  "https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-api/$API_VER/opentelemetry-api-$API_VER.jar"
[ -f lib/opentelemetry-context.jar ] || curl -fsSL -o lib/opentelemetry-context.jar \
  "https://repo1.maven.org/maven2/io/opentelemetry/opentelemetry-context/$API_VER/opentelemetry-context-$API_VER.jar"
CP=lib/opentelemetry-api.jar:lib/opentelemetry-context.jar
javac -cp "$CP" -d out App.java
export OTEL_METRICS_EXPORTER=otlp OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_METRICS_PROTOCOL="${OTEL_EXPORTER_OTLP_PROTOCOL:-http/protobuf}"
export OTEL_INSTRUMENTATION_RUNTIME_TELEMETRY_ENABLED="${OTEL_INSTRUMENTATION_RUNTIME_TELEMETRY_ENABLED:-true}"
export OTEL_METRIC_EXPORT_INTERVAL="${OTEL_METRIC_EXPORT_INTERVAL:-5000}"
export OWLPANE_JAVA_DOGFOOD_SLEEP_SEC="${OWLPANE_JAVA_DOGFOOD_SLEEP_SEC:-12}"
java -javaagent:lib/opentelemetry-javaagent.jar -cp "out:$CP" App
node ../../_lib/dogfood-emit-log.mjs || true
echo "span emitted (${OTEL_SERVICE_NAME})"
