#!/usr/bin/env node
/**
 * Emit synthetic gauge metrics named like OpenObserve library dashboards (Redis, K8s nodes, etc.)
 * so installed dashboards show charts in local/SaaS dogfood. Uses examples/.env ingest key (node project).
 *
 *   node scripts/emit-dashboard-library-metrics.mjs
 *   node scripts/emit-dashboard-library-metrics.mjs --category ArgoCD
 *   node scripts/emit-dashboard-library-metrics.mjs --from-catalog
 *   node scripts/emit-dashboard-library-metrics.mjs --from-catalog --tier1
 *
 * Metric list: dashboard-dogfood-metrics.json (coverage: owlpane/api → npm run report:library-coverage)
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

const manifest = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'dashboard-dogfood-metrics.json'), 'utf8'))
const BY_CATEGORY = manifest.byCategory

const fromCatalog = process.argv.includes('--from-catalog')
const tier1Only = process.argv.includes('--tier1')
const categoryArg = process.argv.find((a, i) => process.argv[i - 1] === '--category') ?? process.env.OWLPANE_DOGFOOD_CATEGORY

const catalogPath = resolve(root, '../../api/src/product/dashboard-metrics-catalog.generated.json')

function tier1CatalogEntry(entry) {
  const { category, slug } = entry
  if (/kubernetes|argocd/i.test(category)) return true
  if (/^Owlpane$/i.test(category)) return true
  return /^owl-(owlpane|kubernetes|argocd)-/i.test(slug)
}

function metricsFromCatalog() {
  if (!existsSync(catalogPath)) {
    console.error(`Missing ${catalogPath} — run: cd owlpane/api && npm run build:starter-catalog`)
    process.exit(1)
  }
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const max = Number(process.env.OWLPANE_DOGFOOD_MAX_METRICS ?? '800')
  const names = new Set()
  for (const entry of catalog) {
    if (tier1Only && !tier1CatalogEntry(entry)) continue
    for (const m of entry.metrics ?? []) names.add(m)
  }
  const list = [...names].sort()
  if (list.length > max) {
    console.warn(`Catalog has ${list.length} unique metrics; emitting first ${max} (raise OWLPANE_DOGFOOD_MAX_METRICS)`)
    return list.slice(0, max)
  }
  return list
}

owlpane.start({
  service: 'owlpane-dashboard-dogfood',
  endpoint: process.env.OWLPANE_INGEST_URL ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  ingestKey: process.env.OWLPANE_INGEST_KEY_NODE ?? process.env.OWLPANE_INGEST_KEY,
  environment: process.env.OWLPANE_ENVIRONMENT ?? 'development',
  release: 'dashboard-dogfood-1',
})

if (!isEnabled()) {
  console.error('Set OWLPANE_INGEST_URL and OWLPANE_INGEST_KEY_NODE in examples/.env')
  process.exit(1)
}

const meter = metrics.getMeter('owlpane-dashboard-dogfood')
const cluster = process.env.OWLPANE_DOGFOOD_CLUSTER ?? 'k3s-cluster'
const node = process.env.OWLPANE_DOGFOOD_NODE ?? 'node-a'

const ALL = [...new Set(Object.values(BY_CATEGORY).flat())]

function gaugesForRun() {
  if (fromCatalog) return metricsFromCatalog()
  if (!categoryArg) return ALL
  const key = Object.keys(BY_CATEGORY).find(
    (k) => k.toLowerCase() === categoryArg.toLowerCase() || k.includes(categoryArg) || categoryArg.includes(k),
  )
  if (!key) {
    console.error(`Unknown --category ${categoryArg}. Known: ${Object.keys(BY_CATEGORY).join(', ')}`)
    process.exit(1)
  }
  return BY_CATEGORY[key]
}

const GAUGES = gaugesForRun()

const attrs = {
  'k8s.cluster.name': cluster,
  'k8s.node.name': node,
  'deployment.environment.name': process.env.OWLPANE_ENVIRONMENT ?? 'development',
  direction: 'receive',
  state: 'used',
  namespace: 'argocd',
  dest_server: 'https://kubernetes.default.svc',
  health_status: 'Healthy',
  sync_status: 'Synced',
}

let t = 0
for (const name of GAUGES) {
  const wave = () => {
    t += 1
    return 1 + 0.15 * Math.sin(t / 8)
  }
  const base = name.includes('ratio') ? 1.05 : name.includes('uptime') ? 86400 : name.startsWith('argocd_') ? 12 : 1_000_000
  if (name.endsWith('_total') || name.endsWith('_count') || name.endsWith('_sum')) {
    const counter = meter.createCounter(name)
    setInterval(() => counter.add(Math.max(1, Math.round(base * wave())), attrs), 5000)
    continue
  }
  meter.createObservableGauge(name, (obs) => {
    obs.observe(base * wave(), attrs)
  })
}

const mode = fromCatalog ? (tier1Only ? 'catalog:tier1' : 'catalog:full') : categoryArg ?? 'all categories'
console.log(
  `Emitting ${GAUGES.length} library metrics (${mode}) → ${process.env.OWLPANE_INGEST_URL} env=${process.env.OWLPANE_ENVIRONMENT}`,
)
console.log('Press Ctrl+C to stop. Re-open dashboards after ~30s for catalog refresh.')

process.on('SIGINT', async () => {
  await shutdown()
  process.exit(0)
})

setInterval(() => {}, 60_000)
