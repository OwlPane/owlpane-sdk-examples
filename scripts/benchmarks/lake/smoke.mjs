#!/usr/bin/env node
// One-minute end-to-end run of all three tools against the local fake only; never touches a real host.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { startFake } from "./fake-endpoint.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const duration = process.argv[2] ?? "60s";
const out = mkdtempSync(join(tmpdir(), "lake-bench-smoke-"));
const fake = await startFake();
// Placeholder credentials: the fake checks that a header is present, nothing else.
const childEnv = {
  PATH: process.env.PATH,
  OWLPANE_BENCH_INGEST_URL: fake.url,
  OWLPANE_INGEST_KEY: `owl_ing_${"0".repeat(48)}`,
  OWLPANE_BENCH_API_URL: fake.url,
  OWLPANE_BENCH_API_TOKEN: "owl_pat_EXAMPLE",
  OWLPANE_BENCH_R2_ENDPOINT: fake.url,
  OWLPANE_BENCH_R2_BUCKET: "bench-smoke",
  OWLPANE_BENCH_R2_ACCESS_KEY_ID: "AKIDEXAMPLE",
  OWLPANE_BENCH_R2_SECRET_ACCESS_KEY: "secretEXAMPLE",
};

function run(script, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(here, script), ...args, "--out", out], { env: childEnv, stdio: ["ignore", "inherit", "inherit"] });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
  });
}
const newest = (prefix) => JSON.parse(readFileSync(join(out, readdirSync(out).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().at(-1)), "utf8"));

try {
  await run("loadgen.mjs", ["--duration", duration]);
  const load = newest("loadgen-");
  const secs = load.liveSecs;
  const target = load.config.rateBytesPerSec;
  const achieved = load.totals.rawBytes / secs;
  assert.ok(Math.abs(achieved - target) / target < 0.1, `achieved ${achieved} B/s vs target ${target}`);
  const received = Object.values(fake.stats.otlp).reduce((a, s) => ({ wire: a.wire + s.wireBytes, raw: a.raw + s.rawBytes }), { wire: 0, raw: 0 });
  assert.equal(received.wire, load.totals.wireBytes, "wire bytes reported = wire bytes the endpoint received");
  assert.equal(received.raw, load.totals.rawBytes, "uncompressed bytes reported = bytes after the endpoint decompressed");
  assert.ok(load.totals.wireRatio > 2, `gzip should shrink OTLP JSON, got ${load.totals.wireRatio}x`);

  // Short backfill: 2 hours of history at 50x the live rate's send speed, all timestamps in the past.
  await run("loadgen.mjs", ["--backfill", "2h", "--duration", "0", "--rate", "50MB/day", "--send-rate", "20MB/s", "--batch", "64KB"]);
  const bf = newest("loadgen-");
  assert.ok(bf.backfill.toMs <= Date.now() && bf.backfill.fromMs <= Date.now() - 2 * 3_600_000);
  assert.ok(Math.abs(bf.totals.rawBytes - bf.backfill.plannedBytes) / bf.backfill.plannedBytes < 0.05, "backfill wrote its planned volume");

  await run("query-bench.mjs", ["--runs", "5", "--warmup", "1", "--pause", "0"]);
  const q = newest("query-");
  assert.equal(q.results.length, 12, "4 queries x 3 windows");
  assert.ok(q.results.every((r) => r.runs === 5 && r.errors === 0 && r.latencyMs.p95 > 0), "every query measured");
  assert.equal(q.gate, "PASS");

  await run("r2-probe.mjs", ["--write-probe", "4MB", "--write-runs", "3", "--runs", "10", "--large", "1MB"]);
  const r2 = newest("r2-");
  assert.equal(r2.writes.errors, 0);
  assert.equal(r2.reads.length, 2);
  assert.ok(r2.reads.every((r) => r.errors === 0 && r.totalMs.p95 > 0));
  assert.equal(fake.objects.size, 0, "probe objects deleted");

  console.log(`\nSMOKE PASS. Reports in ${out}`);
} catch (e) {
  console.error(`\nSMOKE FAIL: ${e.message}\nReports in ${out}`);
  process.exitCode = 1;
} finally {
  fake.server.close();
}
