#!/usr/bin/env node
/**
 * One OTLP log line per dogfood tick for trace-only SDK examples (java, ruby, go, python).
 * Requires dogfood-env.sh (OTEL_SERVICE_NAME, OWLPANE_INGEST_URL, OWLPANE_INGEST_KEY, OWLPANE_ENVIRONMENT).
 */
const endpoint = (process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").replace(/\/$/, "");
if (!endpoint) {
  console.error("dogfood-emit-log: missing OWLPANE_INGEST_URL / OTEL_EXPORTER_OTLP_ENDPOINT");
  process.exit(1);
}
const service = process.env.OTEL_SERVICE_NAME ?? "owlpane-dogfood";
const env = process.env.OWLPANE_ENVIRONMENT ?? "development";
const headers = { "Content-Type": "application/json" };
const key = (process.env.OWLPANE_INGEST_KEY ?? "").trim();
if (key) headers.Authorization = `Bearer ${key}`;

const body = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: service } },
          { key: "deployment.environment.name", value: { stringValue: env } },
          { key: "telemetry.sdk.language", value: { stringValue: process.env.OWLPANE_DOGFOOD_APP_ID ?? "unknown" } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: "owlpane-dogfood" },
          logRecords: [
            {
              timeUnixNano: String(BigInt(Date.now()) * 1_000_000n),
              severityText: "INFO",
              body: { stringValue: `dogfood log heartbeat (${service})` },
              attributes: [{ key: "owlpane.dogfood", value: { stringValue: "true" } }],
            },
          ],
        },
      ],
    },
  ],
};

const res = await fetch(`${endpoint}/v1/logs`, { method: "POST", headers, body: JSON.stringify(body) });
if (!res.ok) {
  const text = await res.text().catch(() => "");
  console.error(`dogfood-emit-log: POST /v1/logs ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  process.exit(1);
}
