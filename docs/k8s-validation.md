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
| rust/php/dotnet/rn/serverless | `@owlpane/node` emitter | rich + language attrs | — | — | |
| demo-server | `@owlpane/node` continuous | traces/metrics/logs | HTTP :4399 | |
| browser | `@owlpane/browser` | RUM | — | — | **disabled in cluster** |
| pii-canary | `@owlpane/node` | + synthetic PII logs | — | scrub test | env **`piiCanaryEnvironment`** (not prod) |

Helm sets `OWLPANE_DOGFOOD_MODE=rich`, per-pod ingest key, `OWLPANE_SDK_SOURCE=published`.

## Security

| Topic | Status |
|-------|--------|
| Ingest keys in git | **No** — Vault → ESO; `.env` gitignored |
| Key scope per pod | **One key** per Deployment (+ `OWLPANE_INGEST_KEY`) |
| Keys in env vars | Yes (K8s Secret); visible to same-namespace `exec` — standard; prefer short-lived keys + revoke on offboard |
| pii-canary in prod label | **Mitigated** — uses `piiCanaryEnvironment: development` by default |
| Browser in cluster | **Off** — `enabled: false` |
| Container hardening | `allowPrivilegeEscalation: false`, drop ALL caps, RuntimeDefault seccomp |
| Java agent download | **Pinned version** at image build (not `latest`) |
| Internal ingest URL | ClusterIP only (no public ingest required for examples) |

## Fixed issues (2026-03)

- `dogfood-env.sh` works **without Node** (python3 fallback) for Java/Go/Python/Ruby images.
- Helm injects **`OWLPANE_INGEST_KEY`** for all apps; pii-canary gets **`OWLPANE_ENDPOINT`**.
