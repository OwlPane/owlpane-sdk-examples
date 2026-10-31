#!/usr/bin/env node
/**
 * Dogfood preflight: SaaS API Postgres + ingest OTLP (metrics/traces/logs).
 * Telemetry store is the R2 lake (store=true when R2 + Postgres are healthy).
 *
 *   node scripts/check-dogfood-cell.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dir, '..')
const envPath = resolve(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const API = (process.env.OWLPANE_API_URL ?? '').replace(/\/+$/, '')
const INGEST = (process.env.OWLPANE_INGEST_URL ?? 'http://127.0.0.1:4318').replace(/\/+$/, '')
const ENV = process.env.OWLPANE_ENVIRONMENT ?? process.env.OWLPANE_ENV ?? 'development'

function isSaasDogfood() {
  if (/^https?:\/\/(127\.0\.0\.1|localhost):14318\b/i.test(INGEST)) return true
  if (process.env.OWLPANE_DOGFOOD_TARGET === 'saas') return true
  return false
}

async function apiHealth() {
  if (!API) {
    console.error('Set OWLPANE_API_URL in repo-root .env')
    process.exit(1)
  }
  const res = await fetch(`${API}/healthz`, { signal: AbortSignal.timeout(12_000) })
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`healthz not JSON: ${text.slice(0, 120)}`)
  }
  const mode = isSaasDogfood() ? 'SAAS' : 'LOCAL'
  console.log(`API  ${API}/healthz (${mode}) → db=${body.db} store=${body.store}`)
  if (!body.db) {
    console.error('')
    if (isSaasDogfood()) {
      console.error('Postgres is down on the remote cell (db:false). Ingest returns 503 on key lookup;')
      console.error('login and the console will fail until the cell DB is healthy.')
      console.error('Or switch to LOCAL: copy .env.local.example → .env and use ingest :4318 + API :4100.')
    } else {
      console.error('Local API cannot reach Postgres (db:false). Start owlpane-db / API stack, then retry.')
      console.error('Example: Docker ingest-1 + owlpane-db-1, API with DATABASE_URL pointing at localhost:5433.')
    }
    process.exit(1)
  }
  if (!body.store) {
    console.error('Telemetry store not healthy — set OWLPANE_LAKE_S3_* and OWLPANE_DATABASE_URL on the API.')
    process.exit(1)
  }
}

async function loginSmoke() {
  const email = process.env.OWLPANE_ONBOARD_EMAIL ?? process.env.OWLPANE_EMAIL
  const password = process.env.OWLPANE_ONBOARD_PASSWORD ?? process.env.OWLPANE_PASSWORD
  if (!email || !password) {
    console.log('skip login smoke (no OWLPANE_ONBOARD_EMAIL/PASSWORD)')
    return
  }
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`login → ${res.status} ${data?.message ?? res.statusText}`)
  const token = data.token ?? data.accessToken ?? data.sessionToken

  const envRes = await fetch(`${API}/v1/environments`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!envRes.ok) {
    const t = await envRes.text()
    throw new Error(`environments → ${envRes.status} ${t.slice(0, 200)}`)
  }
  const logs = await fetch(
    `${API}/v1/logs?minutes=60&env=${encodeURIComponent(ENV)}&level=info&limit=5`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!logs.ok) {
    const t = await logs.text()
    throw new Error(`logs → ${logs.status} ${t.slice(0, 200)}`)
  }
  console.log(`OK   login + logs env=${ENV}`)
  console.log(`     Console: pick environment “${ENV}” to match dogfood keys (.env OWLPANE_ENVIRONMENT).`)
}

const ingest = spawnSync(process.execPath, ['scripts/check-saas-ingest.mjs', '--otlp', '--otlp-metrics', '--otlp-logs'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
})
if (ingest.status !== 0) process.exit(ingest.status ?? 1)

await apiHealth()
await loginSmoke()
console.log('Dogfood cell preflight passed.')
