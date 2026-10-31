#!/usr/bin/env node
/**
 * Shared rich dogfood burst (traces + runtime metrics) for rust / php / dotnet examples.
 * Requires dogfood-env.sh to export OTEL_* and OWLPANE_INGEST_*.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const nodePkg = join(here, "../apps/node/package.json");
const require = createRequire(nodePkg);
const {
  owlpane,
  shutdown,
  isEnabled,
  trace,
  metrics,
  SpanKind,
  SpanStatusCode,
  logs,
  SeverityNumber,
} = require("@owlpane/node");

process.env.OWLPANE_METRICS_EXPORT_INTERVAL_MS ??= "3000";

owlpane.start({
  service: process.env.OTEL_SERVICE_NAME,
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT,
  release: process.env.OWLPANE_SERVICE_VERSION ?? process.env.OWLPANE_SDK_VERSION,
});

if (!isEnabled()) {
  console.error("owlpane did not start — check examples/.env");
  process.exit(1);
}

const appId = process.env.OWLPANE_DOGFOOD_APP_ID ?? "node";
const rich = process.env.OWLPANE_DOGFOOD_MODE === "rich" || process.argv.includes("--rich");
const tracer = trace.getTracer("owlpane-dogfood");
const meter = metrics.getMeter("owlpane-dogfood");

const demoAttrs = { "http.request.method": "GET", "http.route": "/demo", "http.response.status_code": 200 };
if (appId === "php") {
  demoAttrs["laravel.route"] = "api/products.index";
  demoAttrs["php.framework"] = "laravel";
}
if (appId === "serverless") {
  demoAttrs["faas.name"] = "owlpane-dogfood-fn";
  demoAttrs["faas.trigger"] = "http";
  demoAttrs["cloud.provider"] = "aws";
}
if (appId === "react-native") {
  demoAttrs["screen.name"] = "Home";
}
if (appId === "browser") {
  demoAttrs["browser.page.path"] = "/demo";
  demoAttrs["url.full"] = "http://localhost:5173/demo";
}

const rootName =
  appId === "react-native"
    ? "screen.load Home"
    : appId === "browser"
      ? "documentLoad /demo"
      : appId === "serverless"
        ? "owlpane-dogfood-fn"
        : "GET /demo";
const rootKind =
  appId === "react-native" || appId === "browser" ? SpanKind.INTERNAL : SpanKind.SERVER;
await tracer.startActiveSpan(rootName, { kind: rootKind, attributes: demoAttrs }, async (span) => {
  await new Promise((r) => setTimeout(r, 35));
  if (rich) {
    await tracer.startActiveSpan(
      "SELECT catalog",
      {
        kind: SpanKind.CLIENT,
        attributes: { "db.system": "mysql", "peer.service": "mysql-primary" },
      },
      async (db) => {
        await new Promise((r) => setTimeout(r, 12));
        db.end();
      },
    );
    if (appId === "php") {
      await tracer.startActiveSpan(
        "horizon.process OrderShipped",
        {
          kind: SpanKind.CONSUMER,
          attributes: { "messaging.system": "redis", "laravel.queue": "default", "job.name": "OrderShipped" },
        },
        async (job) => {
          await new Promise((r) => setTimeout(r, 8));
          job.end();
        },
      );
    }
  }
  span.end();
});

if (rich && appId !== "php") {
  await tracer.startActiveSpan(
    "worker.process dogfood",
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": "POST",
        "http.route": "/internal/worker",
        "messaging.system": appId === "dotnet" ? "hangfire" : appId === "rust" ? "redis" : "sqs",
        "messaging.destination.name": "dogfood-jobs",
      },
    },
    async (job) => {
      await new Promise((r) => setTimeout(r, 10));
      job.end();
    },
  );
}

if (rich) {
  await tracer.startActiveSpan(
    "POST /checkout",
    {
      kind: SpanKind.SERVER,
      attributes: { "http.request.method": "POST", "http.route": "/checkout", "http.response.status_code": 500 },
    },
    async (errSpan) => {
      const err = new Error(`${appId} dogfood checkout failure`);
      errSpan.recordException(err);
      errSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      errSpan.end();
    },
  );

  const gaugesByApp = {
    go: [
      "process.cpu.utilization",
      "process.memory.usage",
      "process.runtime.go.goroutines",
      "process.runtime.go.gc.count",
      "go.memory.heap.alloc",
      "go.memory.heap.sys",
    ],
    rust: [
      "process.cpu.utilization",
      "process.memory.usage",
      "process.runtime.rust.threads",
      "process.runtime.rust.memory.usage",
    ],
    php: [
      "process.cpu.utilization",
      "process.memory.usage",
      "process.runtime.php.memory.usage",
      "process.runtime.php.memory.limit",
    ],
    dotnet: [
      "process.cpu.utilization",
      "process.memory.usage",
      "process.runtime.dotnet.thread.count",
      "process.runtime.dotnet.gc.heap.size",
      "process.runtime.dotnet.gc.collections.count",
    ],
    "react-native": ["process.cpu.utilization", "process.memory.usage"],
    serverless: ["process.cpu.utilization", "process.memory.usage"],
  };
  const gauges = gaugesByApp[appId] ?? ["process.cpu.utilization", "process.memory.usage"];
  for (const name of gauges) {
    const g = meter.createObservableGauge(name);
    g.addCallback((obs) => {
      const v =
        name.includes("goroutines") ? 48 + Math.floor(Math.random() * 20)
        : name.includes("thread") ? 12 + Math.floor(Math.random() * 6)
        : name.includes("gc.count") || name.includes("collections") ? 40 + Math.floor(Math.random() * 30)
        : name.includes("memory") || name.includes("heap") ? 50_000_000 + Math.random() * 10_000_000
        : name.includes("limit") ? 128_000_000
        : 0.18 + Math.random() * 0.12;
      obs.observe(v);
    });
  }
  const waitMs = Math.max(0, Number(process.env.OWLPANE_DOGFOOD_METRICS_WAIT_MS ?? "6500") || 6500);
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
}

logs.getLogger("owlpane-dogfood").emit({
  severityNumber: SeverityNumber.INFO,
  body: `dogfood log heartbeat (${process.env.OTEL_SERVICE_NAME})`,
  attributes: { "owlpane.dogfood": "true" },
});

async function flushOtel() {
  const tp = trace.getTracerProvider();
  const mp = metrics.getMeterProvider();
  if (tp && typeof tp.forceFlush === "function") await tp.forceFlush().catch(() => undefined);
  if (mp && typeof mp.forceFlush === "function") await mp.forceFlush().catch(() => undefined);
}
await flushOtel();
await new Promise((r) => setTimeout(r, 1200));

await shutdown();
console.log(`dogfood emitted (${process.env.OTEL_SERVICE_NAME}, ${appId})`);
