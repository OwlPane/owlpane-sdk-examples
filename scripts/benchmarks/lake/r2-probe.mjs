#!/usr/bin/env node
// D-14 R2 latency probe: ranged GET p50/p95 for small and large ranges, optional PUT latency, stored bytes under a prefix.
import { randomBytes } from "node:crypto";
import { flag, requireEnv, env, die, runId, writeReport, fmtBytes } from "./lib/cli.mjs";
import { parseBytes } from "./lib/rate.mjs";
import { signS3Request, sha256Hex, EMPTY_SHA256 } from "./lib/sigv4.mjs";
import { summarize, round } from "./lib/stats.mjs";
import { mulberry32 } from "./lib/shapes.mjs";

const HELP = `Usage: node r2-probe.mjs [options]
  --key <object>           object to read (read-only); without it the largest object under --prefix is used
  --prefix lake/           where to look for an object when --key is not given
  --runs 50                ranged GETs per range size
  --small 64KB --large 8MB range sizes (a footer read vs a column-chunk read)
  --write-probe 32MB       also PUT --write-runs objects of this size under owlpane-lake-bench/<run>/ (timed), read them, then delete them
  --write-runs 10 --keep   keep the probe objects
  --stored-prefix <p>      sum object sizes under a prefix (lake bytes at rest, for the compression ratio)
  --out reports/lake-bench
Env: OWLPANE_BENCH_R2_ENDPOINT (https://<account>.r2.cloudflarestorage.com), OWLPANE_BENCH_R2_BUCKET,
     OWLPANE_BENCH_R2_ACCESS_KEY_ID and OWLPANE_BENCH_R2_SECRET_ACCESS_KEY (an R2 API token),
     OWLPANE_BENCH_R2_REGION (default auto)`;

if (flag("help", false)) {
  console.log(HELP);
  process.exit(0);
}

const endpoint = requireEnv("OWLPANE_BENCH_R2_ENDPOINT").replace(/\/+$/, "");
const bucket = requireEnv("OWLPANE_BENCH_R2_BUCKET");
const creds = { accessKeyId: requireEnv("OWLPANE_BENCH_R2_ACCESS_KEY_ID"), secretAccessKey: requireEnv("OWLPANE_BENCH_R2_SECRET_ACCESS_KEY"), region: env("OWLPANE_BENCH_R2_REGION") || "auto" };
if (/owlpane-lake-prod/.test(bucket) && process.env.OWLPANE_BENCH_ALLOW_PRODUCTION !== "1" && flag("write-probe", "")) die("Refusing to write probe objects into the production lake bucket");

const runs = Number(flag("runs", 50));
const small = parseBytes(flag("small", "64KB"));
const large = parseBytes(flag("large", "8MB"));
const writeSize = flag("write-probe", "") ? parseBytes(flag("write-probe")) : 0;
const writeRuns = Number(flag("write-runs", 10));
const outDir = String(flag("out", "reports/lake-bench"));
const id = runId();
const rng = mulberry32(Number(flag("seed", 1)));

const objUrl = (key, query = "") => `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}${query}`;

async function s3(method, url, { headers = {}, body } = {}) {
  const payloadHash = body ? sha256Hex(body) : EMPTY_SHA256;
  const signed = signS3Request({ method, url, ...creds, headers, payloadHash });
  const started = performance.now();
  const res = await fetch(url, { method, headers: signed, body });
  let ttfbMs = performance.now() - started;
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf, ttfbMs, ms: performance.now() - started };
}

async function list(prefix) {
  const objects = [];
  let token = "";
  do {
    const q = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000", ...(token ? { "continuation-token": token } : {}) });
    const r = await s3("GET", `${endpoint}/${bucket}?${q}`);
    if (r.status !== 200) die(`ListObjectsV2 ${prefix} answered ${r.status}: ${r.buf.toString().slice(0, 200)}`);
    const xml = r.buf.toString();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      objects.push({ key: /<Key>([\s\S]*?)<\/Key>/.exec(m[1])[1].replace(/&amp;/g, "&"), size: Number(/<Size>(\d+)<\/Size>/.exec(m[1])[1]) });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") : "";
  } while (token);
  return objects;
}

async function size(key) {
  const r = await s3("HEAD", objUrl(key));
  if (r.status !== 200) die(`HEAD ${key} answered ${r.status}`);
  return Number(r.headers.get("content-length"));
}

