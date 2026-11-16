#!/usr/bin/env node
// D-14 load generator: OTLP/HTTP JSON logs, traces and metrics at a fixed uncompressed byte rate, live or backfilled.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { flag, env, requireEnv, die, guardHost, runId, writeReport, fmtBytes, sleep } from "./lib/cli.mjs";
import { parseRate, parseBytes, parseDuration, TokenBucket } from "./lib/rate.mjs";
import { mulberry32, buildTenants, buildBatch, cumulative, pickIndex } from "./lib/shapes.mjs";
import { planBackfill, timestampsInSlot } from "./lib/backfill.mjs";
import { summarize, round } from "./lib/stats.mjs";

const HELP = `Usage: node loadgen.mjs [options]
  --rate 10TB/month        uncompressed OTLP JSON payload rate (default 10TB/month = 3.86 MB/s)
  --duration 60s           live run length (0 with --backfill = backfill only)
  --backfill 7d            first write this much history, oldest hour first, then run live
  --send-rate 40MB/s       how fast backfill sends (default: 10 x --rate)
  --mix logs:0.55,traces:0.35,metrics:0.10   byte share per signal
  --batch 512KB            uncompressed body size per request (ingest caps bodies at 8 MB)
  --concurrency 8          requests in flight
  --encoding gzip          gzip | zstd | none
  --tenants 40 --hot 3     tenant count and how many are hot (Zipf s=1.4)
  --env bench              deployment.environment.name on every resource
  --seed 1 --out reports/lake-bench
Env: OWLPANE_BENCH_INGEST_URL (or OWLPANE_INGEST_URL), OWLPANE_BENCH_INGEST_KEYS (comma list, one per tenant project) or OWLPANE_INGEST_KEY`;

if (flag("help", false)) {
  console.log(HELP);
  process.exit(0);
}

const rate = parseRate(flag("rate", "10TB/month"));
const durationRaw = String(flag("duration", "60s"));
const durationMs = durationRaw === "0" ? 0 : parseDuration(durationRaw);
const backfillMs = flag("backfill", "") ? parseDuration(flag("backfill")) : 0;
const sendRate = flag("send-rate", "") ? parseRate(flag("send-rate")) : rate * 10;
const batchBytes = parseBytes(flag("batch", "512KB"));
const concurrency = Math.max(1, Number(flag("concurrency", 8)));
const encoding = String(flag("encoding", "gzip"));
const environment = String(flag("env", "bench"));
const seed = Number(flag("seed", 1));
const outDir = String(flag("out", "reports/lake-bench"));
const mix = Object.fromEntries(
  String(flag("mix", "logs:0.55,traces:0.35,metrics:0.10"))
    .split(",")
    .map((p) => p.split(":"))
    .map(([k, v]) => [k.trim(), Number(v)]),
);
const signals = Object.keys(mix);
if (!signals.every((s) => ["logs", "traces", "metrics"].includes(s) && mix[s] > 0)) die("--mix takes logs, traces and metrics with positive shares");
if (!["gzip", "zstd", "none"].includes(encoding)) die("--encoding is gzip, zstd or none");
if (encoding === "zstd" && !zlib.zstdCompress) die("zstd needs Node 22.15 or newer");
if (batchBytes > 8 * 1024 * 1024) die("--batch over 8 MB is rejected by the ingest gateway");
if (!durationMs && !backfillMs) die("Nothing to do: give --duration and/or --backfill");

const ingest = guardHost(requireEnv("OWLPANE_BENCH_INGEST_URL", "OWLPANE_INGEST_URL"), "Ingest URL");
const keys = (env("OWLPANE_BENCH_INGEST_KEYS") || requireEnv("OWLPANE_INGEST_KEY")).split(",").map((k) => k.trim()).filter(Boolean);

const compress = {
  gzip: promisify(zlib.gzip),
  zstd: zlib.zstdCompress ? promisify(zlib.zstdCompress) : null,
  none: async (b) => b,
}[encoding];

const id = runId();
mkdirSync(outDir, { recursive: true });
const traceIdFile = join(outDir, `trace-ids-${id}.jsonl`);
const rng = mulberry32(seed);
const tenants = buildTenants({ count: Number(flag("tenants", 40)), hot: Number(flag("hot", 3)), seed });
const sigCum = cumulative(signals.map((s) => mix[s]));
const perHourTraceIds = new Map();

const blank = () => ({ requests: 0, ok: 0, failed: 0, records: 0, rawBytes: 0, wireBytes: 0, status: {}, latencyMs: [], retries: 0 });
const stats = Object.fromEntries(signals.map((s) => [s, blank()]));
const t0 = Date.now();
let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.error("\nStopping after in-flight requests (Ctrl-C again to abort)...");
});

