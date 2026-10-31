#!/usr/bin/env bash
# Emit synthetic library metrics, wait, verify against live API catalog for one category or slug.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CATEGORY=""
SLUG=""
WAIT="${OWLPANE_SMOKE_WAIT_SEC:-30}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --category) CATEGORY="$2"; shift 2 ;;
    --slug) SLUG="$2"; shift 2 ;;
    --wait) WAIT="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 --category ArgoCD | --slug owl-argocd-argocd-monitoring [--wait 30]"
      exit 0
      ;;
    *) echo "Unknown arg $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$CATEGORY" && -z "$SLUG" ]]; then
  echo "Provide --category or --slug (see: cd ../../api && npm run report:library-coverage)" >&2
  exit 1
fi

if [[ -f "$ROOT/.dogfood-laptop-off" ]]; then
  echo "Remove $ROOT/.dogfood-laptop-off or use in-cluster emit." >&2
  exit 1
fi

if [[ -f "$ROOT/scripts/saas-ingest-port-forward.sh" ]]; then
  "$ROOT/scripts/saas-ingest-port-forward.sh" start 2>/dev/null || true
fi

EMIT_ARGS=()
[[ -n "$CATEGORY" ]] && EMIT_ARGS+=(--category "$CATEGORY")

echo "==> Starting emit in background…"
node scripts/emit-dashboard-library-metrics.mjs "${EMIT_ARGS[@]}" &
EMIT_PID=$!
trap 'kill $EMIT_PID 2>/dev/null || true' EXIT

echo "==> Waiting ${WAIT}s for ingest/catalog…"
sleep "$WAIT"

VERIFY_ARGS=()
[[ -n "$CATEGORY" ]] && VERIFY_ARGS+=(--category "$CATEGORY")
[[ -n "$SLUG" ]] && VERIFY_ARGS+=(--slug "$SLUG")

echo "==> Verifying metrics in tenant…"
node scripts/verify-library-metrics-local.mjs "${VERIFY_ARGS[@]}"

echo "==> Emit still running (pid $EMIT_PID). Ctrl+C to stop, or: kill $EMIT_PID"
