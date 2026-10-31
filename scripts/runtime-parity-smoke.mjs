#!/usr/bin/env node
/**
 * After dogfood ticks, verify each manifest app has logs + spans in the API (same env filter).
 *
 *   cd owlpane/sdk/examples
 *   node scripts/runtime-parity-smoke.mjs
 *
 * Env: OWLPANE_API_URL, OWLPANE_ONBOARD_EMAIL/PASSWORD (or OWLPANE_BEARER_TOKEN),
 *      OWLPANE_ENVIRONMENT, optional OWLPANE_RUNTIME_PARITY_MINUTES (default 60; API allows 15|60|360|1440|…)
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
const envQ = process.env.OWLPANE_ENVIRONMENT ?? process.env.OWLPANE_ENV ?? 'development'
const ALLOWED_MINUTES = [15, 60, 360, 1440, 10080, 43200, 129600]
const rawMinutes = Number(process.env.OWLPANE_RUNTIME_PARITY_MINUTES ?? '60') || 60
const minutes = ALLOWED_MINUTES.includes(rawMinutes)
  ? rawMinutes
  : ALLOWED_MINUTES.reduce((best, m) => (Math.abs(m - rawMinutes) < Math.abs(best - rawMinutes) ? m : best))
const manifest = JSON.parse(readFileSync(resolve(root, 'dogfood.manifest.json'), 'utf8'))
const skipIds = new Set(
  (process.env.OWLPANE_RUNTIME_PARITY_SKIP ?? 'pii-canary')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)

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

async function count(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = null
  }
  if (res.status >= 400) return { status: res.status, logs: 0, spans: 0, error: data?.message ?? text.slice(0, 120) }
  const logs = Array.isArray(data?.logs) ? data.logs.length : Number(data?.total ?? data?.count ?? 0)
  const spans = Array.isArray(data?.spans) ? data.spans.length : Number(data?.total ?? data?.count ?? 0)
  return { status: res.status, logs, spans, data }
}

async function main() {
  const b = await bearer()
  const envSuffix = `&env=${encodeURIComponent(envQ)}`
  const q = `minutes=${minutes}${envSuffix}`
  const lines = []
  let failed = 0

  for (const app of manifest.apps ?? []) {
    if (skipIds.has(app.id)) {
      lines.push(`SKIP ${app.id} (${app.project})`)
      continue
    }
    const svc = encodeURIComponent(app.project)
    const logsR = await count(`/v1/logs?service=${svc}&limit=1&level=info&${q}`, b)
    const spansR = await count(`/v1/spans?service=${svc}&limit=1&${q}`, b)
    const appsR = await count(`/v1/applications?minutes=${minutes}${envSuffix}`, b)
    let traffic = 0
    if (appsR.status < 400 && Array.isArray(appsR.data?.applications)) {
      const row = appsR.data.applications.find((a) => a.service === app.project || a.name === app.project)
      traffic = Number(row?.requests ?? row?.requestCount ?? 0)
    }
    const hasLogs = logsR.status < 400 && logsR.logs > 0
    const hasSpans = spansR.status < 400 && spansR.spans > 0
    const hasTraffic = traffic > 0
    const ok = hasLogs && (hasSpans || hasTraffic)
    const tag = ok ? 'OK  ' : 'FAIL'
    if (!ok) failed += 1
    lines.push(
      `${tag} ${app.id.padEnd(14)} ${app.project} logs=${hasLogs ? 'y' : 'n'} spans=${hasSpans ? 'y' : 'n'} homeReq=${traffic}`,
    )
  }

  console.log(`runtime parity (${minutes}m, env=${envQ})\n${lines.join('\n')}`)
  if (failed) {
    console.error(`\n${failed} app(s) missing logs or trace traffic — run ./dogfood-loop.sh and wait 2+ ticker cycles`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
