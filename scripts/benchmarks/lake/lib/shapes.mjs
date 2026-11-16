/** Small seeded PRNG so a run's data shape is reproducible from --seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function zipfWeights(n, s) {
  const raw = Array.from({ length: n }, (_, i) => 1 / (i + 1) ** s);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

export function cumulative(weights) {
  let acc = 0;
  const out = weights.map((w) => (acc += w));
  out[out.length - 1] = 1;
  return out;
}

/** Index for a uniform draw `u` against a cumulative distribution (binary search). */
export function pickIndex(cum, u) {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (u < cum[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Log-normal integer with the given median, clamped to [1, max]: message and attribute sizes have a long right tail. */
export function logNormal(rng, median, sigma, max) {
  const u1 = Math.max(rng(), 1e-12);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
  return Math.max(1, Math.min(max, Math.round(median * Math.exp(sigma * z))));
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const hex = (rng, chars) => {
  let s = "";
  while (s.length < chars) s += Math.floor(rng() * 4294967296).toString(16).padStart(8, "0");
  return s.slice(0, chars);
};

const SERVICE_STEMS = ["checkout", "cart", "catalog", "auth", "payments", "search", "inventory", "shipping", "notifications", "gateway", "billing", "profile", "recommendations", "media", "ledger", "scheduler"];
const ROUTES = ["/", "/health", "/api/v1/orders", "/api/v1/orders/:id", "/api/v1/cart", "/api/v1/cart/items", "/api/v1/users/:id", "/api/v1/login", "/api/v1/search", "/api/v1/products", "/api/v1/products/:id", "/api/v1/checkout", "/api/v1/payments", "/api/v1/shipments/:id", "/api/v1/inventory/:sku", "/api/v2/recommendations", "/webhooks/stripe", "/internal/jobs/run", "/metrics", "/graphql"];
const WORDS = ["request", "completed", "failed", "retrying", "connection", "pool", "timeout", "user", "order", "cache", "miss", "hit", "upstream", "latency", "exceeded", "queue", "enqueued", "processed", "payload", "validated", "rejected", "token", "refreshed", "session", "expired", "query", "rows", "returned", "slow", "lock", "acquired", "released", "shard", "replica", "lag", "batch", "flushed", "worker", "started", "stopped"];
const REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"];
const LANGS = ["nodejs", "go", "python", "java", "ruby", "dotnet", "rust", "php"];
const SEVERITY = [
  [0.1, 5, "DEBUG"],
  [0.9, 9, "INFO"],
  [0.97, 13, "WARN"],
  [1, 17, "ERROR"],
];

/**
 * Tenants with Zipf-distributed traffic (default s=1.4: the top 3 of 40 carry ~60%), each with services,
 * routes and pods. Hot tenants get more services and pods, which is what drives attribute cardinality.
 * Every seventh tail tenant is an IoT fleet carrying the same device attributes as @owlpane/node's setDeviceContext.
 */
export function buildTenants({ count = 40, hot = 3, s = 1.4, seed = 1 } = {}) {
  const rng = mulberry32(seed);
  const weights = zipfWeights(count, s);
  const tenants = weights.map((weight, i) => {
    const isHot = i < hot;
    const nServices = isHot ? 12 : 2 + Math.floor(rng() * 4);
    const services = Array.from({ length: nServices }, (_, k) => ({
      name: `${SERVICE_STEMS[(i + k) % SERVICE_STEMS.length]}${k >= SERVICE_STEMS.length ? `-${k}` : ""}`,
      lang: pick(rng, LANGS),
      routes: ROUTES.slice(0, 6 + Math.floor(rng() * (ROUTES.length - 6))),
      pods: Array.from({ length: isHot ? 24 : 3 }, () => `${hex(rng, 10)}-${hex(rng, 5)}`),
    }));
    return {
      id: `tenant-${String(i + 1).padStart(3, "0")}`,
      tier: isHot ? "hot" : "tail",
      weight,
      region: pick(rng, REGIONS),
      iot: !isHot && i % 7 === 0,
      users: isHot ? 200_000 : 2_000,
      services,
    };
  });
  tenants.cumulative = cumulative(weights);
  return tenants;
}

const nanos = (ms) => `${Math.floor(ms)}000000`;
const str = (key, v) => ({ key, value: { stringValue: v } });
const int = (key, v) => ({ key, value: { intValue: String(v) } });

function resourceFor(tenant, svc, pod, environment) {
  const attrs = [
    str("service.name", svc.name),
    str("service.namespace", tenant.id),
    str("service.version", `1.${svc.name.length % 9}.${svc.pods.length}`),
    str("deployment.environment.name", environment),
    str("tenant.id", tenant.id),
    str("tenant.tier", tenant.tier),
    str("cloud.region", tenant.region),
    str("k8s.namespace.name", tenant.id),
    str("k8s.pod.name", `${svc.name}-${pod}`),
    str("host.name", `node-${pod.slice(0, 4)}`),
    str("telemetry.sdk.language", svc.lang),
    str("owlpane.bench", "lake-speed-gate"),
  ];
  if (tenant.iot) {
    attrs.push(str("owlpane.device.id", `sim-${pod.slice(0, 6)}`), str("owlpane.device_fleet.id", `${tenant.id}-fleet`), str("owlpane.device.class", "generic"), str("owlpane.device.firmware_version", "1.0.0"));
  }
  return { attributes: attrs };
}

function message(rng, targetLen) {
  const parts = [];
  let len = 0;
  while (len < targetLen) {
    const r = rng();
    const w = r < 0.7 ? pick(rng, WORDS) : r < 0.85 ? String(Math.floor(rng() * 100_000)) : r < 0.95 ? `id=${hex(rng, 12)}` : `${pick(rng, WORDS)}_ms=${(rng() * 900).toFixed(1)}`;
    parts.push(w);
    len += w.length + 1;
  }
  return parts.join(" ").slice(0, targetLen);
}

function severity(rng) {
  const u = rng();
  for (const [p, n, t] of SEVERITY) if (u < p) return [n, t];
  return [9, "INFO"];
}

function statusCode(rng) {
  const u = rng();
  return u < 0.9 ? 200 : u < 0.94 ? 201 : u < 0.97 ? 404 : u < 0.99 ? 500 : 503;
}

function logRecord(rng, tenant, svc, tsMs) {
  const [sevNum, sevText] = severity(rng);
  const route = pick(rng, svc.routes);
  const attributes = [str("http.route", route), int("http.response.status_code", statusCode(rng)), str("user.id", `u${Math.floor(rng() * tenant.users)}`), str("request.id", hex(rng, 16))];
  if (rng() < 0.2) attributes.push(str("error.type", pick(rng, ["TimeoutError", "ECONNRESET", "ValidationError", "NotFound"])));
  if (rng() < 0.1) attributes.push(str("payload.sample", message(rng, logNormal(rng, 400, 1.2, 8_000))));
  return {
    timeUnixNano: nanos(tsMs),
    observedTimeUnixNano: nanos(tsMs + Math.floor(rng() * 50)),
    severityNumber: sevNum,
    severityText: sevText,
    body: { stringValue: message(rng, logNormal(rng, 160, 0.9, 16_000)) },
    attributes,
    traceId: rng() < 0.6 ? hex(rng, 32) : "",
    spanId: rng() < 0.6 ? hex(rng, 16) : "",
  };
}

function trace(rng, tenant, svc, tsMs) {
  const traceId = hex(rng, 32);
  const n = 3 + Math.floor(rng() * 10);
  const spans = [];
  const rootDur = logNormal(rng, 40, 1, 30_000);
  const route = pick(rng, svc.routes);
  const code = statusCode(rng);
  const rootId = hex(rng, 16);
  const user = `u${Math.floor(rng() * tenant.users)}`;
  for (let i = 0; i < n; i++) {
    const root = i === 0;
    const start = root ? tsMs : tsMs + Math.floor(rng() * rootDur * 0.8);
    const dur = root ? rootDur : Math.max(1, Math.floor(rng() * rootDur * 0.5));
    const kind = root ? 2 : rng() < 0.5 ? 3 : 1;
    const attributes = root
      ? [str("http.request.method", pick(rng, ["GET", "GET", "GET", "POST", "PUT", "DELETE"])), str("http.route", route), int("http.response.status_code", code), str("user.id", user)]
      : kind === 3
        ? [str("db.system", pick(rng, ["postgresql", "redis", "mysql"])), str("db.statement", `SELECT * FROM ${pick(rng, WORDS)} WHERE id = $1`), str("peer.service", pick(rng, SERVICE_STEMS))]
        : [str("code.function", `${pick(rng, WORDS)}.${pick(rng, WORDS)}`)];
    const span = {
      traceId,
      spanId: root ? rootId : hex(rng, 16),
      parentSpanId: root ? "" : rootId,
      name: root ? `${attributes[0].value.stringValue} ${route}` : kind === 3 ? `${attributes[0].value.stringValue} query` : attributes[0].value.stringValue,
      kind,
      startTimeUnixNano: nanos(start),
      endTimeUnixNano: nanos(start + dur),
      attributes,
      status: root && code >= 500 ? { code: 2, message: "upstream failure" } : { code: 0 },
    };
    if (root && code >= 500) span.events = [{ name: "exception", timeUnixNano: nanos(start + dur - 1), attributes: [str("exception.type", "UpstreamError"), str("exception.message", message(rng, 120))] }];
    spans.push(span);
  }
  return { traceId, spans };
}

const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function metrics(rng, tenant, svc, tsMs, pod) {
  const t = nanos(tsMs);
  const start = nanos(tsMs - 60_000);
  const routes = svc.routes;
  const hist = routes.map((route) => {
    const counts = BUCKETS.map(() => Math.floor(rng() * 50));
    counts.push(Math.floor(rng() * 3));
    const count = counts.reduce((a, b) => a + b, 0);
    return {
      startTimeUnixNano: start,
      timeUnixNano: t,
      count: String(count),
      sum: Math.round(count * (20 + rng() * 200)),
      bucketCounts: counts.map(String),
      explicitBounds: BUCKETS,
      attributes: [str("http.route", route), str("http.request.method", "GET"), int("http.response.status_code", statusCode(rng))],
    };
  });
  const reqs = routes.map((route) => ({ startTimeUnixNano: start, timeUnixNano: t, asInt: String(Math.floor(rng() * 10_000)), attributes: [str("http.route", route)] }));
  return [
    { name: "http.server.request.duration", unit: "ms", histogram: { aggregationTemporality: 2, dataPoints: hist } },
    { name: "http.server.requests", unit: "1", sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: reqs } },
    { name: "process.cpu.utilization", unit: "1", gauge: { dataPoints: [{ timeUnixNano: t, asDouble: rng(), attributes: [str("k8s.pod.name", pod)] }] } },
    { name: "process.memory.usage", unit: "By", gauge: { dataPoints: [{ timeUnixNano: t, asInt: String(Math.floor(50e6 + rng() * 400e6)), attributes: [str("k8s.pod.name", pod)] }] } },
  ];
}

const SCOPE = { name: "owlpane-lake-bench", version: "1" };

/**
 * One OTLP/HTTP JSON request body for one tenant, grown until its JSON is about `targetBytes`.
 * `tsMs()` gives each record's time, so live and backfill runs share the builders.
 */
export function buildBatch({ signal, targetBytes, rng, tenants, tsMs, environment, tenantIndex }) {
  const tenant = tenants[tenantIndex ?? pickIndex(tenants.cumulative, rng())];
  const groups = new Map();
  let size = 64;
  let records = 0;
  const sampleTraceIds = [];
  while (size < targetBytes) {
    const svc = pick(rng, tenant.services);
    const pod = pick(rng, svc.pods);
    const key = `${svc.name}|${pod}`;
    let g = groups.get(key);
    if (!g) {
      g = { resource: resourceFor(tenant, svc, pod, environment), items: [] };
      groups.set(key, g);
      size += JSON.stringify(g.resource).length + 64;
    }
    const ts = tsMs();
    if (signal === "logs") {
      const r = logRecord(rng, tenant, svc, ts);
      g.items.push(r);
      size += JSON.stringify(r).length + 1;
      records++;
    } else if (signal === "traces") {
      const tr = trace(rng, tenant, svc, ts);
      g.items.push(...tr.spans);
      size += JSON.stringify(tr.spans).length;
      records += tr.spans.length;
      if (sampleTraceIds.length < 2) sampleTraceIds.push({ traceId: tr.traceId, tsMs: ts, service: svc.name, tenant: tenant.id });
    } else if (signal === "metrics") {
      const ms = metrics(rng, tenant, svc, ts, pod);
      g.items.push(...ms);
      size += JSON.stringify(ms).length;
      records += ms.reduce((a, m) => a + (m.histogram ?? m.sum ?? m.gauge).dataPoints.length, 0);
    } else throw new Error(`Unknown signal ${signal}`);
  }
  const list = [...groups.values()];
  const body =
    signal === "logs"
      ? { resourceLogs: list.map((g) => ({ resource: g.resource, scopeLogs: [{ scope: SCOPE, logRecords: g.items }] })) }
      : signal === "traces"
        ? { resourceSpans: list.map((g) => ({ resource: g.resource, scopeSpans: [{ scope: SCOPE, spans: g.items }] })) }
        : { resourceMetrics: list.map((g) => ({ resource: g.resource, scopeMetrics: [{ scope: SCOPE, metrics: g.items }] })) };
  return { body, records, tenant, sampleTraceIds };
}
