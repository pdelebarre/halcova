// @vitest-environment node
//
// REAL-Postgres enforcement tests for binding RLS (ARCH-6.1 #165,
// Multi-tenant-Security HOLD B + Security-Auditor). These connect to an actual
// PostgreSQL server as the least-privilege `app_rls` role and PROVE that:
//   1. a cross-tenant SELECT returns 0 rows and a cross-tenant INSERT/UPDATE is
//      rejected (fail closed);
//   2. a NON-ADMIN app_rls session CANNOT invoke the SECURITY DEFINER admin
//      cross-tenant functions — even after forging `app.admin_session` — because
//      the admin authority is DERIVED from the resolved session token, not a
//      settable GUC (HOLD 3 #165), and
//   3. once a real ADMIN session token is presented, the same functions DO work
//      (the authorized admin path).
//   4. app_rls has NO DML grant on `sessions` (SELECT-only), so it cannot
//      self-promote or tamper with sessions (HOLD 2 #165).
//
// Gating (never false-pass on pg-mem): the whole suite is SKIPPED unless
// RLS_INTEGRATION=1 AND both RLS_SUPER_URL (owner/superuser) and RLS_APP_RLS_URL
// (app_rls with LOGIN) are set AND reachable. pg-mem cannot satisfy these, so a
// plain `npm test` stays green and never claims DB enforcement it didn't run.
// If RLS_INTEGRATION=1 but a URL is missing the suite FAILS (config error), so
// a misconfigured CI job cannot silently skip.
//
// Run via `npm run db:test:rls` (applies migrations then runs this file) against
// a real Postgres:
//   RLS_INTEGRATION=1 \
//   RLS_SUPER_URL=postgres://owner@…/runout \
//   RLS_APP_RLS_URL=postgres://app_rls:<pw>@…/runout \
//   npm run db:test:rls

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyMigrations } from '../../../scripts/db-migrate.mjs'

const MIGRATIONS_DIR = path.join(fileURLToPath(new URL('../../../db/migrations', import.meta.url)))
const RLS_DIR = path.join(fileURLToPath(new URL('../../../db/rls', import.meta.url)))

const optIn = process.env.RLS_INTEGRATION === '1'
const superUrl = process.env.RLS_SUPER_URL
const appRlsUrl = process.env.RLS_APP_RLS_URL

if (optIn && (!superUrl || !appRlsUrl)) {
  throw new Error(
    'RLS_INTEGRATION=1 requires both RLS_SUPER_URL and RLS_APP_RLS_URL (see rls-integration.test.js)',
  )
}

const ready = () => optIn && !!superUrl && !!appRlsUrl

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex')
// Synthetic session tokens for the authorized/unauthorized paths. The DB stores
// only the sha256 hash (mirroring _shared/sessions.js), exactly like production.
const ADMIN_TOKEN = 'integration-admin-token-secret'
const MEMBER_TOKEN = 'integration-member-token-secret'

