/** Nearest-rank percentile: never interpolates below a sample that was actually seen, so small runs over- rather than under-report the tail. */
export function percentile(values, p) {
  if (!(p > 0 && p <= 100)) throw new RangeError(`percentile p must be in (0, 100], got ${p}`);
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(1, rank) - 1];
}

export function summarize(values) {
  if (values.length === 0) return { n: 0, min: null, max: null, mean: null, p50: null, p95: null, p99: null };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    n: values.length,
    min,
    max,
    mean: sum / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

export const round = (v, digits = 1) => (v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
