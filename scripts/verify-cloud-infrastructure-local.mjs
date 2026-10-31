#!/usr/bin/env node
/**
 * Gate for local cloud + AWS library readiness before production.
 *
 * Floci deep path is **AWS-only** (YACE + values-floci-dogfood.yaml). Azure/GCP metrics on laptop
 * are optional static-scrape smoke unless OWLPANE_VERIFY_STRICT_AZURE_GCP=1.
 *
 *   node scripts/verify-cloud-infrastructure-local.mjs
 *   node scripts/verify-cloud-infrastructure-local.mjs --json
 *
 * Run after emit-cloud-dogfood.mjs (~45s) and optional YACE install.
 */
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

const API = (process.env.OWLPANE_API_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '')
const ENV = process.env.OWLPANE_VERIFY_ENV ?? process.env.OWLPANE_ENVIRONMENT ?? 'development'
const MINUTES = process.env.OWLPANE_VERIFY_MINUTES ?? '1440'
const MIN_AWS_SLUG_PCT = Number(process.env.OWLPANE_CLOUD_GATE_MIN_AWS_SLUG_PCT ?? '70')
const jsonOut = process.argv.includes('--json')

const AWS_REQUIRED_METRICS = [
  'owlpane.cloud.cost',
  'cloud.cost',
  'aws_sqs_number_of_messages_sent_sum',
  'aws_sqs_number_of_messages_sent_average',
  'aws_rds_cpuutilization_average',
]

const OPTIONAL_METRICS = ['azure_monitor_available_memory_bytes', 'gcp_compute_instance_cpu_utilization']

const STRICT_AZ_GCP = process.env.OWLPANE_VERIFY_STRICT_AZURE_GCP === '1'
const CLOUD_PROVIDER = (process.env.OWLPANE_VERIFY_CLOUD_PROVIDER ?? '').trim().toLowerCase()

const AWS_CATEGORIES = [
  'AWS SQS Metrics',
  'AWS Aurora Metrics',
  'AWS Valkey',
  'AWS ALB',
  'AWS Cloudwatch RDS Metrics',
]

const catalogPath = resolve(root, '../../api/src/product/dashboard-metrics-catalog.generated.json')

function azMetricsLibrarySqlCompiles() {
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
    const azure = catalog.find((c) => /azure/i.test(c.category ?? '') && (c.logsSql?.length ?? 0) > 0)
    const sql = azure?.logsSql?.[0]?.sql
    if (!sql) return { ok: true, detail: 'no azure logs_sql sample in catalog' }
    const apiRoot = resolve(root, '../../api')
    execFileSync(
      'npx',
      [
        'tsx',
        '-e',
        `import { owlpaneLogsSqlOk } from './src/product/dashboard-library-refine.ts'; if (!owlpaneLogsSqlOk(${JSON.stringify(sql)})) process.exit(2);`,
      ],
      { cwd: apiRoot, stdio: 'pipe' },
    )
    return { ok: true, detail: 'sample Azure az_metrics SQL compiles' }
  } catch (e) {
    const msg = String(e.stderr?.toString?.() ?? e.message ?? e)
    if (msg.includes('Cannot find module') || msg.includes('ENOENT')) {
      return { ok: true, detail: 'az_metrics compile check skipped (run from repo with api deps)' }
    }
    return { ok: false, detail: msg.slice(0, 200) }
  }
}

async function token() {
  if (process.env.OWLPANE_BEARER_TOKEN?.trim()) return process.env.OWLPANE_BEARER_TOKEN.trim()
  const email = process.env.OWLPANE_ONBOARD_EMAIL ?? process.env.OWLPANE_EMAIL
  const password = process.env.OWLPANE_ONBOARD_PASSWORD ?? process.env.OWLPANE_PASSWORD
  if (!email || !password) throw new Error('Set OWLPANE_BEARER_TOKEN or OWLPANE_ONBOARD_EMAIL + PASSWORD')
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message ?? res.statusText)
  return data.token ?? data.accessToken ?? data.sessionToken
}

async function apiGet(bearer, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message ?? `${path} ${res.status}`)
  return data
}

