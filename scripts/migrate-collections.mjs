#!/usr/bin/env node
// migrate-collections — FEAT-6.3 #316: run the generic-collection migration
// TOOL (backfill + reconciliation + optional rollback) against Postgres.
//
//   node scripts/migrate-collections.mjs              # backfill + reconcile
//   node scripts/migrate-collections.mjs --rollback    # reverse-map legacy
//   DATABASE_URL=postgres://… node scripts/migrate-collections.mjs
//
// The migration is IDEMPOTENT (re-running is a no-op) and REVERSIBLE (rollback
// regenerates the legacy `items` envelope from the new model — never an
// irreversible delete; ADR-0020 §11, ADR-0014). The legacy `items` table and its
// API contract are never altered by the backfill.
//
// Standing agreement: this is an irreversible-adjacent M3 path; the reconciliation
// report it prints is the pre/post evidence that guards any later retirement.

import pg from 'pg'
import { backfill, reconcile, rollback } from '../netlify/functions/_shared/collection-migration.js'

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/runout'

async function main() {
  const doRollback = process.argv.includes('--rollback')
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  try {
    if (doRollback) {
      const rb = await rollback(pool)
      console.log(`rollback: restored ${rb.restored} legacy items from the new model`)
      return
    }
    const counts = await backfill(pool)
    console.log(`backfill: collections=${counts.collections} canonical=${counts.canonical} collectionItems=${counts.collectionItems}`)
    const r = await reconcile(pool)
    console.log(JSON.stringify(r, null, 2))
    if (!r.pass) {
      console.error('RECONCILIATION FAILED — do not retire the legacy representation.')
      process.exitCode = 1
    } else {
      console.log('RECONCILIATION PASS — no unexplained loss/duplication/ownership change.')
    }
  } finally {
    await pool.end()
  }
}

const isDirectRun = import.meta.main !== undefined
  ? import.meta.main
  : process.argv[1] && process.argv[1].endsWith('migrate-collections.mjs')
if (isDirectRun) {
  try {
    await main()
  } catch (err) {
    console.error('migrate-collections failed:', err.message)
    process.exit(1)
  }
}