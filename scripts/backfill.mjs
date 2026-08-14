#!/usr/bin/env node
// backfill — copy the legacy Netlify Blob stores into Postgres (ADR-0002
// Phase 1, Part B). This is a DEPLOY-TIME OWNER step: run it against the real
// managed database BEFORE serving reads from Postgres. It never runs in the
// request path.
//
//   node scripts/backfill.mjs --dry-run                  # counts only, no writes
//   node scripts/backfill.mjs                            # backfill everything
//   node scripts/backfill.mjs --store runout-collection  # one store at a time
//
// Postgres (same as db:migrate):
//   DATABASE_URL  postgres://user:pass@host:5432/runout  (or default localhost)
//
// Netlify Blobs (one of):
//   - run inside a Netlify context (`netlify dev`/a Netlify Function), where
//     getStore() picks up the ambient site context, OR
//   - set NETLIFY_SITE_ID + NETLIFY_BLOBS_TOKEN (a deploy access token) so the
//     script can reach the production Blobs stores directly, OR
//   - set NETLIFY_BLOBS_CONTEXT (the JSON context @netlify/blobs expects).
//
// Properties (see _shared/backfill.js): IDEMPOTENT (upserts on natural keys),
// REVERSIBLE (only ADDS to Postgres — the legacy Blob stores are never renamed
// or deleted), PER-STORE, DRY-RUN capable, and it hashes access codes
// (code_hash) — it never writes plaintext codes to Postgres.

import pg from 'pg'
import { getStore } from '@netlify/blobs'
import { runBackfill } from '../netlify/functions/_shared/backfill.js'

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/runout'

function parseArgs(argv) {
  const args = { dryRun: false, onlyStore: null }
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') args.dryRun = true
    else if (argv[i] === '--store') args.onlyStore = argv[i + 1]
  }
  return args
}

// Thin Blobs reader over @netlify/blobs. Without NETLIFY_SITE_ID it relies on
// the ambient Netlify context (getStore(name)); with it, it builds a standalone
// client (getStore({ name, siteID, token })) so the script can run anywhere.
function blobReader() {
  const options = {}
  if (process.env.NETLIFY_SITE_ID) options.siteID = process.env.NETLIFY_SITE_ID
  if (process.env.NETLIFY_BLOBS_TOKEN) options.token = process.env.NETLIFY_BLOBS_TOKEN
  const make = (storeName) => (options.siteID ? getStore({ name: storeName, ...options }) : getStore(storeName))
  return {
    async read(storeName, key) {
      try {
        return await make(storeName).get(key, { type: 'json' })
      } catch {
        return null
      }
    },
    async listKeys(storeName) {
      const listing = await make(storeName).list()
      return (listing.keys || []).map((entry) => entry.key)
    },
  }
}

async function main() {
  const { dryRun, onlyStore } = parseArgs(process.argv)
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  try {
    const db = { query: (text, params) => pool.query(text, params) }
    const report = await runBackfill({ db, blob: blobReader(), onlyStore, dryRun })

    if (report.units.length === 0) {
      console.error(`No stores to backfill${onlyStore ? ` for --store ${onlyStore}` : ''}.`)
      console.error('Known stores: runout-identity, runout-collection, runout-library, discogs-cache, books-cache, collection-<userId>-<kind>')
      process.exitCode = 1
      return
    }

    for (const unit of report.units) {
      const scope = unit.kind === 'items' ? `${unit.owner}/${unit.collection}` : unit.provider || ''
      console.log(`${String(unit.store).padEnd(40)} ${unit.kind.padEnd(8)} ${String(scope).padEnd(24)} ${unit.count}`)
    }
    console.log('---')
    console.log(`totals: users=${report.totals.users} requests=${report.totals.requests} items=${report.totals.items} lookup=${report.totals.lookup}${dryRun ? ' (dry-run — nothing written)' : ''}`)
  } finally {
    await pool.end()
  }
}

const isDirectRun = import.meta.main !== undefined
  ? import.meta.main
  : process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]
if (isDirectRun) {
  try {
    await main()
  } catch (err) {
    console.error('backfill failed:', err.message)
    process.exit(1)
  }
}
