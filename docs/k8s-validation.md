# SDK examples — k8s validation & security notes

Run before enabling `owlpane-sdk-examples`:

```bash
./scripts/validate-k8s-config.sh
```

## Feature coverage (rich dogfood)

| App | SDK / path | Traces | Metrics | Logs | Notes |
|-----|------------|--------|---------|------|--------|
| node | `@owlpane/node` | rich multi-span + error | counters/histogram | OTel logs | reference |
| go | `owlpane` Go SDK | rich | runtime | — | env via OTEL |
| python | PyPI `owlpane` | rich | — | — | |
| java | OTel javaagent + App | rich | JVM runtime | — | agent pinned `v2.14.0` |
| ruby | OTLP + app | rich | `metrics.rb` | — | |
| rust | OTel Rust + OTLP HTTP | one server span | one counter | one heartbeat log | repeated by the entrypoint interval |
| php/dotnet/rn/serverless | `@owlpane/node` emitter | rich + language attrs | — | — | |
| demo-server | `@owlpane/node` continuous | traces/metrics/logs | HTTP :4399 | |
| browser | `@owlpane/browser` | RUM | — | — | enable flag is on the external chart |
| pii-canary | `@owlpane/node` | + synthetic PII-shaped logs | — | read-path comparison | env **`piiCanaryEnvironment`** (development on the external chart) |

Dogfood mode, the per-pod ingest key, and `OWLPANE_SDK_SOURCE` are set by the external chart when that chart is rendered.

## Security

Enforced in this repository:

| Topic | What the files here do |
|-------|------------------------|
| Ingest keys in git | Committed placeholders are `owl_ing_EXAMPLE` and 48 zero digits. `.env` is gitignored. `scripts/check-placeholder-secrets.py` fails the build on any other `owl_ing_` token of 6 or more characters. |
| Java agent download | Pinned to `v2.14.0` in `docker/apps/java.Dockerfile`, `apps/java/run.sh`, and `conformance/java/run.sh`. |
| PII canary payloads | Fixture strings are sent as written. Search redaction is an API read-path behaviour. |

`scripts/validate-k8s-config.sh` looks for the example Helm chart at `SDK_EXAMPLES_HELM_CHART` (default under `seo-infra`) and skips chart rendering when that path is absent. Pod security context, one ingest key per Deployment, the browser enable flag, and `piiCanaryEnvironment` are settings on that chart. Review them there before enabling a release.

## Fixed issues (2026-03)

- `dogfood-env.sh` works **without Node** (python3 fallback) for Java/Go/Python/Ruby images.
- Helm injects **`OWLPANE_INGEST_KEY`** for all apps; pii-canary gets **`OWLPANE_ENDPOINT`**.
