# SDK dogfood examples

Runnable example applications that install the **published** Owlpane SDKs (or standard OpenTelemetry exporters) and emit traces, metrics, structured logs, and browser RUM telemetry to your Owlpane ingest gateway.

**Platform matrix:** [docs.owlpane.com/sdk](https://docs.owlpane.com/sdk/node/). **Architecture & release flow:** [docs/architecture.md](./docs/architecture.md). SDK source is private **`OwlPane/owlpane-sdk`**; this repo uses **published** packages only — pin **`sdk-published.version`** and run **`./scripts/sync-pinned-sdk-version.sh`** after each SDK release.

## Standard onboarding (one project per app)

In the console, create **one project per app** (names must match `dogfood.manifest.json`).  
`./scripts/onboard-dogfood.sh --write-env` creates projects and ingest keys via the API (same as **Projects & keys → New project**).

| Console project | Example app | Package / path |
|-----------------|-------------|----------------|
| `owlpane-sdk-node` | [`apps/node`](apps/node) | `@owlpane/node` (npm; pin `nodeSdkVersion` in `packages/release-pins/pins.json`) |
| `owlpane-sdk-go` | [`apps/go`](apps/go) | OTel Go / local `packages/go` (dogfood `replace`) |
| `owlpane-sdk-python` | [`apps/python`](apps/python) | `owlpane` (PyPI; align with published SDK release) |
| `owlpane-sdk-java` | [`apps/java`](apps/java) | OpenTelemetry **javaagent** + `OTEL_*` env |
| `owlpane-sdk-ruby` | [`apps/ruby`](apps/ruby) | `opentelemetry-sdk` + OTLP exporter |
| `owlpane-sdk-rust` | [`apps/rust`](apps/rust) | OTLP via shared [`_lib/dogfood-rich-emit.mjs`](_lib/dogfood-rich-emit.mjs) |
| `owlpane-sdk-php` | [`apps/php`](apps/php) | Laravel-style spans + OTLP (shared emitter) |
| `owlpane-sdk-dotnet` | [`apps/dotnet`](apps/dotnet) | .NET runtime metrics + OTLP (shared emitter) |
| `owlpane-sdk-react-native` | [`apps/react-native`](apps/react-native) | Mobile-style spans + `telemetry.sdk.language=react-native` (shared emitter) |
| `owlpane-sdk-serverless` | [`apps/serverless`](apps/serverless) | Lambda-style spans with `faas.name` (shared emitter) |
| `owlpane-sdk-browser` | [`apps/browser`](apps/browser) | `@owlpane/browser` (Browser RUM; pin in `pins.json`) |

Each project gets its **own ingest key** (`owl_ing_*`). `OTEL_SERVICE_NAME` is set to the project slug (same rule as **InstallGuide** in the console).

```bash
chmod +x run-dogfood.sh scripts/onboard-dogfood.sh scripts/run-local-demo.sh apps/*/run.sh
# Creates console projects + keys (Scale org by default), writes examples/.env:
./scripts/onboard-dogfood.sh --write-env
./run-dogfood.sh              # one shot per runtime (incl. react-native + serverless)
./run-dogfood.sh --loop       # continuous Node demo-server + runtime ticker (see below)
```

Set `OWLPANE_DOGFOOD_MODE=rich` to emit multi-span traces (`GET /demo` + `SELECT orders`), error spans with recorded exceptions (`POST /checkout`), OTLP metrics (`owlpane.dogfood.requests`, `http.server.request.duration`), and trace-correlated structured logs.

## Local dogfood (localhost API + ingest)

Copy [`.env.local.example`](.env.local.example) to `.env`. Point **`OWLPANE_API_URL`** and **`OWLPANE_INGEST_URL`** at your local stack (default `http://localhost:4100` and `http://localhost:4318`). Run `./scripts/onboard-dogfood.sh --write-env` then `./run-dogfood.sh`.

For **remote API + local ingest** (crikiq cell), copy [`.env.example`](.env.example) instead and align **`OWLPANE_ENVIRONMENT`** with the project that owns your ingest keys before running `node scripts/verify-cloud-infrastructure-local.mjs`.

Do **not** use SaaS credentials against localhost unless you set `OWLPANE_DOGFOOD_ALLOW_LOCALHOST=1` (discouraged).

## SaaS dogfood (production ingest)

Copy [`.env.saas.example`](.env.saas.example) to `.env`. Set **`OWLPANE_INGEST_URL`** from console **Setup → Projects & keys** (same value the API advertises as public ingest), plus **`OWLPANE_ONBOARD_PASSWORD`**. **`OWLPANE_API_URL`** must be the public API host (e.g. `https://api.owlpane.com`), not localhost.

```bash
chmod +x scripts/run-saas-dogfood.sh scripts/onboard-dogfood.sh run-dogfood.sh
./scripts/run-saas-dogfood.sh              # onboard + one rich burst (8 projects incl. demo + PII)
./scripts/run-saas-dogfood.sh --loop-demo  # continuous load for Home charts
./pii-canary/run.sh                        # optional PII scrub stream
```

**What this covers:** OTLP from all SDK runtimes, browser RUM, `owlpane-demo-server`, and project **`pii-canary`** (onboarded via `dogfood.manifest.json`).

**What this does not cover:** Kubernetes cluster metrics, infra alert templates, and network/security views — those need the **[owlpane-agent](https://github.com/OwlPane/owlpane-agent)** on your cluster. Follow [kubernetes-e2e.md](https://github.com/OwlPane/owlpane-api/blob/main/docs/ops/kubernetes-e2e.md) on the API repo.

Open **Applications**, **Requests**, **Logs**, and **Metrics explorer** on your workspace console (`OWLPANE_CONSOLE_URL`). Match the **Deploy env** filter to `OWLPANE_ENVIRONMENT` (e.g. `development` for laptop dogfood).

**Preflight (SaaS):** `./scripts/saas-ingest-port-forward.sh start` then `node scripts/check-dogfood-cell.mjs`. This checks ingest OTLP **and** `GET $OWLPANE_API_URL/healthz` (`db` must be `true`). If ingest returns `503` with `Temporarily unavailable, retry`, the cell Postgres pool is unreachable from ingest — metrics never land and the console cannot query.

**Clear telemetry (save disk):** `./scripts/clear-telemetry-ingestion.sh` (local R2 lake catalog + objects); add `--remote` for the SaaS cell and `--usage` to reset local `usage_daily`.

## Local full-stack test (`:4318` cell + `:4100` API + `:4200` console)

Copy [`.env.local.example`](.env.local.example) or let `run-local-demo.sh` onboard automatically against your local stack:

1. **Telemetry cell**: Start the local ingest gateway on `http://127.0.0.1:4318` (and telemetry lake storage).
2. **Control plane API**: Start `owlpane/api` on `http://127.0.0.1:4100`.
3. **Web console**: Start `owlpane/console` on `http://127.0.0.1:4200` (Vite proxies `/v1` to the API).
4. **Emit one-shot rich telemetry across all runtimes**:
   ```bash
   ./scripts/run-local-demo.sh --once
   ```
5. **Run continuous load for live dashboard charts**:
   ```bash
   ./scripts/run-local-demo.sh --loop
   # or same as: ./run-dogfood.sh --loop
   ```
6. **Detached loop (recommended for console dogfood)**:
   ```bash
   chmod +x scripts/run-dogfood-loop-daemon.sh
   ./scripts/run-dogfood-loop-daemon.sh restart
   ./scripts/run-dogfood-loop-daemon.sh status
   ```
   Logs: `/tmp/owlpane-demo-server.log`, `/tmp/owlpane-runtime-ticker.log`.

### Local dogfood loop (all runtimes)

Console **Observability → Runtimes** filters on `telemetry.sdk.language` (and **Serverless** on `faas.name`) in the selected **Deploy env** and time range (e.g. **development**, **LAST 6H**). See [docs.owlpane.com](https://docs.owlpane.com/sdk/node/) for runtime telemetry details.

| Mode | What runs | Which runtime tabs get data |
|------|-----------|------------------------------|
| `./run-dogfood.sh --once` | One rich burst per app | All runtimes **once**; data drops off after your time window unless you run again |
| `./run-dogfood.sh --loop` / `run-local-demo.sh --loop` | **demo-server** (~3s) + **runtime ticker** (~45s) | **Node.js** continuously; Go/Java/Python/Ruby/Rust/PHP/.NET/React Native/Serverless refreshed on the ticker interval |
| `run-dogfood-loop-daemon.sh` | Same as `--loop`, background | Same; use `restart` after pulling example changes |

**Runtime ticker** apps: `go`, `java`, `python`, `ruby`, `rust`, `php`, `dotnet`, `react-native`, `serverless`.  
**Not in the ticker:** `browser` (run manually or use Frontend RUM), `node` (use demo-server or `./apps/node/run.sh`).

**Prerequisites on macOS:**

- **Java:** `/usr/bin/java` is often a stub. Install `brew install openjdk@21`; `apps/java/run.sh` picks up Homebrew OpenJDK automatically.
- **Ruby:** System Ruby 2.6 is too old for the Gemfile (Bundler 4). Use Homebrew Ruby (`brew install ruby`); `apps/ruby/run.sh` prepends `/opt/homebrew/opt/ruby/bin` to `PATH`.
- **.NET:** SDK required for the native app; the shared Node emitter in `apps/dotnet/run.sh` works without `dotnet` on PATH.

**If runtime pages stay empty:**

1. Match console env to `OWLPANE_ENVIRONMENT` in `examples/.env` (usually `development`).
2. Confirm ingest: `OWLPANE_INGEST_URL=http://127.0.0.1:4318` and API on `:4100`.
3. Run `./scripts/onboard-dogfood.sh --write-env` then `./run-dogfood.sh --once` or `run-dogfood-loop-daemon.sh restart`.
4. Check API logs for `Observability store unreachable` (telemetry lake/timeouts).
5. **Serverless** tab needs spans with `SpanAttributes['faas.name']`; the empty tab is plain black (no “No telemetry” copy) until data arrives.

### Docker Desktop (continuous demo-server container)

With the cell ingest bound on the host (`127.0.0.1:4318` from `stumpcam/deploy`):

```bash
./scripts/onboard-dogfood.sh --write-env
chmod +x scripts/run-docker-dogfood.sh
./scripts/run-docker-dogfood.sh          # build + run; restart policy keeps it up
docker compose -f docker-compose.dogfood.yml down   # stop
```

The container sends to `http://host.docker.internal:4318`. Watch **Requests** / **Metrics explorer** for `owlpane-demo-server`.

### Kubernetes agent (cluster metrics)

Cluster metrics and **Infrastructure → Kubernetes** need the Helm agent (SDK examples alone are not enough).

**Hetzner k3s (production dogfood):** reuse the **Default** ingest key from console project **Kubernetes: k3s-cluster** (renaming the project does not rotate keys):

```bash
export OWLPANE_INGEST_KEY=owl_ing_…   # Default key from Settings → Projects & keys
cd ../../../SEO2LS/seo-infra
./scripts/deploy-agent-k3s-hetzner.sh
```

Defaults: `cluster.name=k3s-cluster`, in-cluster ingest, agent chart pin `agentChartVersion` in `packages/release-pins/pins.json`.

**Local Docker Desktop:**

```bash
kubectl config use-context docker-desktop
cd ../../api
export OWLPANE_INGEST_KEY=owl_ing_…
./scripts/deploy-agent-docker-desktop.sh
```

See [kubernetes-e2e.md](../../api/docs/ops/kubernetes-e2e.md).

### Console verification checklist (`http://127.0.0.1:4200`)

- **Applications**: Open **Applications** and select **development** to see `owlpane-sdk-*` services.
- **Runtimes**: **Observability → Runtimes** (Node, Java, Python, Ruby, Go, Rust, PHP, .NET, React Native) and **Serverless**. With `run-dogfood-loop-daemon.sh` running, refresh after one ticker cycle (~45s). Each board should show RED, errors, dependencies, **runtime metric panels**, **vitals** (arrangeable with other charts), and **HTTP vs background** when rich dogfood emits `messaging.system` on server spans. Go uses native runtime metrics (`OWLPANE_RUNTIME_METRICS=1`); Rust/PHP/.NET use `dogfood-rich-emit.mjs` with `OWLPANE_DOGFOOD_MODE=rich` (default in their `run.sh`).
- **Requests**: Open **Requests** (`/observability/requests`) and inspect `GET /demo` (with child `SELECT orders` DB span) and `POST /checkout` (with recorded error exception). Open a trace and use **full screen** on a span detail (T9).
- **Logs**: Open **Logs** (`/observability/logs`), filter by `owlpane-sdk-node` or `owlpane-demo-server`, verify trace-correlated log records. Expand **Fields** → **Show more values** on `customer.tier` (exact counts over the range, L3). Group **Lines over time** by `customer.tier` (L17).
- **Search**: Open **Search**, run a span filter, use **What's different?** with baseline **Just before** (T3).
- **Metrics**: Open **Metrics explorer** (`/observability/explorer`) and query `owlpane.dogfood.requests` or `http.server.request.duration`.
- **Browser / Frontend RUM**: Open **Frontend** to see `owlpane-sdk-browser` `documentLoad` spans, feature flags (`checkout-redesign`), experiments (`exp-cart-2026`), and captured exceptions.
- **Dashboards Hub**: Open **Dashboards → Library** (`/observability/dashboards/library`) or **Built-in templates** (`/observability/dashboards/templates`) and install a starter dashboard; try a **logs** widget grouped by an attribute (L17).

## OwlCall (mobile Observe tab)

The **On-call app** (`owlpane/on-call-app`) reads traces/logs via the **API** (`:4100`), not ingest directly. For local dogfood:

1. `./run-dogfood.sh` (or `--loop`) with `.env` pointed at local ingest (`4318`) or SaaS port-forward (`14318` + `check-saas-ingest.mjs --otlp`).
2. Run **API** + sign into OwlCall with `EXPO_PUBLIC_OWLPANE_API_URL=http://127.0.0.1:4100`.
3. Open **Observe → Traces** (pick the same **environment** as `OWLPANE_ENVIRONMENT` in `.env`).

See [on-call-app/README.md](../../on-call-app/README.md) and [OBSERVE-IMPLEMENTATION.md](../../on-call-app/docs/OBSERVE-IMPLEMENTATION.md).

## Other samples

| Path | Purpose |
|------|---------|
| [`apps/demo-server/`](apps/demo-server/) | Continuous HTTP + interval load generator emitting traces, metrics, and logs |
| [`conformance/`](conformance/) | Plain OTel samples + `_receiver` for CI/docs (no real ingest) |
| [`pii-canary/`](pii-canary/) | PII scrub verification against a live ingest |
| [`_receiver/`](_receiver/) | Throwaway OTLP receiver used by package conformance tests |
