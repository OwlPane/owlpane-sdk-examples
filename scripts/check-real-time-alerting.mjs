#!/usr/bin/env node
/**
 * Preflight ADR 0012: internal telemetry-landed endpoint reachable from your machine
 * (same token ingest uses). Does not require telemetry lake rollups.
 *
 *   node scripts/check-real-time-alerting.mjs
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

const API = (process.env.OWLPANE_API_URL ?? process.env.OWLPANE_CONSOLE_API_URL ?? 'http://127.0.0.1:4100').replace(
  /\/+$/,
  '',
)
const TOKEN = process.env.OWLPANE_INTERNAL_TOKEN ?? ''

async function main() {
  if (!TOKEN) {
    console.error('Set OWLPANE_INTERNAL_TOKEN in sdk/examples/.env (same as ingest cell)')
    process.exit(1)
  }
  const body = {
    v: 1,
    id: randomUUID(),
    at: new Date().toISOString(),
    tenantId: process.env.OWLPANE_CI_TENANT_ID ?? 'preflight-tenant',
    projectId: randomUUID(),
    environment: process.env.OWLPANE_ENV ?? 'development',
    signals: ['logs'],
    services: ['preflight'],
    counts: { logs: 1 },
    bytes: 64,
  }
  const res = await fetch(`${API}/v1/internal/alerts/telemetry-landed`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text()
  if (res.status !== 202) {
    console.error(`telemetry-landed → ${res.status} ${text.slice(0, 200)}`)
    process.exit(1)
  }
  console.log(`OK  POST ${API}/v1/internal/alerts/telemetry-landed → 202`)
  try {
    const j = JSON.parse(text)
    console.log(`    evaluated=${j.evaluated ?? 0} skipped=${j.skipped ?? 0}`)
  } catch {
    console.log(`    ${text.slice(0, 120)}`)
  }

  const statsRes = await fetch(`${API}/v1/internal/alerts/inbox-stats`, {
    headers: { authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(10_000),
  })
  const statsText = await statsRes.text()
  if (statsRes.status !== 200) {
    console.error(`inbox-stats → ${statsRes.status} ${statsText.slice(0, 200)}`)
    console.error('(404 = deploy API with ADR 0013 inbox-stats route)')
    process.exit(1)
  }
  const stats = JSON.parse(statsText)
  console.log(`OK  GET  ${API}/v1/internal/alerts/inbox-stats → pending=${stats.pending} oldestSec=${stats.oldestSec}`)
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
