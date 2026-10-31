#!/usr/bin/env node
/**
 * Preflight crikiq ingest via local port-forward (or any OWLPANE_INGEST_URL).
 *
 *   node scripts/check-saas-ingest.mjs
 *   node scripts/check-saas-ingest.mjs --otlp --otlp-metrics
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const envPath = resolve(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const INGEST = (process.env.OWLPANE_INGEST_URL ?? 'http://127.0.0.1:14318').replace(/\/+$/, '')
const KEY =
  process.env.OWLPANE_INGEST_KEY ??
  process.env.OWLPANE_INGEST_KEY_NODE ??
  process.env.OWLPANE_INGEST_KEY_GO ??
  ''
const otlpTraces = process.argv.includes('--otlp')
const otlpMetrics = process.argv.includes('--otlp-metrics')
const otlpLogs = process.argv.includes('--otlp-logs')

async function healthz() {
  const res = await fetch(`${INGEST}/healthz`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`healthz ${res.status}`)
}

async function probe(path, body) {
  if (!KEY) {
    console.warn(`skip ${path}: set OWLPANE_INGEST_KEY_* in .env`)
    return
  }
  const res = await fetch(`${INGEST}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${path} → ${res.status} (ingest key scopes/env on cell)`)
  }
  if (res.status === 503) {
    const body = await res.text()
    throw new Error(
      `${path} → 503 (ingest key lookup failed — cell Postgres/API unreachable from ingest). Body: ${body.slice(0, 120)}`,
    )
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${path} → ${res.status} ${body.slice(0, 160)}`)
  }
}

try {
  await healthz()
  console.log(`OK  ${INGEST}/healthz`)
  if (otlpTraces) {
    const start = '1000000000000000000'
    await probe('/v1/traces', {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'preflight-traces' } }],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aabbccddeeff00112233445566778899',
                  spanId: '1122334455667788',
                  name: 'preflight GET /healthz',
                  kind: 'SPAN_KIND_SERVER',
                  startTimeUnixNano: start,
                  endTimeUnixNano: String(BigInt(start) + 5_000_000n),
                },
              ],
            },
          ],
        },
      ],
    })
    console.log('OK  POST /v1/traces (auth accepted; sample span for lake preflight)')
  }
  if (otlpMetrics) {
    await probe('/v1/metrics', { resourceMetrics: [] })
    console.log('OK  POST /v1/metrics (auth accepted)')
  }
  if (otlpLogs) {
    await probe('/v1/logs', {
      resourceLogs: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'preflight-logs' } }] },
          scopeLogs: [{ logRecords: [{ body: { stringValue: 'preflight log line' }, severityText: 'INFO' }] }],
        },
      ],
    })
    console.log('OK  POST /v1/logs (auth accepted; triggers telemetry-landed when OWLPANE_API_URL set on ingest)')
  }
} catch (e) {
  console.error(String(e.message ?? e))
  console.error('Fix: ./scripts/saas-ingest-port-forward.sh start  (or watch)')
  process.exit(1)
}