async function metricNames(bearer) {
  const q = new URLSearchParams({ minutes: MINUTES, env: ENV })
  const data = await apiGet(bearer, `/v1/explorer/metrics?${q}`)
  const list = data.metrics ?? data
  const names = new Set()
  for (const m of list) {
    if (typeof m === 'string') names.add(m)
    else if (m?.name) names.add(m.name)
  }
  return names
}

function awsSlugCoverage(live) {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
  const rows = catalog.filter(
    (c) =>
      AWS_CATEGORIES.some((cat) => c.category === cat) ||
      (c.category.startsWith('AWS') && (c.metrics?.length ?? 0) > 0),
  )
  const slugResults = []
  for (const c of rows) {
    const metrics = [...new Set(c.metrics ?? [])]
    if (!metrics.length) continue
    const found = metrics.filter((m) => live.has(m))
    const pct = Math.round((100 * found.length) / metrics.length)
    slugResults.push({ slug: c.slug, category: c.category, pct, found: found.length, total: metrics.length })
  }
  const avg =
    slugResults.length > 0
      ? Math.round(slugResults.reduce((s, r) => s + r.pct, 0) / slugResults.length)
      : 0
  return { avg, slugResults }
}

const checks = []

function record(id, ok, detail, severity = 'required') {
  checks.push({ id, ok, detail, severity })
}

const bearer = await token()
const live = await metricNames(bearer)

for (const m of AWS_REQUIRED_METRICS) {
  const ok = live.has(m)
  record(`metric:${m}`, ok, ok ? 'present' : 'missing in explorer catalog')
}
for (const m of OPTIONAL_METRICS) {
  const present = live.has(m)
  const gateOk = present || !STRICT_AZ_GCP
  record(
    `metric:${m}`,
    gateOk,
    present ? 'present' : STRICT_AZ_GCP ? 'missing (strict mode)' : 'missing (optional smoke)',
    'optional',
  )
}

const { avg, slugResults } = awsSlugCoverage(live)
record(
  'aws-library-slugs-avg',
  avg >= MIN_AWS_SLUG_PCT,
  `${avg}% avg across ${slugResults.length} AWS metric slugs (min ${MIN_AWS_SLUG_PCT}%)`,
)

const azCompile = azMetricsLibrarySqlCompiles()
record('az-metrics-log-sql-compile', azCompile.ok, azCompile.detail)

let cloudResources = 0
try {
  const q = new URLSearchParams({ minutes: MINUTES, env: ENV })
  const cloudPath =
    CLOUD_PROVIDER && ['aws', 'azure', 'gcp'].includes(CLOUD_PROVIDER)
      ? `/v1/infrastructure/cloud?${q}&provider=${CLOUD_PROVIDER}`
      : `/v1/infrastructure/cloud?${q}`
  const cloud = await apiGet(bearer, cloudPath)
  cloudResources = cloud.resources?.length ?? 0
  record('infrastructure-cloud-list', cloudResources >= 1, `${cloudResources} cloud resource row(s)${CLOUD_PROVIDER ? ` provider=${CLOUD_PROVIDER}` : ''}`)
} catch (e) {
  record('infrastructure-cloud-list', false, String(e.message ?? e))
}

const failed = checks.filter((c) => !c.ok && c.severity !== 'optional')
const report = {
  ok: failed.length === 0,
  environment: ENV,
  minutes: MINUTES,
  liveMetricCount: live.size,
  checks,
  awsSlugs: slugResults.sort((a, b) => a.pct - b.pct),
}

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`Cloud infrastructure gate (env=${ENV}, last ${MINUTES}m)\n`)
  for (const c of checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.id}  —  ${c.detail}`)
  }
  console.log(`\n${report.ok ? 'GATE PASSED' : 'GATE FAILED'} (${failed.length} failed)`)
  if (!report.ok) {
    console.log('\nFix AWS gate: run ./scripts/run-local-cloud-dogfood.sh (Floci start aws) or emit-cloud-dogfood.mjs, wait 45s.')
    console.log('     Azure/GCP prod proof: owlpane/api/docs/ops/crikiq-cloud-proof-checklist.md — not Floci tri-cloud.')
    console.log('     Match OWLPANE_ENVIRONMENT (or OWLPANE_VERIFY_ENV) to ingest keys — see .env.example.')
  }
}

process.exit(report.ok ? 0 : 1)
