#!/usr/bin/env node
/**
 * Emit OTLP logs for the az_metrics virtual Log SQL table (Azure library dashboards).
 *
 *   node scripts/emit-az-metrics-log-dogfood.mjs
 *
 * Run alongside emit-cloud-dogfood.mjs (separate service name: azure-metrics).
 */
import { logs, SeverityNumber } from '@opentelemetry/api-logs'
import { owlpane, isEnabled, shutdown } from '@owlpane/node'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
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

const METRIC_NAMES = [
  'ByteCount',
  'PacketCount',
  'RequestCount',
  'OriginHealthPercentage',
  'AvailableMemoryBytes',
  'CpuPercentage',
]

owlpane.start({
  service: 'azure-metrics',
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY_NODE ?? process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT ?? 'production',
  release: 'az-metrics-log-dogfood-1',
})

if (!isEnabled()) {
  console.error('Set OWLPANE_INGEST_URL and OWLPANE_INGEST_KEY_NODE in examples/.env')
  process.exit(1)
}

const logger = logs.getLogger('azure-metrics')
let tick = 0

const emitWave = () => {
  tick += 1
  for (const metricname of METRIC_NAMES) {
    const maximum =
      metricname === 'OriginHealthPercentage'
        ? 85 + 10 * Math.sin(tick / 8)
        : Math.floor(500 + 200 * Math.sin(tick / 5 + metricname.length))
    logger.emit({
      body: `Azure Monitor metric ${metricname}`,
      severityNumber: SeverityNumber.INFO,
      attributes: {
        metricname,
        maximum,
        'cloud.provider': 'azure',
        'cloud.region': process.env.OWLPANE_DOGFOOD_AZURE_REGION ?? 'eastus',
      },
    })
  }
}

emitWave()
const intervalMs = Number(process.env.AZ_METRICS_EMIT_MS ?? '5000')
const handle = setInterval(emitWave, intervalMs)

console.log(
  `az_metrics log dogfood: ${METRIC_NAMES.length} metric names every ${intervalMs}ms → ${process.env.OWLPANE_INGEST_URL} service=azure-metrics env=${process.env.OWLPANE_ENVIRONMENT}`,
)

process.on('SIGINT', async () => {
  clearInterval(handle)
  await shutdown()
  process.exit(0)
})

setInterval(() => {}, 60_000)
