#!/usr/bin/env bash
# Local AWS / Azure / GCP emulators for infrastructure + library dashboard dogfood.
# https://floci.io/ — no real cloud credentials.
#
#   ./scripts/floci-dashboard-harness.sh start [aws|azure|gcp|all]
#   ./scripts/floci-dashboard-harness.sh stop [aws|azure|gcp|all]
#   ./scripts/floci-dashboard-harness.sh status
#   ./scripts/floci-dashboard-harness.sh env aws|azure|gcp   # print eval exports
#   ./scripts/floci-dashboard-harness.sh doctor
#
# Pair emulators with Prometheus exporters (YACE, azure_metrics_exporter, stackdriver_exporter)
# and owlpane-agent integrations.cloudScrapes — see owlpane/api/docs/ops/floci-infrastructure-dogfood.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="${TMPDIR:-/tmp}/owlpane-floci"
mkdir -p "$STATE_DIR"

need_floci() {
  if ! command -v floci >/dev/null 2>&1; then
    echo "Install Floci CLI: curl -fsSL https://floci.io/install.sh | sh" >&2
    echo "Docs: https://floci.io/" >&2
    exit 1
  fi
}

clouds_from_arg() {
  case "${1:-all}" in
    aws) echo aws ;;
    azure | az) echo azure ;;
    gcp) echo gcp ;;
    all) echo aws azure gcp ;;
    *)
      echo "Unknown cloud: $1 (use aws, azure, gcp, or all)" >&2
      exit 1
      ;;
  esac
}

start_one() {
  local c=$1
  case "$c" in
    aws)
      floci start
      echo aws >"$STATE_DIR/aws.on"
      ;;
    azure)
      floci az start
      echo azure >"$STATE_DIR/azure.on"
      ;;
    gcp)
      floci gcp start
      echo gcp >"$STATE_DIR/gcp.on"
      ;;
  esac
}

stop_one() {
  local c=$1
  case "$c" in
    aws)
      floci stop 2>/dev/null || true
      rm -f "$STATE_DIR/aws.on"
      ;;
    azure)
      floci az stop 2>/dev/null || true
      rm -f "$STATE_DIR/azure.on"
      ;;
    gcp)
      floci gcp stop 2>/dev/null || true
      rm -f "$STATE_DIR/gcp.on"
      ;;
  esac
}

print_env() {
  local c=$1
  case "$c" in
    aws)
      cat <<'EOF'
# AWS emulator (Floci :4566)
eval "$(floci env)"
export AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
# Point YACE / aws-exporter at this endpoint; then agent integrations.cloudScrapes → exporter:port
EOF
      ;;
    azure)
      cat <<'EOF'
# Azure emulator (Floci :4577)
eval "$(floci az env)"
# Point azure_metrics_exporter at the emulator; agent cloudScrapes with provider: azure
EOF
      ;;
    gcp)
      cat <<'EOF'
# GCP emulator (Floci :4588)
eval "$(floci gcp env)"
export CLOUDSDK_CORE_PROJECT="${CLOUDSDK_CORE_PROJECT:-floci-local}"
export CLOUDSDK_AUTH_ACCESS_TOKEN="${CLOUDSDK_AUTH_ACCESS_TOKEN:-floci}"
export CLOUDSDK_API_ENDPOINT_OVERRIDES_PUBSUB="${CLOUDSDK_API_ENDPOINT_OVERRIDES_PUBSUB:-http://localhost:4588/}"
# Stackdriver / GCP exporter → agent integrations.cloudScrapes with provider: gcp
EOF
      ;;
  esac
}

cmd_start() {
  need_floci
  if ! docker info >/dev/null 2>&1 && ! podman info >/dev/null 2>&1; then
    echo "Docker or Podman must be running for Floci." >&2
    exit 1
  fi
  for c in $(clouds_from_arg "${1:-all}"); do
    echo "Starting Floci $c…"
    start_one "$c"
    echo ""
    print_env "$c"
    echo ""
  done
  cat <<EOF

Next (Owlpane):
  1. Seed UI smoke (optional, no Floci): cd $ROOT && node scripts/emit-infrastructure-smoke.mjs
  2. Library AWS charts: node scripts/emit-dashboard-library-metrics.mjs --category AWS
  3. Docker Desktop K8s + cloud scrapes: ./scripts/install-floci-cloud-k8s.sh then agent values-floci-dogfood.yaml
  4. Console: env=production, widen time range, Infrastructure → Cloud / Catalog → Cloud cost

Runbook: owlpane/api/docs/ops/floci-infrastructure-dogfood.md
EOF
}

cmd_stop() {
  need_floci
  for c in $(clouds_from_arg "${1:-all}"); do
    echo "Stopping Floci $c…"
    stop_one "$c"
  done
  echo stopped
}

cmd_status() {
  echo "Floci state (Owlpane marker files in $STATE_DIR):"
  for c in aws azure gcp; do
    if [[ -f "$STATE_DIR/$c.on" ]]; then
      echo "  $c: started (marker present)"
    else
      echo "  $c: —"
    fi
  done
  if command -v floci >/dev/null 2>&1; then
    floci doctor 2>/dev/null || true
  fi
}

cmd_env() {
  local c="${1:-aws}"
  case "$c" in
    aws | azure | az | gcp) print_env "${c/az/azure}" ;;
    *)
      echo "Usage: $0 env aws|azure|gcp" >&2
      exit 1
      ;;
  esac
}

case "${1:-}" in
  start) cmd_start "${2:-all}" ;;
  stop) cmd_stop "${2:-all}" ;;
  status) cmd_status ;;
  env) cmd_env "${2:-}" ;;
  doctor)
    need_floci
    floci doctor
    ;;
  *)
    echo "Usage: $0 start|stop [aws|azure|gcp|all] | status | env aws|azure|gcp | doctor" >&2
    exit 1
    ;;
esac