async function rangedGets(key, objSize, rangeBytes) {
  const len = Math.min(rangeBytes, objSize);
  const total = [];
  const ttfb = [];
  let errors = 0;
  for (let i = 0; i < runs; i++) {
    const start = Math.floor(rng() * Math.max(1, objSize - len));
    const r = await s3("GET", objUrl(key), { headers: { range: `bytes=${start}-${start + len - 1}` } });
    if (r.status !== 206 && r.status !== 200) {
      errors++;
      continue;
    }
    total.push(r.ms);
    ttfb.push(r.ttfbMs);
  }
  const t = summarize(total);
  const f = summarize(ttfb);
  return { rangeBytes: len, runs, errors, totalMs: { p50: round(t.p50), p95: round(t.p95), p99: round(t.p99) }, ttfbMs: { p50: round(f.p50), p95: round(f.p95) } };
}

const report = { kind: "owlpane-lake-bench/r2", runId: id, at: new Date().toISOString(), endpointHost: new URL(endpoint).host, bucket, reads: [], writes: null, stored: null };
const probeKeys = [];

if (writeSize) {
  const lat = [];
  let errors = 0;
  for (let i = 0; i < writeRuns; i++) {
    const key = `owlpane-lake-bench/${id}/probe-${i}.bin`;
    const body = randomBytes(writeSize);
    const r = await s3("PUT", objUrl(key), { body, headers: { "content-type": "application/octet-stream" } });
    if (r.status === 200) {
      lat.push(r.ms);
      probeKeys.push(key);
    } else errors++;
  }
  const s = summarize(lat);
  report.writes = { objectBytes: writeSize, runs: writeRuns, errors, putMs: { p50: round(s.p50), p95: round(s.p95), p99: round(s.p99) }, throughputBytesPerSec: s.mean ? round((writeSize / s.mean) * 1000, 0) : null };
}

let key = flag("key", "");
if (!key && probeKeys.length) key = probeKeys[0];
if (!key && !flag("stored-prefix", "")) {
  const objs = await list(String(flag("prefix", "")));
  if (!objs.length) die("No object to read: pass --key, --prefix with objects under it, or --write-probe");
  key = objs.sort((a, b) => b.size - a.size)[0].key;
}
if (key) {
  const objSize = await size(key);
  report.object = { key, bytes: objSize };
  for (const r of [small, large]) report.reads.push(await rangedGets(key, objSize, r));
}

if (flag("stored-prefix", "")) {
  const prefix = String(flag("stored-prefix"));
  const objs = await list(prefix);
  report.stored = { prefix, objects: objs.length, bytes: objs.reduce((a, o) => a + o.size, 0) };
}

if (probeKeys.length && !flag("keep", false)) {
  for (const k of probeKeys) await s3("DELETE", objUrl(k));
  report.writes.deleted = probeKeys.length;
}

const md = [
  `# Lake bench R2: ${id}`,
  "",
  `Endpoint \`${report.endpointHost}\`, bucket \`${bucket}\`${report.object ? `, object ${fmtBytes(report.object.bytes)}` : ""}.`,
  "",
  "| Operation | Size | Runs | Errors | p50 ms | p95 ms | p99 ms | TTFB p50 / p95 ms |",
  "|---|---|---|---|---|---|---|---|",
  ...report.reads.map((r) => `| ranged GET | ${fmtBytes(r.rangeBytes)} | ${r.runs} | ${r.errors} | ${r.totalMs.p50} | ${r.totalMs.p95} | ${r.totalMs.p99} | ${r.ttfbMs.p50} / ${r.ttfbMs.p95} |`),
  ...(report.writes ? [`| PUT | ${fmtBytes(report.writes.objectBytes)} | ${report.writes.runs} | ${report.writes.errors} | ${report.writes.putMs.p50} | ${report.writes.putMs.p95} | ${report.writes.putMs.p99} | - |`] : []),
  "",
  ...(report.stored ? [`Stored under \`${report.stored.prefix}\`: ${report.stored.objects} objects, ${fmtBytes(report.stored.bytes)}.`, ""] : []),
].join("\n");
const paths = writeReport(outDir, `r2-${id}`, report, md);
console.log(md);
console.error(`Wrote ${paths.json} and ${paths.md}`);
