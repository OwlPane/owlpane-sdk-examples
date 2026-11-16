import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, zipfWeights, pickIndex, logNormal, buildTenants, buildBatch } from "../lib/shapes.mjs";

test("mulberry32 is deterministic per seed and in [0, 1)", () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  for (let i = 0; i < 100; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test("zipf weights sum to 1 and fall with rank", () => {
  const w = zipfWeights(50, 1.1);
  assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  for (let i = 1; i < w.length; i++) assert.ok(w[i] < w[i - 1]);
});

test("default tenants: a few hot tenants carry most traffic, and the long tail still gets some", () => {
  const tenants = buildTenants({ count: 40, seed: 3 });
  const rng = mulberry32(9);
  const hits = new Array(tenants.length).fill(0);
  const cum = tenants.cumulative;
  for (let i = 0; i < 100_000; i++) hits[pickIndex(cum, rng())]++;
  const top3 = hits.slice(0, 3).reduce((a, b) => a + b, 0) / 100_000;
  assert.ok(top3 > 0.5, `top 3 share ${top3}`);
  assert.ok(hits.every((h) => h > 0), "every tail tenant appears");
});

test("logNormal median is near the given median and respects the cap", () => {
  const rng = mulberry32(5);
  const v = Array.from({ length: 20_000 }, () => logNormal(rng, 200, 1, 4096)).sort((a, b) => a - b);
  const med = v[v.length / 2];
  assert.ok(med > 180 && med < 220, `median ${med}`);
  assert.ok(v[v.length - 1] <= 4096);
  assert.ok(v[0] >= 1);
});

for (const signal of ["logs", "traces", "metrics"]) {
  test(`${signal} batch is valid OTLP JSON near the target size with timestamps from the clock`, () => {
    const tenants = buildTenants({ count: 10, seed: 1 });
    const rng = mulberry32(11);
    const ts = () => 1_700_000_000_000;
    const { body, records, sampleTraceIds } = buildBatch({ signal, targetBytes: 200_000, rng, tenants, tsMs: ts, environment: "bench" });
    const json = JSON.stringify(body);
    assert.ok(json.length > 180_000 && json.length < 260_000, `size ${json.length}`);
    assert.ok(records > 0);
    const rootKey = { logs: "resourceLogs", traces: "resourceSpans", metrics: "resourceMetrics" }[signal];
    assert.ok(Array.isArray(body[rootKey]) && body[rootKey].length > 0);
    const res = body[rootKey][0].resource.attributes.map((a) => a.key);
    for (const k of ["service.name", "deployment.environment.name", "tenant.id"]) assert.ok(res.includes(k), `${k} missing`);
    assert.ok(json.includes('"1700000000000000000"'), "nanosecond string timestamps");
    if (signal === "traces") {
      assert.ok(sampleTraceIds.length > 0);
      assert.match(sampleTraceIds[0].traceId, /^[0-9a-f]{32}$/);
    }
  });
}
