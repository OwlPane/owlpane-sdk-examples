import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, summarize } from "../lib/stats.mjs";

test("percentile uses nearest rank on 1..100", () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 95), 95);
  assert.equal(percentile(v, 99), 99);
  assert.equal(percentile(v, 100), 100);
});

test("percentile does not depend on input order and does not mutate it", () => {
  const v = [9, 1, 5, 3, 7];
  const copy = [...v];
  assert.equal(percentile(v, 50), 5);
  assert.deepEqual(v, copy);
});

test("p95 of a small sample is the max when rank rounds up past n-1", () => {
  // ceil(0.95 * 10) = 10 -> the 10th value: small samples never under-report the tail.
  const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000];
  assert.equal(percentile(v, 95), 1000);
  assert.equal(percentile(v, 50), 50);
});

test("percentile of one value is that value; empty is null", () => {
  assert.equal(percentile([42], 1), 42);
  assert.equal(percentile([42], 99), 42);
  assert.equal(percentile([], 95), null);
});

test("percentile rejects p outside (0, 100]", () => {
  assert.throws(() => percentile([1, 2], 0), RangeError);
  assert.throws(() => percentile([1, 2], 101), RangeError);
});

test("summarize reports n, min, max, mean and p50/p95/p99", () => {
  const s = summarize([4, 1, 3, 2]);
  assert.deepEqual(s, { n: 4, min: 1, max: 4, mean: 2.5, p50: 2, p95: 4, p99: 4 });
  assert.deepEqual(summarize([]), { n: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null });
});