describe.skipIf(!ready())('Binding RLS enforcement (real Postgres, ARCH-6.1 #165)', () => {
  let superPool
  let appRlsPool

  beforeAll(async () => {
    superPool = new pg.Pool({ connectionString: superUrl })
    appRlsPool = new pg.Pool({ connectionString: appRlsUrl })
    // Self-contained: apply base migrations then the RLS migrations (idempotent).
    await applyMigrations(superPool, MIGRATIONS_DIR)
    await applyMigrations(superPool, RLS_DIR)
    // Deterministic seed state: clear owned rows, seed two tenants via the owner.
    await superPool.query('DELETE FROM items')
    await superPool.query(
      `INSERT INTO items (id, owner_id, kind, data) VALUES
         ($1, 'u1', 'records', '{}'::jsonb),
         ($2, 'u1', 'records', '{}'::jsonb),
         ($3, 'u2', 'books',   '{}'::jsonb)`,
      [
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000003',
      ],
    )
    // Seed sessions: one real admin session (owner) and one member session (u1).
    await superPool.query('DELETE FROM sessions')
    await superPool.query(
      `INSERT INTO sessions (token_hash, user_id, role, status, expires_at) VALUES
         ($1, 'owner', 'admin', 'active', now() + interval '1 day'),
         ($2, 'u1',    'member', 'active', now() + interval '1 day')`,
      [sha256(ADMIN_TOKEN), sha256(MEMBER_TOKEN)],
    )
  }, 60000)

  afterAll(async () => {
    await Promise.allSettled([superPool?.end(), appRlsPool?.end()])
  })

  it('app_rls cross-tenant SELECT returns 0 rows and UPDATE/INSERT are rejected (fail closed)', async () => {
    // app_rls session scoped to tenant u1.
    await appRlsPool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', 'u1'])

    // (1) Cross-tenant SELECT: u1's session sees only u1's rows, never u2's.
    const { rows } = await appRlsPool.query('SELECT owner_id FROM items ORDER BY owner_id')
    expect(rows.map((r) => r.owner_id)).toEqual(['u1', 'u1'])

    // (2) Cross-tenant UPDATE targets a row the tenant cannot see -> 0 rows changed.
    const upd = await appRlsPool.query(`UPDATE items SET title = 'pwned' WHERE owner_id = 'u2'`)
    expect(upd.rowCount).toBe(0)

    // (3) Cross-tenant INSERT is rejected by the RLS WITH CHECK (owner_id != tenant).
    await expect(
      appRlsPool.query(
        `INSERT INTO items (id, owner_id, kind, data)
         VALUES ('00000000-0000-0000-0000-000000000099', 'u2', 'records', '{}'::jsonb)`,
      ),
    ).rejects.toThrow()
  })

  it('a NON-ADMIN app_rls session CANNOT invoke admin functions, even after forging app.admin_session (HOLD 3)', async () => {
    // app_rls scoped to u1. It forges the OLD forgeable GUC marker...
    await appRlsPool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', 'u1'])
    await appRlsPool.query('SELECT set_config($1, $2, true)', ['app.admin_session', '1'])

    // ...but the marker is IGNORED: admin authority is DERIVED from the resolved
    // session token, so only the caller's own MEMBER token is available, whose
    // role resolves to non-admin -> fail closed (HOLD 3, #165).
    const memberHash = sha256(MEMBER_TOKEN)
    await expect(
      appRlsPool.query('SELECT admin_counts_by_kind($1)', [memberHash]),
    ).rejects.toThrow(/insufficient_privilege/i)
    await expect(
      appRlsPool.query(`SELECT admin_delete_items_for_owner($1, 'u1')`, [memberHash]),
    ).rejects.toThrow(/insufficient_privilege/i)
  })

  it('the same admin functions DO work once a real ADMIN session token is presented', async () => {
    // requireAdmin resolved a REAL admin session (role='admin', user_id='owner'),
    // so the app passes that session token's sha256 hash.
    await appRlsPool.query('SELECT set_config($1, $2, true)', ['app.tenant_id', 'u1'])
    const adminHash = sha256(ADMIN_TOKEN)

    // admin_counts_by_kind is cross-tenant: it sees BOTH u1's and u2's items.
    const { rows } = await appRlsPool.query('SELECT kind, count FROM admin_counts_by_kind($1)', [adminHash])
    const byKind = Object.fromEntries(rows.map((r) => [r.kind, Number(r.count)]))
    expect(byKind).toEqual({ records: 2, books: 1 })

    // admin_delete_items_for_owner is cross-tenant: removes u2's row entirely.
    const deleted = await appRlsPool.query(`SELECT admin_delete_items_for_owner($1, 'u2') AS n`, [adminHash])
    expect(Number(deleted.rows[0].n)).toBe(1)
    const remaining = await superPool.query('SELECT count(*)::int AS c FROM items')
    expect(remaining.rows[0].c).toBe(2) // only u1's two rows remain
  })

  it('app_rls has NO DML grant on sessions — no self-promotion or session tampering (HOLD 2)', async () => {
    // sessions.role is the admin-authority source; app_rls must be SELECT-only.
    const { rows } = await superPool.query(
      `SELECT has_table_privilege('app_rls','sessions','SELECT')  AS s,
              has_table_privilege('app_rls','sessions','INSERT')  AS i,
              has_table_privilege('app_rls','sessions','UPDATE')  AS u,
              has_table_privilege('app_rls','sessions','DELETE')  AS d`,
    )
    expect(rows[0].s).toBe(true)
    expect(rows[0].i).toBe(false)
    expect(rows[0].u).toBe(false)
    expect(rows[0].d).toBe(false)

    // Self-promotion via a direct UPDATE is rejected (no UPDATE grant on sessions).
    await expect(
      appRlsPool.query(`UPDATE sessions SET role = 'admin' WHERE user_id = 'u1'`),
    ).rejects.toThrow()
  })
})
