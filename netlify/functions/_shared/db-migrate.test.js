// @vitest-environment node
//
// Migration-runner tests: scripts/db-migrate.mjs's applyMigrations() is driven
// with a pg-mem pool (no live DB in the sandbox). Proves the runner applies
// db/migrations in order, records each in schema_migrations, and is idempotent
// on a second run. The migration SQL itself is also applied by every repo test
// (see repositories/test-helpers.js).

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { newDb } from 'pg-mem'
import { applyMigrations } from '../../../scripts/db-migrate.mjs'

const MIGRATIONS_DIR = path.join(
  fileURLToPath(new URL('../../../db/migrations', import.meta.url)),
)

function createRawMemPool() {
  const mem = newDb()
  const { Pool } = mem.adapters.createPg()
  return { pool: new Pool() }
}

describe('applyMigrations (scripts/db-migrate.mjs)', () => {
  let pool

  beforeEach(() => {
    pool = createRawMemPool().pool
  })

  it('applies the pending migration files and records them in schema_migrations', async () => {
    const applied = await applyMigrations(pool, MIGRATIONS_DIR)
    expect(applied.length).toBeGreaterThan(0)
    expect(applied[0]).toMatch(/\.sql$/)

    const { rows } = await pool.query('SELECT name FROM schema_migrations ORDER BY id')
    expect(rows.map((r) => r.name)).toEqual(applied)

    // The tables the migration created actually exist.
    const users = await pool.query('SELECT count(*)::int AS c FROM users')
    expect(users.rows[0].c).toBe(0)
  })

  it('is idempotent — a second run applies nothing new', async () => {
    const first = await applyMigrations(pool, MIGRATIONS_DIR)
    const second = await applyMigrations(pool, MIGRATIONS_DIR)
    expect(second).toEqual([])
    expect(first.length).toBeGreaterThan(0)
    // Data written after the first run survives a second run (no re-apply).
    await pool.query('INSERT INTO users (id, name) VALUES ($1, $2)', ['u1', 'Ada'])
    await applyMigrations(pool, MIGRATIONS_DIR)
    const { rows } = await pool.query('SELECT count(*)::int AS c FROM users')
    expect(rows[0].c).toBe(1)
  })
})
