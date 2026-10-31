#!/usr/bin/env node
/**
 * G-028: reproducible query timing against Owlpane API (requires .env with OWLPANE_API_URL + session or token).
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
config({ path: resolve(root, '.env') })

const api = (process.env.OWLPANE_API_URL ?? '').replace(/\/+$/, '')
/** Accepts `--minutes=60` and `--minutes 60`. */
function flag(name, fallback) {
  const args = process.argv.slice(2)
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (i === -1) return fallback
  const v = args[i].includes('=') ? args[i].split('=')[1] : args[i + 1]
  return v === undefined || v === '' ? fallback : v
}
const minutes = Number(flag('minutes', 60))
if (!Number.isFinite(minutes) || minutes <= 0) {
  console.error('--minutes must be a positive number')
  process.exit(1)
}

if (!api) {
  console.error('Set OWLPANE_API_URL in repo-root .env')
  process.exit(1)
}

const runs = 30
const path = `/v1/overview?minutes=${minutes}&env=`
const times = []

for (let i = 0; i < runs; i++) {
  const t0 = performance.now()
  const res = await fetch(`${api}${path}`, { headers: { accept: 'application/json' } })
  await res.arrayBuffer()
  times.push(performance.now() - t0)
  if (!res.ok) {
    console.error(`Request failed: ${res.status} (auth may be required — use console session cookie or PAT)`)
    process.exit(1)
  }
}

times.sort((a, b) => a - b)
const p50 = times[Math.floor(times.length * 0.5)]
const p95 = times[Math.floor(times.length * 0.95)]
console.log(JSON.stringify({ endpoint: path, runs, p50Ms: Math.round(p50), p95Ms: Math.round(p95) }, null, 2))
