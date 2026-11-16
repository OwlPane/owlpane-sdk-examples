import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRate, parseBytes, parseDuration, TokenBucket } from "../lib/rate.mjs";

test("10TB/month is about 3.86 MB/s and 333 GB/day (decimal units, 30-day month)", () => {
  const r = parseRate("10TB/month");
  assert.ok(Math.abs(r - 3_858_024.69) < 1, `got ${r}`);
  assert.ok(Math.abs(r * 86_400 - 333.33e9) < 0.01e9);
});

test("parseRate accepts per-second, per-day, binary units and bare numbers", () => {
  assert.equal(parseRate("3.86MB/s"), 3_860_000);
  assert.equal(parseRate("333GB/day"), 333e9 / 86_400);
  assert.equal(parseRate("1MiB/s"), 1_048_576);
  assert.equal(parseRate("1 kb/sec"), 1000);
  assert.equal(parseRate("2048"), 2048);
  assert.equal(parseRate("1GB/h"), 1e9 / 3600);
});

test("parseRate rejects junk and non-positive rates", () => {
  assert.throws(() => parseRate("fast"), /rate/);
  assert.throws(() => parseRate("0MB/s"), /rate/);
  assert.throws(() => parseRate("5MB/fortnight"), /rate/);
});

test("parseBytes and parseDuration", () => {
  assert.equal(parseBytes("512KB"), 512_000);
  assert.equal(parseBytes("4MiB"), 4 * 1024 * 1024);
  assert.equal(parseDuration("60s"), 60_000);
  assert.equal(parseDuration("2m"), 120_000);
  assert.equal(parseDuration("7d"), 7 * 86_400_000);
  assert.equal(parseDuration("1500ms"), 1500);
  assert.equal(parseDuration("90"), 90_000);
  assert.throws(() => parseDuration("soon"), /duration/);
});

test("token bucket: no wait while the burst lasts, then waits enough to hold the rate", () => {
  const b = new TokenBucket({ bytesPerSec: 1000, burstBytes: 1000, nowMs: 0 });
  assert.equal(b.take(600, 0), 0);
  assert.equal(b.take(400, 0), 0);
  // Burst spent: the next 500 bytes need 0.5 s of refill.
  assert.equal(b.take(500, 0), 500);
});

test("token bucket holds the long-run rate within 1% for uneven batch sizes", () => {
  const rate = 3_858_024;
  const b = new TokenBucket({ bytesPerSec: rate, burstBytes: 1_000_000, nowMs: 0 });
  let now = 0;
  let sent = 0;
  const sizes = [200_000, 750_000, 64_000, 1_200_000, 333_333];
  for (let i = 0; i < 2000; i++) {
    const size = sizes[i % sizes.length];
    now += b.take(size, now);
    sent += size;
  }
  const achieved = sent / (now / 1000);
  // The initial burst is a fixed head start; over ~270 s it is well under 1%.
  assert.ok(Math.abs(achieved - rate) / rate < 0.01, `achieved ${achieved} vs ${rate}`);
});

test("token bucket does not bank more than the burst while idle", () => {
  const b = new TokenBucket({ bytesPerSec: 1000, burstBytes: 2000, nowMs: 0 });
  // Idle for an hour: still only 2000 bytes may go at once.
  assert.equal(b.take(2000, 3_600_000), 0);
  assert.equal(b.take(1000, 3_600_000), 1000);
});

test("token bucket rejects a non-positive rate", () => {
  assert.throws(() => new TokenBucket({ bytesPerSec: 0, burstBytes: 1, nowMs: 0 }), RangeError);
});
