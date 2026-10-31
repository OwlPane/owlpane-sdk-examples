#!/usr/bin/env node
/**
 * Quick infrastructure catalog smoke (Cloud cost, Azure catalog, AWS/GCP cloud list).
 * Does not replace Floci + cloudScrapes — use alongside floci-dashboard-harness.sh.
 *
 *   cd owlpane/sdk/examples
 *   OWLPANE_INGEST_URL=… OWLPANE_INGEST_KEY_NODE=… OWLPANE_ENVIRONMENT=production \
 *     node scripts/emit-infrastructure-smoke.mjs
 */
import { metrics } from '@opentelemetry/api'
import { owlpane, isEnabled, shutdown } from '@owlpane/node'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

owlpane.start({
  service: 'owlpane-infra-smoke',
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY_NODE ?? process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT ?? 'production',
  release: 'infra-smoke-1',
})

if (!isEnabled()) {
  console.error('Set OWLPANE_INGEST_URL and OWLPANE_INGEST_KEY_NODE in examples/.env')
  process.exit(1)
}

const meter = metrics.getMeter('owlpane-infra-smoke')
let t = 0
const wave = () => {
  t += 1
  return 1 + 0.12 * Math.sin(t / 6)
}

const samples = [
  {
    name: 'owlpane.cloud.cost',
    value: 42.5,
    attrs: {
      'cloud.provider': 'aws',
      'cloud.region': 'us-east-1',
      'cloud.platform': 'aws_ec2',
      currency: 'USD',
    },
  },
  {
    name: 'cloud.cost',
    value: 18.2,
    attrs: {
      'cloud.provider': 'gcp',
      'cloud.region': 'us-central1',
      'cloud.platform': 'gcp_compute',
      currency: 'USD',
    },
  },
  {
    name: 'aws_sqs_number_of_messages_sent_sum',
    value: 1200,
    attrs: {
      'cloud.provider': 'aws',
      'cloud.region': 'us-east-1',
      'cloud.platform': 'aws_sqs',
      queue: 'floci-test',
    },
  },
  {
    name: 'azure_monitor_available_memory_bytes',
    value: 4e9,
    attrs: {
      'cloud.provider': 'azure',
      'cloud.region': 'eastus',
      'cloud.platform': 'azure_vm',
    },
  },
  {
    name: 'gcp_compute_instance_cpu_utilization',
    value: 0.34,
    attrs: {
      'cloud.provider': 'gcp',
      'cloud.region': 'us-central1',
      'cloud.platform': 'gcp_compute',
    },
  },
]

for (const s of samples) {
  meter.createObservableGauge(s.name, (obs) => {
    obs.observe(s.value * wave(), {
      'deployment.environment.name': process.env.OWLPANE_ENVIRONMENT ?? 'production',
      ...s.attrs,
    })
  })
}

console.log(
  `Emitting ${samples.length} infrastructure smoke metrics → ${process.env.OWLPANE_INGEST_URL} env=${process.env.OWLPANE_ENVIRONMENT}`,
)
console.log('Check: Catalog → Cloud cost / Azure; Infrastructure → Cloud (AWS/GCP). Ctrl+C to stop.')

process.on('SIGINT', async () => {
  await shutdown()
  process.exit(0)
})

setInterval(() => {}, 60_000)
