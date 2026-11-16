import { test } from "node:test";
import assert from "node:assert/strict";
import { planBackfill, timestampsInSlot, diurnalWeight, FUTURE_SKEW_MS } from "../lib/backfill.mjs";
import { mulberry32 } from "../lib/shapes.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 2026-11-16T10:25:00Z: mid-hour on purpose.
const NOW = Date.UTC(2026, 10, 16, 10, 25, 0);
const RATE = 3_858_024; // 10 TB/month

test("plan covers the whole window oldest first, on UTC hour boundaries", () => {
  const slots = planBackfill({ days: 7, nowMs: NOW, bytesPerSec: RATE });
  assert.ok(slots[0].startMs <= NOW - 7 * DAY, "starts at least 7 days back");
  assert.equal(slots[0].startMs % HOUR, 0);
  for (let i = 1; i < slots.length; i++) {
    assert.equal(slots[i].startMs, slots[i - 1].endMs, "contiguous");
    assert.ok(slots[i].startMs > slots[i - 1].startMs, "chronological");
    assert.equal(slots[i].startMs % HOUR, 0, "hour aligned");
  }
});

test("no slot reaches into the future, so the ingest's 10-minute future clamp never rewrites a row", () => {
  const slots = planBackfill({ days: 7, nowMs: NOW, bytesPerSec: RATE });
  const last = slots[slots.length - 1];
  assert.ok(last.endMs <= NOW, "ends by now");
  assert.ok(FUTURE_SKEW_MS === 10 * 60_000);
  const rng = mulberry32(1);
  for (const s of slots) for (const t of timestampsInSlot(s, 50, rng)) assert.ok(t < NOW);
});

test("each slot stays inside one UTC hour, so a batch lands in one lake hour part", () => {
  const slots = planBackfill({ days: 2, nowMs: NOW, bytesPerSec: RATE });
  for (const s of slots) assert.equal(Math.floor(s.startMs / HOUR), Math.floor((s.endMs - 1) / HOUR));
});

test("total bytes match rate x covered time within 0.5%", () => {
  const slots = planBackfill({ days: 7, nowMs: NOW, bytesPerSec: RATE });
  const total = slots.reduce((a, s) => a + s.bytes, 0);
  const covered = slots[slots.length - 1].endMs - slots[0].startMs;
  const want = (RATE * covered) / 1000;
  assert.ok(Math.abs(total - want) / want < 0.005, `${total} vs ${want}`);
});

test("diurnal shape: busiest hour carries more than the quietest, and a day averages to 1", () => {
  let sum = 0;
  let max = 0;
  let min = Infinity;
  for (let h = 0; h < 24; h++) {
    const w = diurnalWeight(Date.UTC(2026, 0, 1, h), 0.5);
    sum += w;
    max = Math.max(max, w);
    min = Math.min(min, w);
  }
  assert.ok(Math.abs(sum / 24 - 1) < 1e-9);
  assert.ok(max / min > 2.5, `peak/trough ${max / min}`);
  // Amplitude 0 is flat.
  assert.equal(diurnalWeight(Date.UTC(2026, 0, 1, 3), 0), 1);
});

test("timestamps inside a slot are sorted, in range, and spread across it", () => {
  const slot = { startMs: 0, endMs: HOUR, bytes: 1 };
  const ts = timestampsInSlot(slot, 1000, mulberry32(7));
  assert.equal(ts.length, 1000);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] >= ts[i - 1]);
  assert.ok(ts[0] >= 0 && ts[ts.length - 1] < HOUR);
  const firstHalf = ts.filter((t) => t < HOUR / 2).length;
  assert.ok(firstHalf > 400 && firstHalf < 600, `first half ${firstHalf}`);
});

test("planBackfill rejects a non-positive window", () => {
  assert.throws(() => planBackfill({ days: 0, nowMs: NOW, bytesPerSec: RATE }), RangeError);
});

test("a partial last hour gets bytes in proportion to its length", () => {
  // NOW is 25 minutes into its hour; with a flat curve that slot holds 25/60 of a full hour's bytes.
  const slots = planBackfill({ days: 1, nowMs: NOW, bytesPerSec: RATE, amplitude: 0 });
  const full = slots[slots.length - 2].bytes;
  const last = slots[slots.length - 1];
  assert.equal(last.endMs - last.startMs, 25 * 60_000);
  assert.ok(Math.abs(last.bytes / full - 25 / 60) < 1e-3, `ratio ${last.bytes / full}`);
});
