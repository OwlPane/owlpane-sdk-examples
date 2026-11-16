# Lake benchmark harness (D-14)

Measures what the lake cost model still assumes, and the phase-0 speed gate:

| Tool | Measures | Feeds |
|------|----------|-------|
| `loadgen.mjs` | OTLP logs, traces and metrics at a fixed **uncompressed** rate (default 10 TB/month = 3.86 MB/s = 333 GB/day), live or backfilled; bytes on the wire vs uncompressed per signal; ingest request latency | wire ratio, ingest bandwidth |
| `query-bench.mjs` | p50/p95/p99 of the gate's four queries over 1 h, 24 h and 7 d through the public API, PASS/FAIL against the gate | speed gate |
| `r2-probe.mjs` | ranged GET p50/p95/p99 (small and large ranges, plus time to first byte), optional PUT latency, bytes at rest under a prefix | R2 latency, R2 writes, lake compression ratio |

Speed gate (2027-01-15, also in `api/docs/ops/lake-gate.md`): with a 10 TB/month load running, query p95 **≤ 500 ms** for 1 h, **≤ 2 s** for 24 h, **≤ 8 s** for 7 days.

`api`'s `npm run lake:bench` times the internal lake query with a small synthetic tenant. This harness is the end-to-end path a customer uses (ingest gateway, lake, public query routes) at the real volume.

No dependencies; Node **22** or newer (zstd needs 22.15+). Run from this directory.

## Environment

Nothing is read from `.env` files by the tools themselves; export the variables, or keep them in a file you pass with `node --env-file=<file>`. Never commit them.

| Variable | Used by | Notes |
|----------|---------|-------|
| `OWLPANE_BENCH_INGEST_URL` | loadgen | staging `https://ingest.<staging-domain>` (falls back to `OWLPANE_INGEST_URL`) |
| `OWLPANE_BENCH_INGEST_KEYS` | loadgen | comma list of `owl_ing_` keys, one per bench project; tenants map onto keys round-robin (falls back to `OWLPANE_INGEST_KEY`) |
| `OWLPANE_BENCH_API_URL` | query-bench | staging `https://api.<staging-domain>` (falls back to `OWLPANE_API_URL`) |
| `OWLPANE_BENCH_API_TOKEN` | query-bench | `owl_pat_` token. Read-only tokens cover every query except `dashboard-aggregate` (`POST /v1/explorer/query`), which needs `alerts:write` scope; or set `OWLPANE_BENCH_API_COOKIE` to a console session cookie instead |
| `OWLPANE_BENCH_ORG` | query-bench | optional `x-owlpane-org` when the token's user is in several workspaces |
| `OWLPANE_BENCH_R2_ENDPOINT` | r2-probe | `https://<account>.r2.cloudflarestorage.com` |
| `OWLPANE_BENCH_R2_BUCKET` | r2-probe | e.g. the dev lake bucket |
| `OWLPANE_BENCH_R2_ACCESS_KEY_ID`, `OWLPANE_BENCH_R2_SECRET_ACCESS_KEY` | r2-probe | R2 API token; read-only is enough unless `--write-probe` |

The tools refuse `api.owlpane.com` / `ingest.owlpane.com` (and writing probe objects into `owlpane-lake-prod`) unless `OWLPANE_BENCH_ALLOW_PRODUCTION=1`. Do not set it: the gate is measured on staging.

## Running against staging

1. **Projects and keys.** In the staging console create one or more bench projects (e.g. `lake-bench-1..3`) and ingest keys. The workspace plan must retain logs and traces for at least 7 days, and the workspace log query policy must allow 10,080-minute windows, or the 7 d queries answer 400.

