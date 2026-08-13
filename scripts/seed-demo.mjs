// Seed the demo space by calling the seed-demo Netlify function.
// Usage: node scripts/seed-demo.mjs
//
// Requires `netlify dev` to be running (functions on http://localhost:8888)
// and RUNOUT_ADMIN_KEY to be set (in .env or the shell env) so the function
// authorizes the call. The admin key is used ONLY in the Authorization header
// and is never printed. See netlify/functions/seed-demo.js for the curl form.

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// Load KEY=VALUE lines from .env (netlify dev loads the same file into the
// function env); fall back to the shell environment when there is no .env.
function loadEnv() {
  const env = { ...process.env }
  try {
    const text = readFileSync(resolve(root, '.env'), 'utf8')
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*)$/)
      if (m) env[m[1]] = m[2].trim()
    }
  } catch {
    // no .env — rely on the shell environment
  }
  return env
}

const env = loadEnv()
const adminKey = env.RUNOUT_ADMIN_KEY
if (!adminKey) {
  console.error('RUNOUT_ADMIN_KEY not set (in .env or the shell env).')
  process.exit(1)
}

const base = env.RUNOUT_FUNCTIONS_URL || 'http://localhost:8888'
const url = `${base}/.netlify/functions/seed-demo`

let res
try {
  res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminKey}` },
  })
} catch (err) {
  console.error(`Could not reach ${url} — is \`netlify dev\` running?`)
  console.error(String(err?.message || err))
  process.exit(1)
}

const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error(`seed-demo failed (HTTP ${res.status}): ${body.error || 'unknown error'}`)
  process.exit(1)
}

const fmt = (kind, result) =>
  result?.skipped ? `${kind} already seeded (${result.count} items kept)` : `seeded ${result?.count ?? 0} ${kind}`
console.log(`✅ ${fmt('records', body.records)}`)
console.log(`✅ ${fmt('books', body.books)}`)
