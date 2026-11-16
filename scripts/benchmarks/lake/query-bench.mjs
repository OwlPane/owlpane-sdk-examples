#!/usr/bin/env node
// D-14 / phase-0 speed gate: p50/p95/p99 of the gate's queries over 1 h, 24 h and 7 d windows through the public API.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { flag, env, requireEnv, die, guardHost, runId, writeReport, sleep } from "./lib/cli.mjs";
import { summarize, round } from "./lib/stats.mjs";

const HELP = `Usage: node query-bench.mjs [options]
  --windows 1h,24h,7d      windows to measure (gate: 1h <= 500 ms, 24h <= 2 s, 7d <= 8 s at p95)
  --runs 30 --warmup 2     timed runs per query and window, after untimed warm-up runs
  --queries latest-logs,filter-count,trace-by-id,dashboard-aggregate
  --env bench              deployment environment the load generator wrote
  --filter-key http.route --filter-value /api/v1/checkout   the filter + count query's filter
  --trace-ids <file>       trace-ids-*.jsonl from loadgen (default: newest in --out); else ids are harvested via /v1/search/traces
  --bust-cache             shift each run's explicit window by 1 s so the API's digest cache cannot answer
  --pause 250ms            gap between requests
  --out reports/lake-bench
Env: OWLPANE_BENCH_API_URL (or OWLPANE_API_URL), OWLPANE_BENCH_API_TOKEN (owl_pat_...; dashboard-aggregate needs a token with alerts:write or a session),
     OWLPANE_BENCH_API_COOKIE (alternative to the token), OWLPANE_BENCH_ORG (x-owlpane-org when the token sees several workspaces)`;

if (flag("help", false)) {
  console.log(HELP);
  process.exit(0);
}

const GATE_MS = { 60: 500, 1440: 2000, 10080: 8000 };
const WINDOW_MIN = { "1h": 60, "24h": 1440, "7d": 10080 };
const windows = String(flag("windows", "1h,24h,7d")).split(",").map((w) => {
  if (!WINDOW_MIN[w]) die(`Unknown window ${w}: use 1h, 24h, 7d`);
  return w;
});
const runs = Number(flag("runs", 30));
const warmup = Number(flag("warmup", 2));
const queries = String(flag("queries", "latest-logs,filter-count,trace-by-id,dashboard-aggregate")).split(",");
const environment = String(flag("env", "bench"));
const filterKey = String(flag("filter-key", "http.route"));
const filterValue = String(flag("filter-value", "/api/v1/checkout"));
const bust = Boolean(flag("bust-cache", false));
const pauseMs = Number(String(flag("pause", "250ms")).replace(/ms$/, ""));
const outDir = String(flag("out", "reports/lake-bench"));

const api = guardHost(requireEnv("OWLPANE_BENCH_API_URL", "OWLPANE_API_URL"), "API URL");
const token = env("OWLPANE_BENCH_API_TOKEN");
const cookie = env("OWLPANE_BENCH_API_COOKIE");
if (!token && !cookie) die("Set OWLPANE_BENCH_API_TOKEN (owl_pat_...) or OWLPANE_BENCH_API_COOKIE");
const baseHeaders = { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : { cookie }), ...(env("OWLPANE_BENCH_ORG") ? { "x-owlpane-org": env("OWLPANE_BENCH_ORG") } : {}) };