function keyFor(tenant) {
  // One ingest key is one project/tenant on the server; with fewer keys than tenants, tenants share keys round-robin.
  return keys[(Number(tenant.id.slice(-3)) - 1) % keys.length];
}

function noteTraceIds(samples) {
  for (const s of samples) {
    const hour = Math.floor(s.tsMs / 3_600_000);
    const n = perHourTraceIds.get(hour) ?? 0;
    if (n >= 20) continue;
    perHourTraceIds.set(hour, n + 1);
    appendFileSync(traceIdFile, `${JSON.stringify(s)}\n`);
  }
}

async function send({ signal, raw, records, key }) {
  const wire = await compress(raw);
  const s = stats[signal];
  const headers = { "content-type": "application/json", authorization: `Bearer ${key}` };
  if (encoding !== "none") headers["content-encoding"] = encoding;
  for (let attempt = 0; attempt < 4; attempt++) {
    const started = performance.now();
    let status = 0;
    let retryAfter = 0;
    try {
      const res = await fetch(`${ingest}/v1/${signal}`, { method: "POST", headers, body: wire });
      await res.arrayBuffer();
      status = res.status;
      retryAfter = Number(res.headers.get("retry-after") ?? 0);
    } catch (e) {
      status = `net:${e.cause?.code ?? e.name}`;
    }
    s.requests++;
    s.wireBytes += wire.length;
    s.status[status] = (s.status[status] ?? 0) + 1;
    s.latencyMs.push(performance.now() - started);
    if (status >= 200 && status < 300) {
      s.ok++;
      s.records += records;
      s.rawBytes += raw.length;
      return;
    }
    if (attempt === 3 || !(status === 429 || status === 503 || typeof status === "string")) break;
    s.retries++;
    await sleep(Math.min(30_000, (retryAfter || 2 ** attempt) * 1000));
  }
  s.failed++;
}

const inflight = new Set();
async function dispatch(batch) {
  while (inflight.size >= concurrency) await Promise.race(inflight);
  const p = send(batch).finally(() => inflight.delete(p));
  inflight.add(p);
}

function makeBatch(tsMs) {
  const signal = signals[pickIndex(sigCum, rng())];
  const b = buildBatch({ signal, targetBytes: batchBytes, rng, tenants, tsMs, environment });
  noteTraceIds(b.sampleTraceIds);
  return { signal, raw: Buffer.from(JSON.stringify(b.body)), records: b.records, key: keyFor(b.tenant) };
}

let lastProgress = 0;
function progress(label, extra = "") {
  const now = Date.now();
  if (now - lastProgress < 10_000) return;
  lastProgress = now;
  const raw = signals.reduce((a, s) => a + stats[s].rawBytes, 0);
  const wire = signals.reduce((a, s) => a + stats[s].wireBytes, 0);
  const secs = (now - t0) / 1000;
  console.error(`[${label}] ${secs.toFixed(0)}s raw ${fmtBytes(raw)} (${fmtBytes(raw / secs)}/s) wire ${fmtBytes(wire)} ratio ${(raw / Math.max(1, wire)).toFixed(2)}x ${extra}`);
}

async function backfill() {
  const nowMs = Date.now();
  const slots = planBackfill({ days: backfillMs / 86_400_000, nowMs, bytesPerSec: rate });
  const bucket = new TokenBucket({ bytesPerSec: sendRate, burstBytes: batchBytes * concurrency, nowMs: performance.now() });
  const total = slots.reduce((a, s) => a + s.bytes, 0);
  console.error(`Backfill: ${slots.length} hour slots, ${fmtBytes(total)} uncompressed, sending at ${fmtBytes(sendRate)}/s (~${(total / sendRate / 3600).toFixed(1)} h)`);
  let done = 0;
  for (const [i, slot] of slots.entries()) {
    let left = slot.bytes;
    while (left > 0 && !stopping) {
      // Pre-draw sorted timestamps for this batch so records land spread across the slot.
      const pool = timestampsInSlot(slot, 4096, rng);
      let k = 0;
      const batch = makeBatch(() => pool[k++ % pool.length]);
      const size = batch.raw.length;
      await sleep(bucket.take(size, performance.now()));
      await dispatch(batch);
      left -= size;
      done += size;
      progress("backfill", `slot ${i + 1}/${slots.length} ${new Date(slot.startMs).toISOString().slice(0, 13)}h ${((100 * done) / total).toFixed(1)}%`);
    }
    if (stopping) break;
  }
  await Promise.all(inflight);
  return { slots: slots.length, fromMs: slots[0].startMs, toMs: slots.at(-1).endMs, plannedBytes: total };
}

