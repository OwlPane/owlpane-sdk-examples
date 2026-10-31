#!/usr/bin/env node
/**
 * Preflight APM: menu board + traces list API (requires tenant login).
 *
 *   node scripts/check-apm.mjs
 *
 * Env: OWLPANE_API_URL, OWLPANE_BEARER_TOKEN or OWLPANE_ONBOARD_EMAIL/PASSWORD, optional OWLPANE_ENVIRONMENT
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

const API = (process.env.OWLPANE_API_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '')
const envQ = process.env.OWLPANE_ENVIRONMENT ?? process.env.OWLPANE_ENV ?? ''

async function token() {
  if (process.env.OWLPANE_BEARER_TOKEN?.trim()) return process.env.OWLPANE_BEARER_TOKEN.trim()
  const email = process.env.OWLPANE_ONBOARD_EMAIL ?? process.env.OWLPANE_EMAIL
  const password = process.env.OWLPANE_ONBOARD_PASSWORD ?? process.env.OWLPANE_PASSWORD
  if (!email || !password) throw new Error('Set OWLPANE_BEARER_TOKEN or OWLPANE_ONBOARD_EMAIL + PASSWORD in .env')
  const res = await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.message ?? res.statusText)
  return data.token ?? data.accessToken ?? data.sessionToken
}

async function get(bearer, path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  if (!res.ok) throw new Error(typeof data === 'object' ? data?.message ?? res.statusText : text.slice(0, 200))
  return data
}

async function main() {
  const bearer = await token()
  const q = new URLSearchParams({ minutes: '60' })
  if (envQ) q.set('env', envQ)
  const apm = await get(bearer, `/v1/menu-dashboards/apm?${q}`)
  const cards = apm.cards?.length ?? 0
  const series = apm.series?.length ?? 0
  console.log(`OK  GET /v1/menu-dashboards/apm → cards=${cards} series=${series}`)
  if (cards < 1) console.warn('    warn: no cards (no server spans in range?)')

  const reqQ = new URLSearchParams({ minutes: '60', limit: '5' })
  if (envQ) reqQ.set('env', envQ)
  const requests = await get(bearer, `/v1/requests?${reqQ}`)
  const n = Array.isArray(requests.requests) ? requests.requests.length : Array.isArray(requests) ? requests.length : 0
  console.log(`OK  GET /v1/requests → sample=${n}`)
  console.log('    Apply telemetry lake 0007 on the cell for rollup-backed APM hub (see api/docs/product/apm.md)')
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
