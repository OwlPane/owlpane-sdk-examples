#!/usr/bin/env bash
# Full local cloud monitoring + AWS dashboard dogfood (Floci, YACE, emit, verify gate).
#
#   cd owlpane/owlpane-sdk-examples
#   cp .env.example .env   # OWLPANE_INGEST_*, API login, OWLPANE_ENVIRONMENT=production
#   ./scripts/run-local-cloud-dogfood.sh
#
# Options:
#   SKIP_FLOCI=1       Skip Floci start (already running)
#   SKIP_K8S=1         Skip YACE install (emit-only lane)
#   SKIP_EMIT=1        Only verify (emitter already running)
#   EMIT_SECONDS=45    Wait before verify
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Load .env early so emit/verify match console (often development locally).
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
ENV="${OWLPANE_ENVIRONMENT:-development}"
EMIT_SECONDS="${EMIT_SECONDS:-60}"
export OWLPANE_ENVIRONMENT="$ENV"
export OWLPANE_VERIFY_ENV="$ENV"

log() { printf '\n== %s ==\n' "$*"; }

preflight() {
  log "Preflight"
  if [[ ! -f "$ROOT/.env" ]]; then
    echo "Create $ROOT/.env with OWLPANE_INGEST_URL, OWLPANE_INGEST_KEY_NODE, OWLPANE_ONBOARD_EMAIL/PASSWORD" >&2
    exit 1
  fi
  local api="${OWLPANE_API_URL:-http://127.0.0.1:4100}"
  local ingest="${OWLPANE_INGEST_URL:-}"
  if [[ ! "$api" =~ 127\.0\.0\.1|localhost ]]; then
    if [[ "$ingest" == "http://127.0.0.1:4318" ]] || [[ -z "$ingest" ]]; then
      export OWLPANE_INGEST_URL="http://127.0.0.1:14318"
      echo "Using crikiq ingest via port-forward: $OWLPANE_INGEST_URL" >&2
      "$ROOT/scripts/saas-ingest-port-forward.sh" start || {
        echo "Start port-forward manually: ./scripts/saas-ingest-port-forward.sh start" >&2
        exit 1
      }
    elif [[ "$ingest" =~ 127\.0\.0\.1|localhost ]] && [[ "$ingest" != "http://127.0.0.1:14318" ]]; then
      echo "WARN: OTLP ingest ($ingest) may not be the crikiq cell; verify reads $api." >&2
    fi
  fi
  if ! curl -sf "${api}/healthz" | grep -q '"ok":true'; then
    echo "Owlpane API not healthy at ${api}/healthz — start API + ingest (see docs/ops/local-dev-full-stack.md)" >&2
    exit 1
  fi
  command -v node >/dev/null || { echo "node required" >&2; exit 1; }
}

start_floci() {
  if [[ "${SKIP_FLOCI:-}" == "1" ]]; then return 0; fi
  log "Floci (AWS emulator — primary local cloud gate)"
  echo "Azure/GCP library proof: crikiq prod checklist, not Floci tri-cloud." >&2
  "$ROOT/scripts/floci-dashboard-harness.sh" start aws || {
    echo "Floci optional: set SKIP_FLOCI=1 to continue emit-only" >&2
    exit 1
  }
}

install_yace() {
  if [[ "${SKIP_K8S:-}" == "1" ]]; then
    log "Skipping K8s cloud scrapes (SKIP_K8S=1)"
    return 0
  fi
  if ! kubectl cluster-info >/dev/null 2>&1; then
    log "No kubectl cluster — skipping cloud K8s (use SKIP_K8S=1 explicitly). Emit lane still runs."
    return 0
  fi
  log "YACE + static Azure/GCP exporters (Docker Desktop K8s)"
  SKIP_FLOCI_START=1 "$ROOT/scripts/install-floci-cloud-k8s.sh" || echo "K8s cloud install failed; continuing with emit lane" >&2
  echo ""
  echo "If agent not merged yet, run:"
  echo "  helm upgrade --install owlpane oci://ghcr.io/owlpane/owlpane-agent -n owlpane -f $ROOT/../../agent/values-floci-dogfood.yaml -f YOUR_VALUES.yaml"
}

run_emit() {
  if [[ "${SKIP_EMIT:-}" == "1" ]]; then return 0; fi
  log "Emit cloud dogfood (${EMIT_SECONDS}s)"
  node "$ROOT/scripts/emit-cloud-dogfood.mjs" &
  EMIT_PID=$!
  node "$ROOT/scripts/emit-az-metrics-log-dogfood.mjs" &
  AZ_PID=$!
  trap 'kill $EMIT_PID $AZ_PID 2>/dev/null || true' EXIT
  sleep "$EMIT_SECONDS"
}

verify() {
  log "Verify gate"
  node "$ROOT/scripts/verify-cloud-infrastructure-local.mjs"
}

report_coverage() {
  log "Library emit coverage (AWS categories)"
  if [[ -d "$ROOT/../../api" ]]; then
    (cd "$ROOT/../../api" && npm run report:library-coverage 2>/dev/null | grep -iE 'AWS|aws_' || true)
  fi
}

preflight
start_floci
install_yace
run_emit
verify
report_coverage

log "Manual console pass"
cat <<EOF
  env filter: $ENV
  /observability/catalog/cloud-cost
  /observability/catalog/azure
  /observability/infrastructure/cloud/aws
  Dashboards → Library → install AWS SQS / Aurora / Valkey → open charts + About panels

Azure *logs_sql* panels: run emit-az-metrics-log-dogfood.mjs (included above) + install Azure library dashboards.
Production: same cloudScrapes YAML, real endpoints, staging account first.

Doc: owlpane/api/docs/ops/cloud-infrastructure-local-testing.md
EOF
