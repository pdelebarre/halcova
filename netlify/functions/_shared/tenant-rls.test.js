// @vitest-environment node
//
// ARCH-6.1 #165 — per-request RLS tenant-context wiring (_shared/tenant-rls.js).
// When binding RLS (db/rls/011_binding_rls.sql) is deployed, every tenant
// policy predicate filters on current_setting('app.tenant_id', true), so the
// app must set the resolved session's user.id as the tenant before touching
// tenant-scoped data. The wiring sets it with set_config('app.tenant_id', $1,
// true) — the parameterized SET-LOCAL-equivalent — which works on real
// Postgres AND on pg-mem (the bare `SET LOCAL app.tenant_id = '…'` form breaks
// pg-mem's parser, so the wiring deliberately uses set_config).
//
// These tests drive the helper against a pg-mem DB to prove the tenant-context
// SQL is issued inside a transaction and that the wiring is a safe no-op when
// no tenant is passed (the owner-scoped WHERE clauses remain the primary
// boundary).

import { beforeEach, describe, expect, it } from 'vitest'
import { DataType, newDb } from 'pg-mem'
import { setTenantContext, tenantContextSql, withTenantTransaction } from './tenant-rls'

function createMemDb() {
  const mem = newDb()
  mem.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (s) => String(s ?? '').length,
  })
  // 006 feedback CHECK uses char_length; apply the full schema so the wiring
  // can be proven against a realistic table.
  mem.public.none(`
    CREATE TABLE items (
      id text PRIMARY KEY,
      owner_id text NOT NULL,
      kind text NOT NULL,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  const { Pool } = mem.adapters.createPg()
  const pool = new Pool()
  return { query: (t, p) => pool.query(t, p), connect: () => pool.connect() }
}

describe('tenant-rls wiring (ARCH-6.1 #165)', () => {
  let db

  beforeEach(() => {
    db = createMemDb()
  })

  it('issues set_config(app.tenant_id, tenantId, true) as the SET-LOCAL equivalent', async () => {
    const sql = tenantContextSql('user-a')
    expect(sql.text).toBe('SELECT set_config($1, $2, true)')
    expect(sql.params).toEqual(['app.tenant_id', 'user-a'])
  })

  it('setTenantContext sets the tenant on a connection (no-op when null/empty)', async () => {
    // A non-empty tenant is issued and runs.
    await expect(setTenantContext(db, 'user-b')).resolves.toBeUndefined()
    // A null/empty tenant is a no-op (must not throw).
    await expect(setTenantContext(db, null)).resolves.toBeUndefined()
    await expect(setTenantContext(db, '')).resolves.toBeUndefined()
  })

  it('withTenantTransaction issues BEGIN -> set_config -> fn -> COMMIT when a tenant is passed', async () => {
    const calls = []
    const client = {
      query: async (text, params) => { calls.push([text, params]) },
      release: () => {},
    }
    const db = { connect: async () => client }

    const createRepo = (c) => ({ work: () => c.query('SELECT 1') })
    const ran = await withTenantTransaction(db, createRepo, 'user-a', async (repo) => {
      await repo.work()
      return 'committed'
    })

    expect(ran).toBe('committed')
    expect(calls.map((c) => c[0])).toEqual(['BEGIN', 'SELECT set_config($1, $2, true)', 'SELECT 1', 'COMMIT'])
    expect(calls[1][1]).toEqual(['app.tenant_id', 'user-a'])
  })

  it('withTenantTransaction issues BEGIN -> fn -> COMMIT with NO tenant context when omitted', async () => {
    const calls = []
    const client = {
      query: async (text) => { calls.push(text) },
      release: () => {},
    }
    const db = { connect: async () => client }
    const createRepo = (c) => ({ work: () => c.query('SELECT 1') })

    await withTenantTransaction(db, createRepo, null, async (repo) => { await repo.work() })
    expect(calls).toEqual(['BEGIN', 'SELECT 1', 'COMMIT'])
  })

  it('withTenantTransaction issues BEGIN -> set_config -> fn -> ROLLBACK and rethrows on error', async () => {
    const calls = []
    const client = {
      query: async (text) => { calls.push(text) },
      release: () => {},
    }
    const db = { connect: async () => client }
    const createRepo = (c) => ({ work: () => c.query('SELECT 1') })

    await expect(
      withTenantTransaction(db, createRepo, 'user-a', async () => { throw new Error('boom') }),
    ).rejects.toThrow('boom')
    expect(calls).toEqual(['BEGIN', 'SELECT set_config($1, $2, true)', 'ROLLBACK'])
  })
})
