#!/usr/bin/env bash
# Stop laptop → k3s SaaS dogfood safely (no project deletes; stops OTLP only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="$ROOT/.dogfood-laptop-off"

"$ROOT/scripts/run-dogfood-loop-daemon.sh" stop 2>/dev/null || true
"$ROOT/scripts/saas-ingest-port-forward.sh" stop 2>/dev/null || true
pkill -f "port-forward svc/owlpane-ingest" 2>/dev/null || true

date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER"
echo "Created $MARKER — start-saas-dogfood.sh will refuse until you: rm $MARKER"
echo "Laptop dogfood stopped. Offboard console projects separately when ready."