2. **Backfill seven days** (the 7 d window needs data spread across 7 days; waiting a week also works). Ingest keeps past timestamps as sent, and rows more than 10 minutes in the future are rewritten to arrival time (`LAKE_FUTURE_SKEW_MS`, api#194), so backfill only ever writes the past. It walks oldest hour first and keeps each request inside one UTC hour, which matches the lake's per-hour parts (at most 4 open hours per stream, api#194).

   ```bash
   node loadgen.mjs --backfill 7d --send-rate 40MB/s --duration 0 --env bench
   ```

   7 days at 10 TB/month is ~2.33 TB uncompressed: ~16 h at 40 MB/s. Watch the status columns for 429s from per-project ingest caps; spread over more keys or lower `--send-rate` if they appear. `Ctrl-C` stops cleanly and still writes the report.

3. **Let the lake settle.** Before measuring, let compaction catch up on the backfilled hours (parts at or near the 32 MiB target; see `lake-gate.md`), otherwise the 24 h and 7 d numbers measure a small-file backlog rather than steady state.

4. **Live load plus queries.** The gate is "with a 10 TB/month load running": start live load, wait at least **1 hour** so the 1 h window is fully live data, then run the query bench in a second shell while the load keeps going.

   ```bash
   node loadgen.mjs --duration 6h --env bench            # shell 1
   node query-bench.mjs --runs 30 --env bench            # shell 2, after >= 1 h of live load
   node query-bench.mjs --runs 30 --env bench --bust-cache   # same, with the digest cache defeated
   ```

   The 24 h window is fully covered by backfill plus live data; without backfill, wait 24 h for it and 7 days for the 7 d window.

5. **R2.**

   ```bash
   node r2-probe.mjs --prefix <lake-prefix> --runs 50                 # read-only: ranged GETs on the largest object found
   node r2-probe.mjs --write-probe 32MB --write-runs 20               # PUT latency; probe objects are deleted afterwards
   node r2-probe.mjs --stored-prefix <tenant-prefix>                  # bytes at rest, before and after a run
   ```

## What each query is

| Query | Route | Shape |
|-------|-------|-------|
| `latest-logs` | `GET /v1/logs` | latest 100 lines, `level=debug`, `env` |
| `filter-count` | `POST /v1/search/histogram` | `kind: log`, one filter (`--filter-key http.route --filter-value /api/v1/checkout`), counts per bucket |
| `trace-by-id` | `GET /v1/trace/:id?from&to` | ids the load generator recorded in `trace-ids-*.jsonl` (picked from the older half of the window so 7 d really reaches back), else harvested with `POST /v1/search/traces` |
| `dashboard-aggregate` | `POST /v1/explorer/query` | `http.server.request.duration` histogram, `p95` grouped by `service` |

Queries run round-robin, one at a time, `--runs` times per window after `--warmup` untimed runs. Latency is measured at the client and includes reading the body. The report also shows the API's `server-timing` and how many answers came from the Valkey digest cache (`x-lake-cache`); the uncached p95 column leaves those out. `--bust-cache` moves each run's explicit window by one second so the cache cannot answer at all.

## Data shape

Seeded (`--seed`) and reproducible. 40 tenants with Zipf traffic (s = 1.4: the top 3 carry about 60%, the tail still appears), hot tenants with 12 services x 24 pods, tail tenants with 2-5 services x 3 pods; every seventh tail tenant is an IoT fleet carrying the `owlpane.device.*` attributes that `@owlpane/node`'s `setDeviceContext` sets. Log bodies are log-normal (median ~160 B, tail to 16 KB) with ids and numbers mixed in; high-cardinality `user.id` / `request.id`; traces of 3-12 spans with DB client spans and 1-3% errors; histograms, sums and gauges per route and pod. Byte mix defaults to logs 55% / traces 35% / metrics 10% (`--mix`). Each request is one tenant (one key).

Synthetic text compresses differently from customer data. For the cost model, report the synthetic ratio as such, and if possible repeat the wire-ratio run with dogfood traffic (`../../run-dogfood.sh --loop`) for comparison.

## Outputs

Each run writes `<tool>-<run id>.json` and `.md` under `--out` (default `reports/lake-bench`, git-ignored). The query markdown table matches the latency table in `api/docs/ops/lake-gate-results/TEMPLATE.md`.

Cost-model inputs:

- **Wire ratio** per signal: `perSignal.*.wireRatio` (uncompressed accepted / bytes sent, HTTP headers excluded).
- **Lake compression ratio**: loadgen `totals.rawBytes` / growth of `stored.bytes` under the bench tenants' prefix (r2-probe `--stored-prefix` before and after, once compaction has run).
- **R2 latency**: r2-probe `reads[].totalMs` and `ttfbMs`; **R2 writes**: `writes.putMs`. The number of PUTs per hour (Class A operations) comes from the lake catalog's part count, not from this probe.
- **Query p95 per window**: query-bench `results[]`.
- **ClickHouse inserts per node** are not measured here. If a ClickHouse tier is in the path being benchmarked, read them during the live run, e.g. `SELECT hostName(), count() FROM clusterAllReplicas(default, system.part_log) WHERE event_type = 'NewPart' AND event_time > now() - INTERVAL 1 HOUR GROUP BY 1`.

## Tests

```bash
npm test          # node:test: rate shaping, percentiles, backfill time distribution, data shapes, SigV4
npm run smoke     # 1-minute run of all three tools against a local fake endpoint (fake-endpoint.mjs) only
```
