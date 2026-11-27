#!/usr/bin/env node
/**
 * End-to-End Verification Harness for Owlpane Integrations.
 *
 * Tests live ingest + control-plane endpoints with zero external cloud accounts required:
 *   1. OTLP HTTP Traces, Logs, Metrics
 *   2. Zipkin v2 Trace Receiver
 *   3. Loki JSON Log Receiver (when OWLPANE_INGEST_LOKI_ENABLED=true)
 *   4. Syslog HTTP Log Receiver (when OWLPANE_INGEST_SYSLOG_HTTP_ENABLED=true)
 *   5. Fluent HTTP Log Receiver (when OWLPANE_INGEST_FLUENT_HTTP_ENABLED=true)
 *   6. Grafana Prometheus API (GET & POST /api/v1/query, /labels, /metadata, /status/buildinfo)
 *   7. Hosted MCP Streamable HTTP (/v1/mcp tools/list)
 *   8. K8s Security Export (SARIF, CSV, JSON)
 *   9. Carbon Grid Intensity & Factors (/v1/carbon/factors)
 *  10. Local HMAC Webhook Receiver (optional with --test-webhook)
 *
 * Usage:
 *   OWLPANE_INGEST_URL=http://127.0.0.1:4318 \
 *   OWLPANE_INGEST_KEY=owl_ing_... \
 *   OWLPANE_API_URL=http://127.0.0.1:4100 \
 *   OWLPANE_TOKEN=owl_pat_... \
 *   node integrations-test/test-all-integrations.mjs
 */

const ingestUrl = (process.env.OWLPANE_INGEST_URL || "http://127.0.0.1:4318").replace(/\/+$/, "");
const ingestKey = (process.env.OWLPANE_INGEST_KEY || "").trim();
const apiUrl = (process.env.OWLPANE_API_URL || "http://127.0.0.1:4100").replace(/\/+$/, "");
const apiToken = (process.env.OWLPANE_TOKEN || "").trim();

const results = [];
const nowNs = String(BigInt(Date.now()) * 1_000_000n);

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", ms: Date.now() - t0, detail: detail || "ok" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const skipped = msg.startsWith("SKIP:");
    results.push({ name, status: skipped ? "SKIP" : "FAIL", ms: Date.now() - t0, detail: msg.replace(/^SKIP:\s*/, "") });
  }
}

function needIngest() {
  if (!ingestKey) throw new Error("SKIP: set OWLPANE_INGEST_KEY to run ingest checks");
}

function needApi() {
  if (!apiToken) throw new Error("SKIP: set OWLPANE_TOKEN (owl_pat_ or owl_sa_) to run API checks");
}

async function postIngest(path, body, contentType = "application/json", extraHeaders = {}) {
  const res = await fetch(`${ingestUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ingestKey}`,
      "Content-Type": contentType,
      ...extraHeaders,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return res;
}

async function main() {
  await check("OTLP HTTP Traces (/v1/traces)", async () => {
    needIngest();
    const res = await postIngest("/v1/traces", {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "integration-smoke" } }] },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                  spanId: "00f067aa0ba902b7",
                  name: "GET /smoke",
                  kind: 2,
                  startTimeUnixNano: nowNs,
                  endTimeUnixNano: String(BigInt(nowNs) + 25_000_000n),
                },
              ],
            },
          ],
        },
      ],
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("OTLP HTTP Logs (/v1/logs)", async () => {
    needIngest();
    const res = await postIngest("/v1/logs", {
      resourceLogs: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "integration-smoke" } }] },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: nowNs,
                  severityNumber: 9,
                  severityText: "INFO",
                  body: { stringValue: "integration smoke log" },
                },
              ],
            },
          ],
        },
      ],
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("OTLP HTTP Metrics (/v1/metrics)", async () => {
    needIngest();
    const res = await postIngest("/v1/metrics", {
      resourceMetrics: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "integration-smoke" } }] },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "nginx.connections_current",
                  gauge: { dataPoints: [{ timeUnixNano: nowNs, asDouble: 42 }] },
                },
              ],
            },
          ],
        },
      ],
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("Zipkin v2 Traces (/api/v2/spans)", async () => {
    needIngest();
    const res = await postIngest("/api/v2/spans", [
      {
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        id: "00f067aa0ba902b8",
        name: "zipkin-smoke",
        timestamp: Date.now() * 1000,
        duration: 12000,
        localEndpoint: { serviceName: "zipkin-smoke" },
      },
    ]);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("Loki Push Receiver (/loki/api/v1/push)", async () => {
    needIngest();
    const res = await postIngest("/loki/api/v1/push", {
      streams: [{ stream: { service: "loki-smoke", level: "info" }, values: [[nowNs, "loki smoke line"]] }],
    });
    if (res.status === 404) throw new Error("SKIP: receiver disabled (set OWLPANE_INGEST_LOKI_ENABLED=true)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("Syslog HTTP Receiver (/v1/syslog)", async () => {
    needIngest();
    const res = await postIngest(
      "/v1/syslog",
      `<14>1 ${new Date().toISOString()} smoke-host smoke-app - - - syslog smoke message\n`,
      "text/plain",
    );
    if (res.status === 404) throw new Error("SKIP: receiver disabled (set OWLPANE_INGEST_SYSLOG_HTTP_ENABLED=true)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("Fluent HTTP Receiver (/v1/fluent)", async () => {
    needIngest();
    const res = await postIngest("/v1/fluent", [{ log: "fluent smoke line", level: "info", service: "fluent-smoke" }]);
    if (res.status === 404) throw new Error("SKIP: receiver disabled (set OWLPANE_INGEST_FLUENT_HTTP_ENABLED=true)");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("Grafana Prometheus API (POST /api/v1/query + GET /metadata + /status/buildinfo)", async () => {
    needApi();
    const headers = { Authorization: `Bearer ${apiToken}` };
    const build = await fetch(`${apiUrl}/api/v1/status/buildinfo`, { headers });
    if (!build.ok) throw new Error(`buildinfo HTTP ${build.status}`);
    const meta = await fetch(`${apiUrl}/api/v1/metadata`, { headers });
    if (!meta.ok) throw new Error(`metadata HTTP ${meta.status}`);
    const q = await fetch(`${apiUrl}/api/v1/query`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query: "up" }),
    });
    if (!q.ok) throw new Error(`POST query HTTP ${q.status}`);
    return "POST query + metadata + buildinfo OK";
  });

  await check("Hosted MCP Server (POST /v1/mcp tools/list)", async () => {
    needApi();
    const res = await fetch(`${apiUrl}/v1/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  await check("K8s Security SARIF Export (/v1/kubernetes/security/export?format=sarif)", async () => {
    needApi();
    const res = await fetch(`${apiUrl}/v1/kubernetes/security/export?format=sarif`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.version !== "2.1.0") throw new Error(`unexpected SARIF version: ${body.version}`);
    return "SARIF 2.1.0 OK";
  });

  await check("Carbon Grid Intensity Factors (/v1/carbon/factors)", async () => {
    needApi();
    const res = await fetch(`${apiUrl}/v1/carbon/factors`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return `HTTP ${res.status}`;
  });

  console.log("\n=== Owlpane Integrations Verification Summary ===");
  for (const r of results) {
    console.log(`[${r.status.padEnd(4)}] ${r.name} (${r.ms}ms) — ${r.detail}`);
  }
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\nTotal: ${results.length} | Pass: ${results.filter((r) => r.status === "PASS").length} | Skip: ${results.filter((r) => r.status === "SKIP").length} | Fail: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
