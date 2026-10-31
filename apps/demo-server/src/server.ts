import http from "node:http";
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

process.env.OWLPANE_METRICS_EXPORT_INTERVAL_MS ??= "5000";

owlpane.start({
  service: process.env.OTEL_SERVICE_NAME ?? "owlpane-demo-server",
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT ?? "development",
  release: "0.1.8",
});

if (!isEnabled()) {
  console.error("owlpane demo-server did not start — check examples/.env");
  process.exit(1);
}

const tracer = trace.getTracer("owlpane-demo-server");
const meter = metrics.getMeter("owlpane-demo-server");
const logger = logs.getLogger("owlpane-demo-server");

const reqCounter = meter.createCounter("owlpane.demo.requests", {
  unit: "{request}",
  description: "Demo server requests by route and status",
});
const latencyHist = meter.createHistogram("http.server.request.duration", {
  unit: "s",
  description: "Simulated HTTP request latency",
});

let tick = 0;

async function emitSyntheticCycle(): Promise<void> {
  tick += 1;
  const isError = tick % 5 === 0;
  const route = isError ? "/api/checkout" : "/api/orders";
  const status = isError ? 500 : 200;
  const durationSec = isError ? 0.42 : 0.035;

  await tracer.startActiveSpan(
    `${isError ? "POST" : "GET"} ${route}`,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": isError ? "POST" : "GET",
        "http.route": route,
        "http.response.status_code": status,
      },
    },
    async (span) => {
      await tracer.startActiveSpan(
        "SELECT orders WHERE tenant_id = $1",
        {
          kind: SpanKind.CLIENT,
          attributes: {
            "db.system": "postgresql",
            "db.operation.name": "SELECT",
          },
        },
        async (dbSpan) => {
          await new Promise((r) => setTimeout(r, 12));
          dbSpan.end();
        },
      );

      if (isError) {
        const err = new Error(`Downstream payment provider 503 on tick #${tick}`);
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
        logger.emit({
          severityNumber: SeverityNumber.ERROR,
          severityText: "ERROR",
          body: err.message,
          attributes: { "http.route": route, tick, "customer.tier": "silver" },
        });
      } else {
        logger.emit({
          severityNumber: SeverityNumber.INFO,
          severityText: "INFO",
          body: `Processed ${route} (tick #${tick})`,
          attributes: { "http.route": route, tick, "customer.tier": tick % 2 === 0 ? "gold" : "silver" },
        });
      }

      reqCounter.add(1, { "http.route": route, "http.response.status_code": status });
      latencyHist.record(durationSec, { "http.route": route, "http.response.status_code": status });
      span.end();
    },
  );
}

const port = Number(process.env.DEMO_SERVER_PORT || 4399);
const bindHost = process.env.DEMO_BIND_HOST || "127.0.0.1";
const server = http.createServer(async (req, res) => {
  await emitSyntheticCycle();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, tick, url: req.url }));
});

const intervalMs = Number(process.env.DEMO_INTERVAL_MS || 3000);
const timer = setInterval(() => {
  void emitSyntheticCycle();
}, intervalMs);

server.listen(port, bindHost, () => {
  console.log(
    `Owlpane demo-server listening on http://${bindHost}:${port} (emitting traces, metrics, and logs every ${intervalMs}ms)`,
  );
  void emitSyntheticCycle();
});

const stop = async () => {
  clearInterval(timer);
  server.close();
  await shutdown();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
