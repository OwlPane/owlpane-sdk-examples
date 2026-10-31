#!/usr/bin/env node
/**
 * After emit-dashboard-library-metrics.mjs: check which catalog metrics exist in the tenant (live API).
 *
 *   cd owlpane/sdk/examples
 *   node scripts/verify-library-metrics-local.mjs
 *   node scripts/verify-library-metrics-local.mjs --category ArgoCD
 *   node scripts/verify-library-metrics-local.mjs --slug owl-argocd-argocd-monitoring
 *
 * Env: OWLPANE_API_URL, OWLPANE_ONBOARD_EMAIL/PASSWORD (or OWLPANE_BEARER_TOKEN), optional OWLPANE_ENVIRONMENT
 */
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

const API = (process.env.OWLPANE_API_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '')
const catalogPath = resolve(root, '../../api/src/product/dashboard-metrics-catalog.generated.json')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))

const categoryArg = process.argv.includes('--category')
  ? process.argv[process.argv.indexOf('--category') + 1]
  : process.env.OWLPANE_VERIFY_CATEGORY
const slugArg = process.argv.includes('--slug') ? process.argv[process.argv.indexOf('--slug') + 1] : undefined
const minutes = process.env.OWLPANE_VERIFY_MINUTES ?? '1440'
const envQ = process.env.OWLPANE_ENVIRONMENT ?? ''

async function token() {
  if (process.env.OWLPANE_BEARER_TOKEN?.trim()) return process.env.OWLPANE_BEARER_TOKEN.trim()
  const email = process.env.OWLPANE_ONBOARD_EMAIL ?? process.env.OWLPANE_EMAIL
  const password = process.env.OWLPANE_ONBOARD_PASSWORD ?? process.env.OWLPANE_PASSWORD
  if (!email || !password) throw new Error('Set OWLPANE_BEARER_TOKEN or OWLPANE_ONBOARD_EMAIL + PASSWORD in .env')
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message ?? res.statusText)
  return data.token ?? data.accessToken ?? data.sessionToken
}

async function metricNames(bearer) {
  const q = new URLSearchParams({ minutes })
  if (envQ) q.set('env', envQ)
  const res = await fetch(`${API}/v1/explorer/metrics?${q}`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message ?? res.statusText)
  const list = data.metrics ?? data
  const names = new Set()
  for (const m of list) {
    if (typeof m === 'string') names.add(m)
    else if (m?.name) names.add(m.name)
  }
  return names
}

function entries() {
  let rows = catalog
  if (slugArg) rows = rows.filter((c) => c.slug === slugArg)
  if (categoryArg) {
    const lower = categoryArg.toLowerCase()
    rows = rows.filter((c) => c.category.toLowerCase().includes(lower) || lower.includes(c.category.toLowerCase()))
  }
  return rows
}

const bearer = await token()
const live = await metricNames(bearer)
const rows = entries()

let need = 0
let hit = 0
const slugResults = []

for (const c of rows) {
  const metrics = [...new Set(c.metrics)]
  if (!metrics.length) {
    slugResults.push({ slug: c.slug, category: c.category, pct: null, note: `${c.logsSql.length} logs_sql only` })
    continue
  }
  const found = metrics.filter((m) => live.has(m))
  need += metrics.length
  hit += found.length
  const pct = Math.round((100 * found.length) / metrics.length)
  slugResults.push({
    slug: c.slug,
    category: c.category,
    pct,
    found: found.length,
    total: metrics.length,
    missing: metrics.filter((m) => !live.has(m)).slice(0, 5),
  })
}

slugResults.sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1))

console.log(`Live tenant metrics (last ${minutes}m${envQ ? ` env=${envQ}` : ''}): ${live.size} names in catalog`)
console.log(`Checked ${rows.length} starter(s): ${need ? Math.round((100 * hit) / need) : 0}% of metric widget names present\n`)

for (const r of slugResults.slice(0, 20)) {
  if (r.note) console.log(`  —  ${r.slug}  (${r.note})`)
  else console.log(`  ${r.pct}%  ${r.slug}  (${r.found}/${r.total})${r.missing?.length ? `  missing: ${r.missing.join(', ')}` : ''}`)
}

if (slugResults.filter((r) => r.pct === 100).length) {
  console.log('\n100% live:')
  for (const r of slugResults.filter((r) => r.pct === 100)) console.log(`  ${r.slug}`)
}

console.log('\nTip: run emit first, wait ~30s, set env scope to match OWLPANE_ENVIRONMENT.')
