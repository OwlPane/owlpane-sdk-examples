#!/usr/bin/env bash
# Load shared ingest settings + per-app onboarding (project key + service.name).
# Usage: source "$(dirname "$0")/dogfood-env.sh" <app-id>   # node | go | python | java | ruby | browser | demo-server | pii-canary
set -euo pipefail

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-${0}}")" && pwd)"
_EXAMPLES_ROOT="$(cd "${_LIB_DIR}/.." && pwd)"
if [ -f "$_EXAMPLES_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$_EXAMPLES_ROOT/.env"
  set +a
fi

APP_ID="${1:-}"
if [ -z "$APP_ID" ]; then
  echo "dogfood-env.sh: missing app id (node, go, python, java, ruby)" >&2
  return 1 2>/dev/null || exit 1
fi

MANIFEST="$_EXAMPLES_ROOT/dogfood.manifest.json"

# In-cluster: Helm injects OWLPANE_INGEST_KEY + OTEL_SERVICE_NAME (no Node/Python needed).
K8S_READY=false
if [ -n "${OWLPANE_INGEST_KEY:-}" ] && [ -n "${OTEL_SERVICE_NAME:-}" ]; then
  ENDPOINT="${OWLPANE_INGEST_URL:-${OWLPANE_ENDPOINT:-}}"
  if [ -n "$ENDPOINT" ]; then
    PROJECT="${OTEL_SERVICE_NAME}"
    KEY="${OWLPANE_INGEST_KEY}"
    K8S_READY=true
  fi
fi

manifest_app_field() {
  local app_id="$1" field="$2"
  if command -v node >/dev/null 2>&1; then
    node -e "
const fs = require('fs');
const apps = JSON.parse(fs.readFileSync('${MANIFEST}', 'utf8')).apps;
const app = apps.find((a) => a.id === '${app_id}');
if (!app) { process.exit(1); }
process.stdout.write(String(app['${field}'] ?? ''));
"
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$app_id" "$field" "$MANIFEST" <<'PY'
import json, sys
app_id, field, path = sys.argv[1], sys.argv[2], sys.argv[3]
apps = json.load(open(path, encoding="utf-8"))["apps"]
app = next(a for a in apps if a["id"] == app_id)
print(app[field])
PY
    return $?
  fi
  echo "dogfood-env.sh: need node or python3 to read ${MANIFEST}" >&2
  return 1
}

if [ "$K8S_READY" != true ]; then
  if [ ! -f "$MANIFEST" ]; then
    echo "Missing $MANIFEST" >&2
    return 1 2>/dev/null || exit 1
  fi
  PROJECT="$(manifest_app_field "$APP_ID" project)" || PROJECT=""
  KEY_ENV="$(manifest_app_field "$APP_ID" ingestKeyEnv)" || KEY_ENV=""

  ENDPOINT="${OWLPANE_INGEST_URL:-${OWLPANE_ENDPOINT:-}}"
  if [ -z "$ENDPOINT" ]; then
    echo "Set OWLPANE_INGEST_URL in examples/.env" >&2
    return 1 2>/dev/null || exit 1
  fi

  KEY="${OWLPANE_INGEST_KEY:-}"
  if [ -z "$KEY" ] && [ -n "$KEY_ENV" ]; then
    KEY="${!KEY_ENV:-}"
  fi
fi
KEY_ENV="${KEY_ENV:-}"
if [ -z "$KEY" ]; then
  echo "Missing ${KEY_ENV}. Run: ./scripts/onboard-dogfood.sh --write-env" >&2
  return 1 2>/dev/null || exit 1
fi
API_ENV="${_EXAMPLES_ROOT}/../../api/apps/api/.env"
if ! [[ "$KEY" =~ ^owl_ing_[a-f0-9]{48}$ ]] && [ -f "$API_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$API_ENV"
  set +a
  KEY="${!KEY_ENV:-}"
  if [ -z "$KEY" ]; then
    KEY="${OWLPANE_INGEST_KEY:-}"
  fi
  if [ -n "$KEY" ]; then
    echo "Using ingest key from ${API_ENV} for ${PROJECT}" >&2
  fi
fi
if ! [[ "${KEY}" =~ ^owl_ing_[a-f0-9]{48}$ ]]; then
  echo "Invalid ingest key for ${PROJECT} (need owl_ing_ + 48 hex from console)." >&2
  return 1 2>/dev/null || exit 1
fi

export OWLPANE_INGEST_URL="${ENDPOINT%/}"
export OWLPANE_INGEST_KEY="$KEY"
export OWLPANE_ENVIRONMENT="${OWLPANE_ENVIRONMENT:-development}"
export OTEL_SERVICE_NAME="${PROJECT:-${OTEL_SERVICE_NAME:-}}"
export OTEL_EXPORTER_OTLP_ENDPOINT="$OWLPANE_INGEST_URL"
export OTEL_EXPORTER_OTLP_PROTOCOL="${OTEL_EXPORTER_OTLP_PROTOCOL:-http/protobuf}"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer%20${OWLPANE_INGEST_KEY}"

# One-shot dogfood CLIs: export spans/metrics quickly (default BSP delay is 5s).
export OWLPANE_DOGFOOD_ONE_SHOT="${OWLPANE_DOGFOOD_ONE_SHOT:-1}"
export OTEL_BSP_SCHEDULE_DELAY="${OTEL_BSP_SCHEDULE_DELAY:-500}"
export OTEL_BSP_EXPORT_TIMEOUT="${OTEL_BSP_EXPORT_TIMEOUT:-30000}"
export OTEL_METRICS_EXPORTER="${OTEL_METRICS_EXPORTER:-otlp}"
export OTEL_TRACES_EXPORTER="${OTEL_TRACES_EXPORTER:-otlp}"
export OTEL_LOGS_EXPORTER="${OTEL_LOGS_EXPORTER:-otlp}"

# Runtime boards: Server span + language tag (merge with SDK resource).
case "$APP_ID" in
  go) LANG_ATTR="telemetry.sdk.language=go" ;;
  python) LANG_ATTR="telemetry.sdk.language=python" ;;
  java) LANG_ATTR="telemetry.sdk.language=java" ;;
  ruby) LANG_ATTR="telemetry.sdk.language=ruby" ;;
  rust) LANG_ATTR="telemetry.sdk.language=rust,process.runtime.name=rust" ;;
  php) LANG_ATTR="telemetry.sdk.language=php,process.runtime.name=laravel" ;;
  dotnet) LANG_ATTR="telemetry.sdk.language=dotnet,process.runtime.name=coreclr" ;;
  node) LANG_ATTR="telemetry.sdk.language=nodejs" ;;
  browser) LANG_ATTR="telemetry.sdk.language=webjs,owlpane.rum=true" ;;
  demo-server|pii-canary) LANG_ATTR="telemetry.sdk.language=nodejs" ;;
  react-native) LANG_ATTR="telemetry.sdk.language=react-native,process.runtime.name=react-native,os.type=ios,os.name=iOS" ;;
  serverless) LANG_ATTR="telemetry.sdk.language=nodejs,cloud.provider=aws,cloud.platform=aws_lambda" ;;
  *) LANG_ATTR="" ;;
esac
BASE_ATTRS="deployment.environment.name=${OWLPANE_ENVIRONMENT},service.version=0.1.8"
if [ -n "$LANG_ATTR" ]; then
  export OTEL_RESOURCE_ATTRIBUTES="${BASE_ATTRS},${LANG_ATTR}"
else
  export OTEL_RESOURCE_ATTRIBUTES="${BASE_ATTRS}"
fi

export OWLPANE_DOGFOOD_APP_ID="$APP_ID"
export OWLPANE_DOGFOOD_PROJECT="$PROJECT"
