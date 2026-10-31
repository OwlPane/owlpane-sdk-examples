#!/usr/bin/env node
/**
 * Live E2E smoke against OWLPANE_API_URL: wave3 + APM + realtime alerting preflight.
 *
 *   cd owlpane/sdk/examples
 *   node scripts/e2e-parity-smoke.mjs
 *
 * Env: OWLPANE_API_URL, OWLPANE_ONBOARD_EMAIL/PASSWORD (or OWLPANE_BEARER_TOKEN),
 *      optional OWLPANE_INTERNAL_TOKEN, OWLPANE_ENVIRONMENT
 */
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
const TOKEN = process.env.OWLPANE_INTERNAL_TOKEN ?? ''
const EXPECT_WAVE3 = process.env.OWLPANE_EXPECT_WAVE3 === '1'

async function bearer() {
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

async function json(method, path, bearerToken, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data }
}

const checks = []

async function main() {
  const b = await bearer()
  const q = envQ ? `&env=${encodeURIComponent(envQ)}` : ''

  const envSuffix = envQ ? `&env=${encodeURIComponent(envQ)}` : ''
  for (const [name, path] of [
    ['APM menu', `/v1/menu-dashboards/apm?minutes=60${envSuffix}`],
    ['correlation GET', '/v1/settings/correlation'],
    ['retention overrides', '/v1/settings/retention-overrides'],
    ['LLM prices', '/v1/llm/model-prices'],
    ['workflow hooks', '/v1/workflows/hooks'],
    ['pipeline runs', '/v1/pipeline-runs?limit=3'],
    ['SLO list', '/v1/slos'],
    ['running search jobs', '/v1/admin/search-jobs/running'],
    ['alert events', '/v1/alerts/events?limit=5'],
    ['requests', `/v1/requests?minutes=60&limit=3${envSuffix}`],
  ]) {
    const r = await json('GET', path, b)
    const wave3 = !['APM menu', 'alert events', 'requests'].includes(name)
    if (r.status >= 400) {
      if (wave3 && !EXPECT_WAVE3 && (r.status === 404 || r.status === 400)) {
        checks.push(`SKIP ${name} → ${r.status} (deploy API with migration 102 / wave3)`)
      } else checks.push(`FAIL ${name} → ${r.status}`)
    } else {
      checks.push(`OK   ${name} → ${r.status}`)
    }
  }

  const mark = (label, status) => {
    if (status < 400) checks.push(`OK   ${label} → ${status}`)
    else if (status === 404 && !EXPECT_WAVE3) checks.push(`SKIP ${label} → 404 (wave3 not on cell)`)
    else checks.push(`FAIL ${label} → ${status}`)
  }

  const ts = await json('POST', '/v1/slos/evaluate-time-slice', b, {
    targetPct: 99,
    slices: [{ total: 10, bad: 0 }],
  })
  mark('time-slice SLO', ts.status)

  const explain = await json('POST', '/v1/explorer/explain', b, { sql: 'SELECT 1' })
  mark('explorer explain', explain.status)

  if (TOKEN) {
    const me = await json('GET', '/v1/me', b)
    const tenantId = me.data?.orgs?.[0]?.tenantId
    if (tenantId) {
      const land = await fetch(`${API}/v1/internal/alerts/telemetry-landed`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          id: randomUUID(),
          at: new Date().toISOString(),
          tenantId,
          projectId: randomUUID(),
          environment: envQ || 'development',
          signals: ['logs'],
          services: ['e2e-smoke'],
          counts: { logs: 1 },
          bytes: 32,
        }),
      })
      checks.push(land.status === 202 ? 'OK   telemetry-landed → 202' : `FAIL telemetry-landed → ${land.status}`)
      const stats = await fetch(`${API}/v1/internal/alerts/inbox-stats`, {
        headers: { authorization: `Bearer ${TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (stats.status === 200) {
        const j = await stats.json()
        checks.push(`OK   inbox-stats → pending=${j.pending ?? '?'}`)
      } else if (stats.status === 404) {
        checks.push('SKIP inbox-stats → 404 (older API build)')
      } else {
        checks.push(`FAIL inbox-stats → ${stats.status}`)
      }
    } else {
      checks.push('skip telemetry-landed (no tenantId on /v1/me)')
    }
  } else {
    checks.push('skip telemetry-landed (no OWLPANE_INTERNAL_TOKEN)')
  }

  console.log(checks.join('\n'))
  const failed = checks.filter((l) => l.startsWith('FAIL'))
  if (failed.length) process.exit(1)

  if (process.env.OWLPANE_RUNTIME_PARITY === '1') {
    const { spawnSync } = await import('node:child_process')
    const parity = resolve(__dir, 'runtime-parity-smoke.mjs')
    const r = spawnSync(process.execPath, [parity], { stdio: 'inherit', cwd: root })
    if (r.status) process.exit(r.status ?? 1)
  }
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
