#!/usr/bin/env node
// db:migrate — apply pending SQL migrations in db/migrations in order.
//
//   node scripts/db-migrate.mjs          # DATABASE_URL or default localhost
//   DATABASE_URL=postgres://… node scripts/db-migrate.mjs
//
// Idempotent: applied files are recorded in the `schema_migrations` table and
// skipped on later runs. Each migration runs inside its own transaction (all
// of its statements commit together or roll back together), so a half-applied
// migration is never left behind. Safe to run repeatedly and on deploy.
//
// npm script: `npm run db:migrate`.
//
// `applyMigrations` is exported so the runner's logic is testable with a
// node-postgres-compatible pool (pg-mem provides one in tests) — the migration
// SQL itself is applied by the repo tests too.

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://localhost:5432/runout'

// Apply every migration in `dir` that isn't already recorded, in filename
// order. `pool` is any node-postgres-compatible Pool ({ query, connect }).
// Returns the list of newly-applied file names.
export async function applyMigrations(pool, dir = MIGRATIONS_DIR) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const appliedNow = []

  // Create the tracking table only when it's absent, so re-runs are a clean
  // no-op (and the check works across emulators like pg-mem).
  const { rows: exists } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'schema_migrations') AS e`,
  )
  if (!exists[0].e) {
    await pool.query(`
      CREATE TABLE schema_migrations (
        id         serial PRIMARY KEY,
        name       text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
  }
  const { rows } = await pool.query('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((r) => r.name))

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = await readFile(path.join(dir, file), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      appliedNow.push(file)
    } catch (err) {
      try { await client.query('ROLLBACK') } catch { /* connection may be dead */ }
      throw err
    } finally {
      client.release()
    }
  }
  return appliedNow
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL })
  try {
    const appliedNow = await applyMigrations(pool)
    if (!appliedNow.length) console.log('Migrations up to date.')
    for (const file of appliedNow) console.log(`apply ${file}`)
  } finally {
    await pool.end()
  }
}

// Allow a direct `node scripts/db-migrate.mjs` run while keeping the module
// importable by tests. import.meta.main is available on Node 22+; fall back to
// detecting a direct run via process.argv[1].
const isDirectRun = import.meta.main !== undefined
  ? import.meta.main
  : process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  try {
    await main()
  } catch (err) {
    console.error('db:migrate failed:', err.message)
    process.exit(1)
  }
}
