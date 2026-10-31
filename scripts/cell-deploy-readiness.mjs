#!/usr/bin/env node
/**
 * Summarize what a live cell is missing vs current main (wave3, inbox-stats).
 *
 *   node scripts/cell-deploy-readiness.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dir, '..', '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const API = (process.env.OWLPANE_API_URL ?? 'http://127.0.0.1:4100').replace(/\/+$/, '')
const TOKEN = process.env.OWLPANE_INTERNAL_TOKEN ?? ''

const probes = [
  { id: 'wave3-correlation', path: '/v1/settings/correlation', need: 'API build with CorrelationSettingsController + migration 098/105' },
  { id: 'wave3-pipeline-runs', path: '/v1/pipeline-runs?limit=1', need: 'API migration 102' },
  { id: 'inbox-stats', path: '/v1/internal/alerts/inbox-stats', need: 'ADR 0013 API build', internal: true },
]

async function probe(p) {
  const headers = p.internal && TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}
  const res = await fetch(`${API}${p.path}`, { headers, signal: AbortSignal.timeout(12_000) })
  return res.status
}

async function main() {
  console.log(`Cell: ${API}`)
  for (const p of probes) {
    if (p.internal && !TOKEN) {
      console.log(`?    ${p.id} — set OWLPANE_INTERNAL_TOKEN to probe`)
      continue
    }
    const status = await probe(p)
    const ok = status < 400
    console.log(`${ok ? 'OK' : 'MISS'} ${p.id} → ${status}${ok ? '' : ` (${p.need})`}`)
  }
  console.log('\nDeploy: owlpane/api/docs/ops/deploy-wave3-saas-cell.md')
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
