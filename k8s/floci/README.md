# Floci cloud scrapes on Docker Desktop Kubernetes

- **AWS:** [YACE](https://github.com/prometheus-community/yet-another-cloudwatch-exporter) → Floci (`host.docker.internal:4566`).
- **Azure / GCP (smoke):** node-exporter textfile collectors serving static `.prom` metrics for agent `cloudScrapes`.

All targets are scraped by **owlpane-agent** `integrations.cloudScrapes` (see `agent/values-floci-dogfood.yaml`).

## Quick install

```bash
cd owlpane/owlpane-sdk-examples
./scripts/floci-dashboard-harness.sh start aws
./scripts/install-floci-cloud-k8s.sh
```

Merge `owlpane/agent/values-floci-dogfood.yaml` into your agent Helm upgrade (see script output).

## Endpoint override

If YACE cannot reach Floci, patch the endpoint ConfigMap:

```bash
# Linux Docker Desktop — usually still host.docker.internal
kubectl -n owlpane-floci edit configmap yace-env
# Or map host gateway:
# aws_endpoint_url: "http://172.17.0.1:4566"
kubectl -n owlpane-floci rollout restart deployment/yace
```

## Verify

```bash
kubectl -n owlpane-floci port-forward svc/yace 5000:5000
curl -s localhost:5000/metrics | grep -i aws_ | head
```

## Teardown

```bash
kubectl delete -k owlpane/owlpane-sdk-examples/k8s/floci
kubectl delete -f owlpane/owlpane-sdk-examples/k8s/floci/namespace.yaml
```
