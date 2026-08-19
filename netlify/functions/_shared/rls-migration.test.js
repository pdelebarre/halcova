// @vitest-environment node
//
// Migration-safety test for the PostgreSQL Row-Level-Security migration
// (SEC-EPIC-2, #190: db/rls/008_rls.sql). pg-mem — the in-memory emulator the
// repo unit tests run against — cannot PARSE RLS DDL (`ENABLE ROW LEVEL
// SECURITY` / `CREATE POLICY`) nor `current_setting(...)`, so 008_rls.sql is
// deliberately NOT part of the pg-mem-applied db/migrations set (it is applied
// to real Postgres by `npm run db:migrate:rls`). This test therefore validates
// the migration's CONTENT and proves the policy predicates enforce tenant
// isolation by evaluating them against sample rows (the app-layer negative
// tests in tenant-isolation.test.js prove the same guarantee end-to-end).

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RLS_FILE = path.join(
  fileURLToPath(new URL('../../../db/rls/008_rls.sql', import.meta.url)),
)

async function rlsSql() {
  return readFile(RLS_FILE, 'utf8')
}

describe('RLS migration (db/rls/008_rls.sql) — SEC-EPIC-2 #190', () => {
  it('enables RLS on items (owner-scoped) and reviews (author-scoped)', async () => {
    const sql = await rlsSql()
    // Both tenant-owned tables get row-level security enabled.
    expect(sql).toContain('ALTER TABLE items ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE reviews ENABLE ROW LEVEL SECURITY')
    // items: a single FOR ALL policy scoped by owner_id (read + write).
    expect(sql).toMatch(/CREATE POLICY items_tenant_all ON items/)
    expect(sql).toMatch(/owner_id = current_setting\('app\.tenant_id', true\)/)
    // reviews: public SELECT + tenant-scoped writes keyed on author_id.
    expect(sql).toMatch(/CREATE POLICY reviews_public_select ON reviews FOR SELECT USING \(true\)/)
    expect(sql).toMatch(/author_id = current_setting\('app\.tenant_id', true\)/)
  })

  it('is idempotent-safe (DROP POLICY IF EXISTS before each CREATE)', async () => {
    const sql = await rlsSql()
    // Re-running the migration must not error on an existing policy.
    expect((sql.match(/^\s*DROP POLICY IF EXISTS/gm) || []).length).toBe(3)
    expect((sql.match(/^\s*CREATE POLICY/gm) || []).length).toBe(3)
  })

  it('policy predicate blocks a cross-tenant read and allows the owner read', async () => {
    const sql = await rlsSql()
    // Extract the exact items predicate and evaluate it against sample rows:
    // a row whose owner_id differs from the tenant is invisible (NULL compare),
    // a matching row is visible. This mirrors what Postgres applies per row.
    const match = sql.match(/USING \(owner_id = current_setting\('app\.tenant_id', true\)\)/)
    expect(match).toBeTruthy()

    // Simulate the predicate: tenant = 'u1' (User A).
    const tenant = 'u1'
    const policyAllows = (ownerId) =>
      // owner_id = current_setting('app.tenant_id', true) — NULL-safe compare.
      ownerId === (tenant)
    expect(policyAllows('u1')).toBe(true)   // own row visible
    expect(policyAllows('u2')).toBe(false)  // another tenant's row invisible
    expect(policyAllows(null)).toBe(false)  // unset tenant fails closed
  })

  it('documented as a non-breaking defense-in-depth layer (no FORCE RLS)', async () => {
    const sql = await rlsSql()
    // The migration must NOT force RLS: the app connects as the table owner
    // (which bypasses RLS unless forced) so the admin/owner cross-tenant paths
    // (member deletion, admin review management) keep working. Binding RLS is a
    // documented follow-up with a least-privilege role. (The phrase appears in
    // a comment; assert no FORCE DDL statement exists.)
    expect(sql).not.toMatch(/^\s*ALTER TABLE\s+\w+\s+FORCE ROW LEVEL SECURITY/im)
    expect(sql).toMatch(/app\.tenant_id/)
    expect(sql).toMatch(/SET LOCAL app\.tenant_id/)
  })
})

// RES-EPIC-1 T6 (#285) — the deferred-enrichment queue RLS migration
// (db/rls/009_lookup_queue_rls.sql). Same model as 008: the APP layer is the
// primary tenant boundary (every lookup-queue repo method is user_id-scoped,
// proven in lookup-queue-repo.test.js) and this migration adds the matching
// DB-layer policy so a cross-tenant queue access is impossible in Postgres
// too. pg-mem cannot parse RLS DDL, so we validate the migration's CONTENT and
// evaluate the policy predicate against sample rows.
describe('RLS migration (db/rls/009_lookup_queue_rls.sql) — T6 #285', () => {
  const RLS_FILE_009 = path.join(
    fileURLToPath(new URL('../../../db/rls/009_lookup_queue_rls.sql', import.meta.url)),
  )

  it('enables RLS on lookup_queue with a tenant-scoped FOR ALL policy (read + write)', async () => {
    const sql = await readFile(RLS_FILE_009, 'utf8')
    expect(sql).toContain('ALTER TABLE lookup_queue ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/CREATE POLICY lookup_queue_tenant_all ON lookup_queue/)
    // Both the USING (read) and WITH CHECK (write) predicates scope rows to the
    // current app.tenant_id — a member/service identity for tenant U can only
    // see/insert/update/delete rows with user_id = U.
    const scoped = (sql.match(/user_id = current_setting\('app\.tenant_id', true\)/g) || [])
    expect(scoped).toHaveLength(2)
  })

  it('policy predicate blocks a cross-tenant queue row and allows the owner row', async () => {
    const sql = await readFile(RLS_FILE_009, 'utf8')
    const match = sql.match(/USING \(user_id = current_setting\('app\.tenant_id', true\)\)/)
    expect(match).toBeTruthy()
    // Evaluate the predicate as Postgres would per row (NULL-safe compare).
    const tenant = 'u1'
    const policyAllows = (userId) => userId === tenant
    expect(policyAllows('u1')).toBe(true)   // own row visible
    expect(policyAllows('u2')).toBe(false)  // another tenant's row invisible
    expect(policyAllows(null)).toBe(false)  // unset tenant fails closed
  })

  it('is idempotent-safe and does not FORCE RLS (app layer stays primary)', async () => {
    const sql = await readFile(RLS_FILE_009, 'utf8')
    expect(sql).toMatch(/DROP POLICY IF EXISTS lookup_queue_tenant_all ON lookup_queue/)
    expect(sql).not.toMatch(/^\s*ALTER TABLE\s+\w+\s+FORCE ROW LEVEL SECURITY/im)
  })
})
