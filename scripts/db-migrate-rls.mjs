#!/usr/bin/env node
// db:migrate:rls — apply the PostgreSQL Row-Level-Security migration
// (SEC-EPIC-2, #190). Kept separate from `db:migrate` because the pg-mem
// in-memory emulator used by the unit tests cannot parse RLS DDL, so
// db/migrations (applied by every repo test) must stay pg-mem-clean. This
// runner applies the RLS files in db/rls to real Postgres only.
//
//   node scripts/db-migrate-rls.mjs          # DATABASE_URL or default localhost
//   DATABASE_URL=postgres://… node scripts/db-migrate-rls.mjs
//
// Reuses applyMigrations (scripts/db-migrate.mjs) so tracking/idempotency
// semantics are identical: each file runs in its own transaction and is
// recorded in schema_migrations. Safe to run repeatedly and on deploy.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { applyMigrations } from './db-migrate.mjs'

const RLS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'rls')
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/runout'

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  try {
    const appliedNow = await applyMigrations(pool, RLS_DIR)
    if (!appliedNow.length) console.log('RLS migrations up to date.')
    for (const file of appliedNow) console.log(`apply ${file}`)
  } finally {
    await pool.end()
  }
}

const isDirectRun = import.meta.main !== undefined
  ? import.meta.main
  : process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    await main()
  } catch (err) {
    console.error('db:migrate:rls failed:', err.message)
    process.exit(1)
  }
}
