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
import { DataType, newDb } from 'pg-mem'
import { applyMigrations } from '../../../scripts/db-migrate.mjs'

const MIGRATIONS_DIR = path.join(
  fileURLToPath(new URL('../../../db/migrations', import.meta.url)),
)

function createRawMemPool() {
  const mem = newDb()
  // Migration 006's message CHECK uses char_length, which pg-mem doesn't
  // implement — register it (real Postgres has it natively).
  mem.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s) => String(s ?? '').length,
  })
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
    // 002_hash_codes drops the plaintext `code` column and makes `code_hash`
    // NOT NULL, so inserts must carry a hash.
    await pool.query('INSERT INTO users (id, name, code_hash) VALUES ($1, $2, $3)', ['u1', 'Ada', 'abc123'])
    await applyMigrations(pool, MIGRATIONS_DIR)
    const { rows } = await pool.query('SELECT count(*)::int AS c FROM users')
    expect(rows[0].c).toBe(1)
  })

  it('applies the S3 billing columns (003) as nullable + the O(1) Stripe unique indexes', async () => {
    await applyMigrations(pool, MIGRATIONS_DIR)

    // The five billing columns exist (a missing column would throw).
    // pg-mem does not expose reliable fields/nullability metadata, so the
    // columns are proven functionally: selectable, nullable, and writable.
    await pool.query(
      `SELECT plan_expires_at, plan_changed_at, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id
       FROM users LIMIT 0`,
    )

    // Nullable + additive: a plain member without billing reads back clean.
    await pool.query('INSERT INTO users (id, name, code_hash) VALUES ($1, $2, $3)', ['u1', 'Ada', 'abc123'])
    const plain = await pool.query('SELECT stripe_customer_id, plan_expires_at FROM users WHERE id = $1', ['u1'])
    expect(plain.rows[0].stripe_customer_id).toBeNull()
    expect(plain.rows[0].plan_expires_at).toBeNull()

    // The billing columns accept real values and round-trip.
    await pool.query(
      `UPDATE users SET plan_expires_at = $2, stripe_customer_id = $3, stripe_subscription_id = $4, stripe_checkout_session_id = $5 WHERE id = $1`,
      ['u1', '2027-08-14T00:00:00Z', 'cus_123', 'sub_1', 'cs_test_1'],
    )
    const billed = await pool.query('SELECT plan_expires_at, stripe_customer_id, stripe_subscription_id, stripe_checkout_session_id FROM users WHERE id = $1', ['u1'])
    expect(billed.rows[0].stripe_customer_id).toBe('cus_123')
    expect(billed.rows[0].stripe_checkout_session_id).toBe('cs_test_1')
    expect(billed.rows[0].plan_expires_at).toBeTruthy()

    // Distinct session/subscription ids are fine.
    const insertBilled = (id, session, sub) => pool.query(
      `INSERT INTO users (id, name, code_hash, stripe_checkout_session_id, stripe_subscription_id)
       VALUES ($1, $2, $3, $4, $5)`,
      // code_hash is unique per user (migration 002) — derive a distinct hash.
      [id, 'N', `hash-${id}`, session, sub],
    )
    await insertBilled('u4', 'cs_test_2', 'sub_2')
    await insertBilled('u5', 'cs_test_3', 'sub_3')
    // The unique session/subscription indexes enforce webhook idempotency: a
    // second user claiming the same session id (or subscription id) is rejected.
    // (Kept LAST — pg-mem's btree index is left inconsistent after a rejected
    // unique insert, so no successful insert may follow the conflicts.)
    await expect(insertBilled('u6', 'cs_test_2', 'sub_4')).rejects.toThrow()
    await expect(insertBilled('u7', 'cs_test_4', 'sub_3')).rejects.toThrow()
  })
})
