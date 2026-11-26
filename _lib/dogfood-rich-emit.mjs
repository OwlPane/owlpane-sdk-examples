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
  context,
  logs,
  SeverityNumber,
} = require("@owlpane/node");

process.env.OWLPANE_METRICS_EXPORT_INTERVAL_MS ??= "3000";

const appId = process.env.OWLPANE_DOGFOOD_APP_ID ?? "node";

owlpane.start({
  service: process.env.OTEL_SERVICE_NAME,
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT,
  release: process.env.OWLPANE_SERVICE_VERSION ?? process.env.OWLPANE_SDK_VERSION,
  // This process is Node even when it pretends to be PHP, .NET, or a browser.
  // Leave V8 heap and the event loop to the Node example; those runtimes have neither.
  disableInstrumentations:
    appId === "node" ? undefined : ["@opentelemetry/instrumentation-runtime-node"],
});

if (!isEnabled()) {
  console.error("owlpane did not start — check examples/.env");
  process.exit(1);
}

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

// LLM Insights, Quality and Delivery read gen_ai.* and cicd.* spans. One app each emits them, so volume stays realistic.
const LLM_MODELS = [
  { system: "openai", model: "gpt-4o-mini", inPerTok: 0.15e-6, outPerTok: 0.6e-6 },
  { system: "anthropic", model: "claude-haiku-4-5", inPerTok: 1e-6, outPerTok: 5e-6 },
];

async function emitLlmCalls() {
  await tracer.startActiveSpan(
    "POST /api/assist",
    { kind: SpanKind.SERVER, attributes: { "http.request.method": "POST", "http.route": "/api/assist", "http.response.status_code": 200 } },
    async (req) => {
      for (const m of LLM_MODELS) {
        const input = 400 + Math.floor(Math.random() * 1600);
        const output = 80 + Math.floor(Math.random() * 400);
        const rateLimited = Math.random() < 0.08;
        await tracer.startActiveSpan(
          `chat ${m.model}`,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              "gen_ai.system": m.system,
              "gen_ai.operation.name": "chat",
              "gen_ai.request.model": m.model,
              "gen_ai.response.model": m.model,
              "gen_ai.usage.input_tokens": input,
              "gen_ai.usage.output_tokens": rateLimited ? 0 : output,
              "gen_ai.usage.cost": rateLimited ? 0 : Number((input * m.inPerTok + output * m.outPerTok).toFixed(6)),
            },
          },
          async (call) => {
            await new Promise((r) => setTimeout(r, rateLimited ? 40 : 300 + Math.random() * 900));
            if (rateLimited) {
              call.setAttribute("error.type", "429");
              call.setStatus({ code: SpanStatusCode.ERROR, message: "rate limited" });
            }
            call.end();
          },
        );
      }
      req.end();
    },
  );
}

async function emitPipelineRun() {
  const now = Date.now();
  const failed = Math.random() < 0.2;
  const runId = String(now);
  const tasks = [
    ["build", 95_000],
    ["test", 140_000],
    ["deploy", 45_000],
  ];
  const total = tasks.reduce((s, [, ms]) => s + ms, 0);
  const start = now - total;
  const env = process.env.OWLPANE_ENVIRONMENT || "production";
  const root = tracer.startSpan("pipeline storefront-ci", {
    kind: SpanKind.INTERNAL,
    startTime: start,
    attributes: {
      "cicd.system": "github_actions",
      "cicd.pipeline.name": "storefront-ci",
      "cicd.pipeline.run.id": runId,
      "cicd.pipeline.result": failed ? "failure" : "success",
      "vcs.repository.url.full": "https://github.com/example/storefront",
      "vcs.ref.head.name": "main",
      "vcs.ref.head.revision": Math.random().toString(16).slice(2).padEnd(40, "0").slice(0, 40),
      "vcs.commit.timestamp": start - 120_000,
      ...(failed ? {} : { "owlpane.deploy.environment": env }),
    },
  });
  const ctx = trace.setSpan(context.active(), root);
  let t = start;
  for (const [name, ms] of tasks) {
    // A failed run stops at test, the usual place a pipeline goes red.
    const taskFailed = failed && name === "test";
    if (failed && name === "deploy") break;
    const task = tracer.startSpan(
      `task ${name}`,
      {
        kind: SpanKind.INTERNAL,
        startTime: t,
        attributes: {
          "cicd.pipeline.name": "storefront-ci",
          "cicd.pipeline.run.id": runId,
          "cicd.pipeline.task.name": name,
          "cicd.pipeline.task.run.result": taskFailed ? "failure" : "success",
        },
      },
      ctx,
    );
    if (taskFailed) task.setStatus({ code: SpanStatusCode.ERROR, message: "2 tests failed" });
    t += ms;
    task.end(t);
  }
  if (failed) root.setStatus({ code: SpanStatusCode.ERROR, message: "test failed" });
  root.end(failed ? t : start + total);
}

if (rich && appId === (process.env.OWLPANE_DOGFOOD_LLM_APP ?? "serverless")) await emitLlmCalls();
// About one run every five minutes at the ~45 s dogfood tick.
const ciRate = Number(process.env.OWLPANE_DOGFOOD_CI_RATE ?? "0.15");
if (rich && appId === (process.env.OWLPANE_DOGFOOD_CI_APP ?? "dotnet") && Math.random() < ciRate) await emitPipelineRun();

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
