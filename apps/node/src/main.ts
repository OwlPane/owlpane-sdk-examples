import {
  owlpane,
  shutdown,
  isEnabled,
  trace,
  metrics,
  SpanKind,
  SpanStatusCode,
  logs,
  SeverityNumber,
} from "@owlpane/node";

// In one-shot CLI mode, flush metrics quickly before shutdown
process.env.OWLPANE_METRICS_EXPORT_INTERVAL_MS ??= "5000";

owlpane.start({
  service: process.env.OTEL_SERVICE_NAME,
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT,
  release: "0.1.8",
});

if (!isEnabled()) {
  console.error("owlpane did not start — check examples/.env");
  process.exit(1);
}

const richMode =
  process.env.OWLPANE_DOGFOOD_MODE === "rich" || process.argv.includes("--rich");
const tracer = trace.getTracer("owlpane-dogfood");
const meter = metrics.getMeter("owlpane-dogfood");
const logger = logs.getLogger("owlpane-dogfood");

const reqCounter = meter.createCounter("owlpane.dogfood.requests", {
  unit: "{request}",
  description: "Dogfood example requests by route and status",
});
const reqDuration = meter.createHistogram("http.server.request.duration", {
  unit: "s",
  description: "HTTP server request duration",
});

await tracer.startActiveSpan(
  "GET /demo",
  {
    kind: SpanKind.SERVER,
    attributes: {
      "http.request.method": "GET",
      "http.route": "/demo",
      "http.response.status_code": 200,
    },
  },
  async (span) => {
    await new Promise((r) => setTimeout(r, 40));
    if (richMode) {
      await tracer.startActiveSpan(
        "SELECT orders",
        {
          kind: SpanKind.CLIENT,
          attributes: {
            "db.system": "postgresql",
            "db.operation.name": "SELECT",
            "db.collection.name": "orders",
          },
        },
        async (dbSpan) => {
          await new Promise((r) => setTimeout(r, 15));
          dbSpan.end();
        },
      );
      logger.emit({
        severityNumber: SeverityNumber.INFO,
        severityText: "INFO",
        body: "Handled GET /demo request with orders lookup",
        attributes: {
          "http.route": "/demo",
          "owlpane.dogfood.mode": "rich",
          "customer.tier": "gold",
        },
      });
      reqCounter.add(1, { "http.route": "/demo", "http.response.status_code": 200 });
      reqDuration.record(0.055, { "http.route": "/demo", "http.response.status_code": 200 });
    }
    span.end();
  },
);

if (richMode) {
  await tracer.startActiveSpan(
    "bullmq.process email.send",
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": "POST",
        "http.route": "/internal/worker",
        "messaging.system": "bullmq",
        "messaging.destination.name": "email",
      },
    },
    async (jobSpan) => {
      await new Promise((r) => setTimeout(r, 12));
      jobSpan.end();
    },
  );

  await tracer.startActiveSpan(
    "POST /checkout",
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": "POST",
        "http.route": "/checkout",
        "http.response.status_code": 500,
      },
    },
    async (errSpan) => {
      const err = new Error("Payment gateway timeout after 1500ms");
      errSpan.recordException(err);
      errSpan.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      logger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: err.message,
        attributes: {
          "http.route": "/checkout",
          "customer.tier": "silver",
          "error.type": "GatewayTimeoutError",
        },
      });
      reqCounter.add(1, { "http.route": "/checkout", "http.response.status_code": 500 });
      reqDuration.record(1.5, { "http.route": "/checkout", "http.response.status_code": 500 });
      errSpan.end();
    },
  );
}

await shutdown();
console.log(
  `span${richMode ? " + metrics + logs" : ""} emitted (${process.env.OTEL_SERVICE_NAME})`,
);
