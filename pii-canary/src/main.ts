/**
 * Emits intentional PII-shaped telemetry to verify Owlpane ingest scrub + API read redaction.
 * Requires OWLPANE_ENDPOINT and OWLPANE_INGEST_KEY for a dedicated "pii-canary" project.
 */
import { createServer } from "node:http";
import { trace } from "@opentelemetry/api";
import { logs } from "@opentelemetry/api-logs";
import { owlpane, setUser } from "@owlpane/node";

const PORT = Number(process.env.PII_CANARY_PORT ?? 5199);
const INTERVAL_MS = Number(process.env.PII_CANARY_INTERVAL_MS ?? 30_000);

owlpane.start({
  service: process.env.OTEL_SERVICE_NAME?.trim() || "pii-canary",
  endpoint: process.env.OWLPANE_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT?.trim() || "development",
  release: "pii-canary-0.1.0",
});

const log = logs.getLogger("pii-canary");
const tracer = trace.getTracer("pii-canary");

const FIXTURE_EMAIL = "alice.canary@example.com";
const FIXTURE_CARD = "4111 1111 1111 1111";
const FIXTURE_BEARER = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.leak";

export function emitLeakBatch(): void {
  log.emit({
    severityText: "INFO",
    body: `user login email=${FIXTURE_EMAIL} session ok`,
  });
  log.emit({
    severityText: "WARN",
    body: `payment declined card ${FIXTURE_CARD}`,
  });
  log.emit({
    severityText: "ERROR",
    body: `upstream returned ${FIXTURE_BEARER}`,
  });

  tracer.startActiveSpan("canary.db.lookup", (span) => {
    span.setAttribute(
      "db.statement",
      `SELECT email, phone FROM users WHERE email = '${FIXTURE_EMAIL}' AND id = 42`,
    );
    span.setAttribute("db.system", "postgresql");
    setUser("canary-user-1", { email: FIXTURE_EMAIL, name: "Alice Canary" });
    span.recordException(new Error(`not found: ${FIXTURE_EMAIL}`));
    span.end();
  });
}

if (owlpane.isEnabled()) {
  setInterval(() => emitLeakBatch(), INTERVAL_MS);
  emitLeakBatch();
  console.log(`[pii-canary] emitting every ${INTERVAL_MS}ms to ${process.env.OWLPANE_ENDPOINT}`);
} else {
  console.warn("[pii-canary] OWLPANE_ENDPOINT not set — telemetry disabled (HTTP /emit still runs locally)");
}

createServer((req, res) => {
  if (req.method === "POST" && req.url === "/emit") {
    emitLeakBatch();
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => {
  console.log(`[pii-canary] http://127.0.0.1:${PORT}  POST /emit  GET /healthz`);
});
