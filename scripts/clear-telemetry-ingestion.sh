#!/usr/bin/env bash
# Drop all OTLP telemetry rows (local Docker CH + optional remote cell CH). Keeps orgs/projects/keys.
#
#   ./scripts/clear-telemetry-ingestion.sh           # local stumpcam-telemetry lake-1 only
#   ./scripts/clear-telemetry-ingestion.sh --remote  # + crikiq stumpcam-telemetry lake-0
#   ./scripts/clear-telemetry-ingestion.sh --usage   # also TRUNCATE usage_daily on local owlpane-db
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE=false
USAGE=false
for arg in "$@"; do
  case "$arg" in
    --remote) REMOTE=true ;;
    --usage) USAGE=true ;;
    -h|--help)
      echo "Usage: $0 [--remote] [--usage]"
      exit 0
      ;;
    *) echo "Unknown: $arg" >&2; exit 1 ;;
  esac
done

CH_TABLES=(
  otel_traces
  otel_logs
  otel_metrics_gauge
  otel_metrics_sum
  otel_metrics_histogram
  otel_metrics_exponential_histogram
  otel_metrics_summary
  otel_traces_trace_id_ts
  otel_profiles
  e2e_spans
  rollup_requests_1m
  rollup_error_logs_1m
  otel_carbon_node_buckets
)

ch_truncate_docker() {
  local container="$1"
  echo "== telemetry lake ($container) =="
  for t in "${CH_TABLES[@]}"; do
    docker exec "$container" lake-sql-client -q "TRUNCATE TABLE IF EXISTS stumpcam.${t}" 2>/dev/null || true
  done
  docker exec "$container" lake-sql-client -q "
    SELECT 'after' AS phase, formatReadableSize(sum(bytes)) AS otel_bytes
    FROM system.parts WHERE active AND database='stumpcam' AND table LIKE 'otel%'
  "
}

ch_truncate_kubectl() {
  local ctx="${KUBE_CTX:-crikiq-hetzner}"
  local ns="${OWLPANE_NAMESPACE:-owlpane-platform}"
  local pod="${OWLPANE_CH_POD:-stumpcam-telemetry lake-0}"
  echo "== telemetry lake (remote $ctx/$ns/$pod) =="
  local sql=""
  for t in "${CH_TABLES[@]}"; do
    sql+="TRUNCATE TABLE IF EXISTS stumpcam.${t}; "
  done
  kubectl --context "$ctx" -n "$ns" exec "$pod" -- lake-sql-client -q "$sql"
  kubectl --context "$ctx" -n "$ns" exec "$pod" -- lake-sql-client -q "
    SELECT formatReadableSize(sum(bytes)) FROM system.parts WHERE active AND database='stumpcam' AND table LIKE 'otel%'
  "
}

LOCAL_CH="${OWLPANE_LOCAL_CH_CONTAINER:-stumpcam-telemetry lake-1}"
if docker ps --format '{{.Names}}' | grep -qx "$LOCAL_CH"; then
  ch_truncate_docker "$LOCAL_CH"
else
  echo "skip local CH (no container $LOCAL_CH)" >&2
fi

if [[ "$REMOTE" == true ]]; then
  ch_truncate_kubectl
fi

if [[ "$USAGE" == true ]]; then
  STUMP_ENV="${STUMPCAM_DEPLOY_ENV:-$ROOT/../../../stumpcam/deploy/.env}"
  if [[ -f "$STUMP_ENV" ]]; then
    # shellcheck disable=SC1090
    set -a && source "$STUMP_ENV" && set +a
    DB_CONTAINER="${OWLPANE_LOCAL_PG_CONTAINER:-stumpcam-owlpane-db-1}"
    if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
      echo "== Postgres usage_daily ($DB_CONTAINER) =="
      docker exec -e PGPASSWORD="${OWLPANE_DB_PASSWORD:?set in stumpcam/deploy/.env}" "$DB_CONTAINER" \
        psql -U owlpane -d owlpane -v ON_ERROR_STOP=1 -c "TRUNCATE usage_daily;"
    fi
  else
    echo "skip usage_daily (no $STUMP_ENV)" >&2
  fi
fi

echo "Done. Re-run dogfood when ready; console charts will repopulate as new data arrives."
