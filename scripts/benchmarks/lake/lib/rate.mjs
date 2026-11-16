const UNITS = {
  "": 1,
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};
// A month is 30 days: the cost model's "10 TB/month" means 333 GB/day.
const PER = { s: 1, sec: 1, second: 1, m: 60, min: 60, h: 3600, hour: 3600, d: 86_400, day: 86_400, month: 30 * 86_400 };

export function parseBytes(raw) {
  const m = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(String(raw));
  const unit = m ? UNITS[m[2].toLowerCase()] : undefined;
  const n = m ? Number(m[1]) : NaN;
  if (!unit || !Number.isFinite(n) || n <= 0) throw new Error(`Invalid byte size "${raw}" (try 512KB or 4MiB)`);
  return Math.round(n * unit);
}

/** Bytes per second from "10TB/month", "3.86MB/s", "333GB/day" or a bare number of bytes per second. */
export function parseRate(raw) {
  const m = /^\s*([\d.]+)\s*([a-z]*)\s*(?:\/\s*([a-z]+))?\s*$/i.exec(String(raw));
  const unit = m ? UNITS[m[2].toLowerCase()] : undefined;
  const per = m ? (m[3] ? PER[m[3].toLowerCase()] : 1) : undefined;
  const n = m ? Number(m[1]) : NaN;
  if (!unit || !per || !Number.isFinite(n) || n <= 0) throw new Error(`Invalid rate "${raw}" (try 10TB/month or 3.86MB/s)`);
  return (n * unit) / per;
}

export function parseDuration(raw) {
  const m = /^\s*([\d.]+)\s*(ms|s|m|h|d)?\s*$/i.exec(String(raw));
  const n = m ? Number(m[1]) : NaN;
  if (!m || !Number.isFinite(n) || n <= 0) throw new Error(`Invalid duration "${raw}" (try 60s, 10m, 7d)`);
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[(m[2] ?? "s").toLowerCase()];
  return Math.round(n * mult);
}

/**
 * Debt-style token bucket: a take larger than what is banked still succeeds and returns how long to wait,
 * so batch size never distorts the long-run rate. The clock is passed in to keep it testable.
 */
export class TokenBucket {
  constructor({ bytesPerSec, burstBytes, nowMs }) {
    if (!(bytesPerSec > 0)) throw new RangeError("bytesPerSec must be positive");
    this.rate = bytesPerSec / 1000;
    this.burst = Math.max(1, burstBytes);
    this.tokens = this.burst;
    this.last = nowMs;
  }

  take(bytes, nowMs) {
    this.tokens = Math.min(this.burst, this.tokens + (nowMs - this.last) * this.rate);
    this.last = nowMs;
    this.tokens -= bytes;
    return this.tokens >= 0 ? 0 : -this.tokens / this.rate;
  }
}
