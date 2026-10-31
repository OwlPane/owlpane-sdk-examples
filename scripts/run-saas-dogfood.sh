#!/usr/bin/env bash
# Onboard Scale (or your org), emit one rich telemetry burst, print SaaS + Kubernetes verification steps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
chmod +x "$ROOT/scripts/run-saas-dogfood.sh" "$ROOT/run-dogfood.sh" "$ROOT/scripts/onboard-dogfood.sh" 2>/dev/null || true

if [ ! -f "$ROOT/.env" ]; then
  echo "Copy .env.saas.example → .env, set OWLPANE_ONBOARD_PASSWORD and OWLPANE_INGEST_URL, then re-run." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a

need=()
[ -z "${OWLPANE_ONBOARD_PASSWORD:-}" ] && need+=("OWLPANE_ONBOARD_PASSWORD")
[ -z "${OWLPANE_INGEST_URL:-}" ] && need+=("OWLPANE_INGEST_URL")
[ -z "${OWLPANE_API_URL:-}" ] && need+=("OWLPANE_API_URL")
if [ "${#need[@]}" -gt 0 ]; then
  echo "Missing in examples/.env: ${need[*]}" >&2
  exit 1
fi

case "${OWLPANE_API_URL:-}" in
  http://localhost:*|http://127.0.0.1:*)
    if [ "${OWLPANE_DOGFOOD_ALLOW_LOCALHOST:-}" != "1" ]; then
      echo "OWLPANE_API_URL points at localhost. Use .env.local + local API for dev, or copy .env.saas.example for SaaS." >&2
      echo "To override: OWLPANE_DOGFOOD_ALLOW_LOCALHOST=1 $0" >&2
      exit 1
    fi
    ;;
esac

echo "==> Onboard projects (SDK + demo-server + pii-canary) via ${OWLPANE_API_URL}"
"$ROOT/scripts/onboard-dogfood.sh" --write-env

echo "==> One-shot rich telemetry (all SDK runtimes + browser RUM)"
"$ROOT/run-dogfood.sh"

MODE="${1:-}"
if [ "$MODE" = "--loop-demo" ]; then
  echo "==> Continuous load (demo-server) — Ctrl+C to stop"
  exec "$ROOT/apps/demo-server/run.sh"
fi

CONSOLE="${OWLPANE_CONSOLE_URL:-https://app.owlpane.com}"
ENV="${OWLPANE_ENVIRONMENT:-production}"

cat <<EOF

==> Application plane (console)
  ${CONSOLE}/observability/applications  — filter env: ${ENV}
  ${CONSOLE}/observability/requests      — owlpane-sdk-node, GET /demo, POST /checkout
  ${CONSOLE}/observability/logs            — customer.tier facet (L3/L17)
  ${CONSOLE}/observability/explorer        — owlpane.dogfood.requests

Optional:
  ./pii-canary/run.sh                      — PII scrub verification (service pii-canary)
  ./scripts/run-saas-dogfood.sh --loop-demo  — steady charts via owlpane-demo-server

==> Kubernetes + infrastructure (not from SDK examples)
  Agent on your cluster → same ingest keys / Setup → Kubernetes in console.
  Checklist: owlpane/api/docs/ops/kubernetes-e2e.md
  Infra alerts (crash-loop, node pressure): Infrastructure → alert templates (metrics from agent).

EOF
