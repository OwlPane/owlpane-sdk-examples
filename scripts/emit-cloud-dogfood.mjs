#!/usr/bin/env node
/**
 * Full local cloud dogfood emitter: infrastructure catalog + all AWS library metric names.
 *
 *   OWLPANE_ENVIRONMENT=production node scripts/emit-cloud-dogfood.mjs
 *
 * Pair with run-local-cloud-dogfood.sh (background) + verify-cloud-infrastructure-local.mjs
 */
import { metrics } from '@opentelemetry/api'
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

const catalogPath = resolve(root, '../../api/src/product/dashboard-metrics-catalog.generated.json')
const dogfoodPath = resolve(__dir, 'dashboard-dogfood-metrics.json')

function loadAwsMetricsFromCatalog() {
  if (!existsSync(catalogPath)) return []
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const names = new Set()
  for (const entry of catalog) {
    const cat = String(entry.category ?? '')
    if (!/^AWS/i.test(cat) && !cat.includes('AWS')) continue
    for (const m of entry.metrics ?? []) if (String(m).startsWith('aws_')) names.add(m)
  }
  return [...names]
}

function loadDogfoodAws() {
  const dogfood = JSON.parse(readFileSync(dogfoodPath, 'utf8'))
  const names = new Set()
  for (const [cat, list] of Object.entries(dogfood.byCategory ?? {})) {
    if (/^AWS/i.test(cat) || cat === 'AWS') for (const m of list) names.add(m)
  }
  return [...names]
}

const AWS_METRICS = [...new Set([...loadDogfoodAws(), ...loadAwsMetricsFromCatalog()])]

const EXTRA = [
  { name: 'owlpane.cloud.cost', value: 42.5, attrs: { 'cloud.provider': 'aws', 'cloud.region': 'us-east-1', currency: 'USD' } },
  { name: 'cloud.cost', value: 18.2, attrs: { 'cloud.provider': 'gcp', 'cloud.region': 'us-central1', currency: 'USD' } },
  {
    name: 'azure_monitor_available_memory_bytes',
    value: 4e9,
    attrs: { 'cloud.provider': 'azure', 'cloud.region': 'eastus', 'cloud.platform': 'azure_vm' },
  },
  {
    name: 'gcp_compute_instance_cpu_utilization',
    value: 0.34,
    attrs: { 'cloud.provider': 'gcp', 'cloud.region': 'us-central1', 'cloud.platform': 'gcp_compute' },
  },
]

owlpane.start({
  service: 'owlpane-cloud-dogfood',
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY_NODE ?? process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT ?? 'production',
  release: 'cloud-dogfood-1',
})

if (!isEnabled()) {
  console.error('Set OWLPANE_INGEST_URL and OWLPANE_INGEST_KEY_NODE in examples/.env')
  process.exit(1)
}

const meter = metrics.getMeter('owlpane-cloud-dogfood')
let t = 0
const wave = () => {
  t += 1
  return 1 + 0.12 * Math.sin(t / 6)
}

const envAttr = { 'deployment.environment.name': process.env.OWLPANE_ENVIRONMENT ?? 'production' }

for (const name of AWS_METRICS) {
  const base = name.includes('latency') ? 0.05 : name.includes('percent') || name.includes('ratio') ? 0.4 : 1200
  meter.createObservableGauge(name, (obs) => {
    obs.observe(base * wave(), {
      ...envAttr,
      'cloud.provider': 'aws',
      'cloud.region': process.env.OWLPANE_DOGFOOD_REGION ?? 'us-east-1',
      'cloud.platform': name.includes('sqs') ? 'aws_sqs' : name.includes('rds') ? 'aws_rds' : 'aws_ec2',
      queue: 'owlpane-dogfood',
    })
  })
}

for (const s of EXTRA) {
  meter.createObservableGauge(s.name, (obs) => {
    obs.observe(s.value * wave(), { ...envAttr, ...s.attrs })
  })
}

console.log(
  `Cloud dogfood: ${AWS_METRICS.length} aws_* + ${EXTRA.length} catalog/infra metrics → ${process.env.OWLPANE_INGEST_URL} env=${process.env.OWLPANE_ENVIRONMENT}`,
)
console.log('Leave running; run verify-cloud-infrastructure-local.mjs after ~45s.')

process.on('SIGINT', async () => {
  await shutdown()
  process.exit(0)
})

setInterval(() => {}, 60_000)
