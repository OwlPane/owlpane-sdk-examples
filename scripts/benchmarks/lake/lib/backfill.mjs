const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The lake rewrites rows stamped more than this far ahead to arrival time (api#194, LAKE_FUTURE_SKEW_MS). Past times are kept as sent. */
export const FUTURE_SKEW_MS = 10 * 60_000;
const PEAK_HOUR_UTC = 14;

/** Relative traffic at a moment: a cosine day curve peaking at 14:00 UTC that averages to exactly 1 over a day. */
export function diurnalWeight(ms, amplitude = 0.5) {
  if (!amplitude) return 1;
  const hourOfDay = (ms % DAY) / HOUR;
  return 1 + amplitude * Math.cos((2 * Math.PI * (hourOfDay - PEAK_HOUR_UTC)) / 24);
}

/**
 * Hour slots from `days` back to now, oldest first, each inside one UTC hour so every request lands in one
 * lake hour part. Walking forward keeps only the newest hour or two open per stream (the lake caps open hours
 * at LAKE_MAX_OPEN_WINDOWS = 4). Bytes follow the day curve and sum to rate x covered time.
 */
export function planBackfill({ days, nowMs, bytesPerSec, amplitude = 0.5 }) {
  if (!(days > 0)) throw new RangeError("days must be positive");
  const start = Math.floor((nowMs - days * DAY) / HOUR) * HOUR;
  const slots = [];
  for (let t = start; t < nowMs; t += HOUR) {
    const endMs = Math.min(t + HOUR, nowMs);
    slots.push({ startMs: t, endMs, weight: diurnalWeight(t + (endMs - t) / 2, amplitude) * (endMs - t) });
  }
  const totalBytes = (bytesPerSec * (nowMs - start)) / 1000;
  const totalWeight = slots.reduce((a, s) => a + s.weight, 0);
  return slots.map(({ startMs, endMs, weight }) => ({ startMs, endMs, bytes: Math.round((totalBytes * weight) / totalWeight) }));
}

/** `n` sorted timestamps spread uniformly over [startMs, endMs). */
export function timestampsInSlot(slot, n, rng) {
  const span = slot.endMs - slot.startMs;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = slot.startMs + Math.min(span - 1, Math.floor(rng() * span));
  return out.sort((a, b) => a - b);
}