async function call(method, path, body) {
  const started = performance.now();
  const res = await fetch(`${api}${path}`, { method, headers: body ? { ...baseHeaders, "content-type": "application/json" } : baseHeaders, body: body ? JSON.stringify(body) : undefined });
  const buf = await res.arrayBuffer();
  const ms = performance.now() - started;
  let json = null;
  try {
    json = JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch {}
  const st = /dur=([\d.]+)/.exec(res.headers.get("server-timing") ?? "");
  return { ms, status: res.status, bytes: buf.byteLength, cache: res.headers.get("x-lake-cache") ?? "", serverMs: st ? Number(st[1]) : null, json };
}

/** The window for run i: the last `minutes`, or with --bust-cache an explicit range that moves 1 s per run. */
function windowFor(minutes, i) {
  const to = Date.now() - (bust ? i * 1000 : 0);
  return { fromMs: to - minutes * 60_000 + (bust ? 1000 : 0), toMs: to };
}

function loadTraceIds() {
  let file = flag("trace-ids", "");
  if (!file && existsSync(outDir)) {
    const newest = readdirSync(outDir).filter((f) => /^trace-ids-.*\.jsonl$/.test(f)).sort().at(-1);
    if (newest) file = join(outDir, newest);
  }
  if (!file) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const knownTraceIds = loadTraceIds();

/** Ids whose root started in the older half of the window, so a 7-day lookup really reaches back days. */
async function traceIdsFor(minutes) {
  const now = Date.now();
  const lo = now - minutes * 60_000 + 60_000;
  const mid = now - (minutes * 60_000) / 2;
  let pool = knownTraceIds.filter((t) => t.tsMs >= lo && t.tsMs <= mid);
  if (!pool.length) pool = knownTraceIds.filter((t) => t.tsMs >= lo && t.tsMs <= now - 60_000);
  if (pool.length) return pool.map((t) => t.traceId);
  const r = await call("POST", "/v1/search/traces", { env: environment, minutes, limit: 50 });
  const ids = (r.json?.traces ?? []).map((t) => t.traceId ?? t.trace_id ?? t.TraceId).filter(Boolean);
  if (!ids.length) console.error(`No trace ids for the ${minutes}-minute window (search/traces answered ${r.status}); trace-by-id is skipped there.`);
  return ids;
}

const QUERIES = {
  "latest-logs": (minutes, i) => {
    const q = new URLSearchParams({ env: environment, limit: "100", level: "debug" });
    if (bust) {
      const w = windowFor(minutes, i);
      q.set("from", String(w.fromMs));
      q.set("to", String(w.toMs));
    } else q.set("minutes", String(minutes));
    return call("GET", `/v1/logs?${q}`);
  },
  "filter-count": (minutes, i) =>
    call("POST", "/v1/search/histogram", { kind: "log", env: environment, ...(bust ? windowFor(minutes, i) : { minutes }), filters: [{ key: filterKey, op: "eq", value: filterValue }] }),
  "trace-by-id": (minutes, i, ctx) => {
    const id = ctx.traceIds[i % ctx.traceIds.length];
    const w = windowFor(minutes, 0);
    return call("GET", `/v1/trace/${id}?from=${w.fromMs}&to=${w.toMs}`);
  },
  "dashboard-aggregate": (minutes, i) =>
    call("POST", "/v1/explorer/query", { metric: "http.server.request.duration", type: "histogram", agg: "p95", groupBy: "service", env: environment, ...(bust ? windowFor(minutes, i) : { minutes }) }),
};
for (const q of queries) if (!QUERIES[q]) die(`Unknown query ${q}; choose from ${Object.keys(QUERIES).join(", ")}`);

const id = runId();
const results = [];
for (const w of windows) {
  const minutes = WINDOW_MIN[w];
  const ctx = { traceIds: queries.includes("trace-by-id") ? await traceIdsFor(minutes) : [] };
  const active = queries.filter((q) => q !== "trace-by-id" || ctx.traceIds.length);
  const samples = Object.fromEntries(active.map((q) => [q, []]));
  for (let i = 0; i < warmup + runs; i++) {
    // Round-robin across queries so a slow minute on the cell spreads over all of them, not one.
    for (const q of active) {
      const r = await QUERIES[q](minutes, i, ctx);
      if (i >= warmup) samples[q].push(r);
      if (r.status >= 400 && i === 0) console.error(`${q} ${w}: HTTP ${r.status} ${JSON.stringify(r.json)?.slice(0, 200)}`);
      if (pauseMs) await sleep(pauseMs);
    }
  }
  for (const q of queries) {
    const s = samples[q] ?? [];
    const ok = s.filter((r) => r.status >= 200 && r.status < 300);
    const all = summarize(ok.map((r) => r.ms));
    const cold = summarize(ok.filter((r) => !r.cache).map((r) => r.ms));
    const server = summarize(ok.filter((r) => r.serverMs != null).map((r) => r.serverMs));
    const statuses = {};
    for (const r of s) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    const gateMs = GATE_MS[minutes];
    const skipped = !s.length;
    results.push({
      window: w,
      minutes,
      query: q,
      runs: s.length,
      errors: s.length - ok.length,
      statuses,
      cacheHits: ok.filter((r) => r.cache).length,
      latencyMs: { p50: round(all.p50), p95: round(all.p95), p99: round(all.p99), min: round(all.min), max: round(all.max) },
      uncachedLatencyMs: { n: cold.n, p50: round(cold.p50), p95: round(cold.p95), p99: round(cold.p99) },
      serverTimingMs: { n: server.n, p50: round(server.p50), p95: round(server.p95) },
      meanResponseBytes: ok.length ? Math.round(ok.reduce((a, r) => a + r.bytes, 0) / ok.length) : null,
      gateMs,
      pass: skipped ? null : ok.length === s.length && all.p95 != null && all.p95 <= gateMs,
    });
    const last = results.at(-1);
    console.error(`${w.padEnd(4)} ${q.padEnd(20)} p50 ${last.latencyMs.p50} p95 ${last.latencyMs.p95} p99 ${last.latencyMs.p99} ms, errors ${last.errors}, cache hits ${last.cacheHits} -> ${skipped ? "SKIPPED" : last.pass ? "PASS" : "FAIL"}`);
  }
}

const measured = results.filter((r) => r.pass !== null);
const gate = measured.length === windows.length * queries.length && measured.every((r) => r.pass) ? "PASS" : measured.some((r) => r.pass === false) ? "FAIL" : "INCOMPLETE";
const report = { kind: "owlpane-lake-bench/query", runId: id, at: new Date().toISOString(), apiHost: new URL(api).host, config: { windows, runs, warmup, queries, environment, filter: { key: filterKey, value: filterValue }, bustCache: bust, pauseMs }, gate, results };

const md = [
  `# Lake bench queries: ${id}`,
  "",
  `API \`${report.apiHost}\`, env \`${environment}\`, ${runs} runs (+${warmup} warm-up) per cell${bust ? ", cache busted" : ""}. Client-measured latency, body read included.`,
  "",
  `**Gate: ${gate}**`,
  "",
  "| Window | Query | p50 ms | p95 ms | p99 ms | Uncached p95 ms | Errors | Cache hits | Gate | Pass? |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.window} | ${r.query} | ${r.latencyMs.p50 ?? "-"} | ${r.latencyMs.p95 ?? "-"} | ${r.latencyMs.p99 ?? "-"} | ${r.uncachedLatencyMs.p95 ?? "-"} | ${r.errors} | ${r.cacheHits} | ≤ ${r.gateMs} | ${r.pass === null ? "skipped" : r.pass ? "yes" : "**no**"} |`),
  "",
].join("\n");
const paths = writeReport(outDir, `query-${id}`, report, md);
console.log(md);
console.error(`Wrote ${paths.json} and ${paths.md}`);
if (gate === "FAIL") process.exitCode = 1;