async function live() {
  const end = performance.now() + durationMs;
  const bucket = new TokenBucket({ bytesPerSec: rate, burstBytes: batchBytes, nowMs: performance.now() });
  while (performance.now() < end && !stopping) {
    const batch = makeBatch(() => Date.now() - Math.floor(rng() * 2000));
    const wait = bucket.take(batch.raw.length, performance.now());
    if (performance.now() + wait > end) break;
    await sleep(wait);
    await dispatch(batch);
    progress("live");
  }
  await Promise.all(inflight);
}

const startedAt = new Date().toISOString();
const backfillInfo = backfillMs ? await backfill() : null;
const liveStart = Date.now();
if (durationMs && !stopping) await live();
const liveSecs = (Date.now() - liveStart) / 1000;
const elapsedSecs = (Date.now() - t0) / 1000;

const perSignal = Object.fromEntries(
  signals.map((s) => {
    const x = stats[s];
    const lat = summarize(x.latencyMs);
    return [s, { requests: x.requests, ok: x.ok, failed: x.failed, retries: x.retries, records: x.records, rawBytes: x.rawBytes, wireBytes: x.wireBytes, wireRatio: x.wireBytes ? round(x.rawBytes / x.wireBytes, 2) : null, status: x.status, ingestLatencyMs: { p50: round(lat.p50), p95: round(lat.p95), p99: round(lat.p99) } }];
  }),
);
const totals = signals.reduce((a, s) => ({ rawBytes: a.rawBytes + stats[s].rawBytes, wireBytes: a.wireBytes + stats[s].wireBytes, requests: a.requests + stats[s].requests, ok: a.ok + stats[s].ok, failed: a.failed + stats[s].failed }), { rawBytes: 0, wireBytes: 0, requests: 0, ok: 0, failed: 0 });
totals.wireRatio = totals.wireBytes ? round(totals.rawBytes / totals.wireBytes, 2) : null;
totals.achievedRawBytesPerSec = round(totals.rawBytes / elapsedSecs, 0);

const report = {
  kind: "owlpane-lake-bench/loadgen",
  runId: id,
  startedAt,
  finishedAt: new Date().toISOString(),
  elapsedSecs: round(elapsedSecs),
  liveSecs: round(liveSecs),
  interrupted: stopping,
  ingestHost: new URL(ingest).host,
  ingestKeys: keys.length,
  config: { rateBytesPerSec: round(rate, 0), sendRateBytesPerSec: backfillMs ? round(sendRate, 0) : null, batchBytes, concurrency, encoding, environment, seed, mix, tenants: tenants.length },
  backfill: backfillInfo,
  traceIdFile,
  totals,
  perSignal,
  note: "rawBytes = uncompressed OTLP JSON accepted (2xx); wireBytes = request bodies sent incl. retries, HTTP headers excluded.",
};

const md = [
  `# Lake bench load: ${id}`,
  "",
  `Ingest \`${report.ingestHost}\`, ${report.elapsedSecs}s, encoding ${encoding}, target ${fmtBytes(rate)}/s${backfillInfo ? `, backfill ${new Date(backfillInfo.fromMs).toISOString()} .. ${new Date(backfillInfo.toMs).toISOString()}` : ""}${stopping ? " (interrupted)" : ""}.`,
  "",
  "| Signal | Requests (ok / failed) | Records | Uncompressed | On the wire | Wire ratio | Ingest p50 / p95 ms |",
  "|---|---|---|---|---|---|---|",
  ...signals.map((s) => {
    const p = perSignal[s];
    return `| ${s} | ${p.requests} (${p.ok} / ${p.failed}) | ${p.records} | ${fmtBytes(p.rawBytes)} | ${fmtBytes(p.wireBytes)} | ${p.wireRatio ?? "-"}x | ${p.ingestLatencyMs.p50 ?? "-"} / ${p.ingestLatencyMs.p95 ?? "-"} |`;
  }),
  `| **total** | ${totals.requests} (${totals.ok} / ${totals.failed}) | | ${fmtBytes(totals.rawBytes)} | ${fmtBytes(totals.wireBytes)} | ${totals.wireRatio ?? "-"}x | |`,
  "",
  `Achieved ${fmtBytes(totals.achievedRawBytesPerSec)}/s uncompressed (${fmtBytes(totals.achievedRawBytesPerSec * 86_400)}/day).`,
  "",
  `Status codes: ${signals.map((s) => `${s} ${JSON.stringify(perSignal[s].status)}`).join("; ")}`,
  "",
].join("\n");

const paths = writeReport(outDir, `loadgen-${id}`, report, md);
console.log(md);
console.error(`Wrote ${paths.json} and ${paths.md}; trace ids in ${traceIdFile}`);
// More than 1% of batches never accepted: the numbers above do not describe the target load.
if (totals.failed > (totals.ok + totals.failed) * 0.01) process.exitCode = 1;
