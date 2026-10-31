#!/usr/bin/env bash
# Floci dogfood in Docker Desktop K8s: YACE (AWS) + static Prometheus textfile exporters (Azure/GCP smoke).
#
#   cd owlpane/owlpane-sdk-examples
#   ./scripts/floci-dashboard-harness.sh start aws
#   ./scripts/install-floci-cloud-k8s.sh
#   helm upgrade --install owlpane oci://ghcr.io/owlpane/owlpane-agent -n owlpane \
#     -f ../../agent/values-floci-dogfood.yaml -f your-existing-values.yaml
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
K8S_DIR="$ROOT/k8s/floci"
AGENT_NS="${OWLPANE_AGENT_NAMESPACE:-owlpane}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing: $1" >&2
    exit 1
  }
}

need kubectl
need floci

if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "kubectl cannot reach a cluster (enable Kubernetes in Docker Desktop)." >&2
  exit 1
fi

if [[ "${SKIP_FLOCI_START:-}" != "1" ]]; then
  "$ROOT/scripts/floci-dashboard-harness.sh" start aws
fi

"$ROOT/scripts/seed-floci-aws-resources.sh"

echo "Applying Floci cloud scrape manifests (YACE + static Azure/GCP)…"
kubectl apply -f "$K8S_DIR/namespace.yaml"
kubectl apply -k "$K8S_DIR"

echo "Waiting for YACE…"
kubectl -n owlpane-floci rollout status deployment/yace --timeout=120s
echo "Waiting for static Prometheus exporters…"
kubectl -n owlpane-floci rollout status deployment/static-prom-azure --timeout=120s
kubectl -n owlpane-floci rollout status deployment/static-prom-gcp --timeout=120s

echo ""
echo "Optional port-forwards:"
echo "  kubectl -n owlpane-floci port-forward svc/yace 5000:5000"
echo "  kubectl -n owlpane-floci port-forward svc/static-prom-azure 9101:8080"
echo "  kubectl -n owlpane-floci port-forward svc/static-prom-gcp 9102:8080"
echo ""

cat <<EOF
--- Agent overlay: agent/values-floci-dogfood.yaml (cloudScrapes for all three) ---

helm upgrade --install owlpane oci://ghcr.io/owlpane/owlpane-agent -n $AGENT_NS \\
  -f $ROOT/../../agent/values-floci-dogfood.yaml \\
  -f YOUR_VALUES.yaml

Emit lane (metrics + az_metrics logs):
  node scripts/emit-cloud-dogfood.mjs &
  node scripts/emit-az-metrics-log-dogfood.mjs &
  node scripts/verify-cloud-infrastructure-local.mjs

Teardown: kubectl delete -k $K8S_DIR && kubectl delete -f $K8S_DIR/namespace.yaml
EOF
