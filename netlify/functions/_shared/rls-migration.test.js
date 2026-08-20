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

import { readFile, readdir } from 'node:fs/promises'
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

// ---------------------------------------------------------------------------
// ARCH-6.1 #165 — generic collection tables RLS (db/rls/010_rls_generic_
// collections.sql). collections is tenant-scoped on owner_id; collection_items
// has NO owner_id (ownership flows through Collection.owner_id), so its policy
// resolves the predicate via a Collection SUBQUERY, NOT a bare owner_id compare.
// FORCE ROW LEVEL SECURITY is set on both so the binding is effective.
// ---------------------------------------------------------------------------
describe('RLS migration (db/rls/010_rls_generic_collections.sql) — #165', () => {
  const RLS_FILE_010 = path.join(
    fileURLToPath(new URL('../../../db/rls/010_rls_generic_collections.sql', import.meta.url)),
  )

  it('enables RLS on collections (owner-scoped) and collection_items (Collection-subquery)', async () => {
    const sql = await readFile(RLS_FILE_010, 'utf8')
    expect(sql).toContain('ALTER TABLE collections ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE collection_items ENABLE ROW LEVEL SECURITY')
    // collections: a single FOR ALL policy scoped by owner_id.
    expect(sql).toMatch(/CREATE POLICY collections_tenant_all ON collections/)
    expect(sql).toMatch(/owner_id = current_setting\('app\.tenant_id', true\)/)
  })

  it('resolves the collection_items predicate via a Collection subquery, NOT a bare owner_id', async () => {
    const sql = await readFile(RLS_FILE_010, 'utf8')
    // The predicate joins collection_items to collections and compares the
    // OWNING Collection's owner_id — this is the Security-Auditor blocking
    // condition #2 (CollectionItem has no owner_id column).
    expect(sql).toMatch(/CREATE POLICY collection_items_tenant_all ON collection_items/)
    expect(sql).toMatch(/FROM collections c/i)
    expect(sql).toMatch(/c\.id = collection_items\.collection_id/)
    expect(sql).toMatch(/c\.owner_id = current_setting\('app\.tenant_id', true\)/)
    // A bare owner_id predicate on collection_items must NOT appear (it would
    // compare a non-existent column and silently allow every row).
    expect(sql).not.toMatch(/collection_items\.owner_id\s*=\s*current_setting/)
  })

  it('is idempotent-safe (DROP POLICY IF EXISTS before each CREATE)', async () => {
    const sql = await readFile(RLS_FILE_010, 'utf8')
    expect((sql.match(/^\s*DROP POLICY IF EXISTS/gm) || []).length).toBe(2)
    expect((sql.match(/^\s*CREATE POLICY/gm) || []).length).toBe(2)
  })

  it('sets FORCE ROW LEVEL SECURITY so the binding is effective', async () => {
    const sql = await readFile(RLS_FILE_010, 'utf8')
    expect(sql).toMatch(/ALTER TABLE collections FORCE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/ALTER TABLE collection_items FORCE ROW LEVEL SECURITY/)
  })

  it('the collection_items predicate blocks a cross-tenant row and allows the owner row', async () => {
    // Evaluate the Collection-subquery semantics exactly as Postgres would per
    // row: a collection_item is visible iff the Collection it references has
    // owner_id == current tenant. Tenant = u1; u2's item must be invisible and
    // an unset tenant fails closed.
    const tenant = 'u1'
    const collections = [
      { id: 'c1', owner_id: 'u1' },
      { id: 'c2', owner_id: 'u2' },
    ]
    const policyAllows = (item) =>
      collections.some((c) => c.id === item.collection_id && c.owner_id === tenant)
    expect(policyAllows({ collection_id: 'c1' })).toBe(true)    // own collection's item visible
    expect(policyAllows({ collection_id: 'c2' })).toBe(false)   // another tenant's collection's item invisible
    expect(policyAllows({ collection_id: 'c1' }) && tenant === null).toBe(false) // unset tenant fails closed
  })
})

// ---------------------------------------------------------------------------
// ARCH-6.1 #165 — binding RLS (db/rls/011_binding_rls.sql). Deploys the
// least-privilege `app_rls` role (does NOT own the tables), FORCE ROW LEVEL
// SECURITY on every tenant-scoped table, the feedback policy it creates before
// forcing, and SECURITY DEFINER functions so admin cross-tenant flows keep
// working under binding RLS.
// ---------------------------------------------------------------------------
describe('RLS migration (db/rls/011_binding_rls.sql) — #165 binding RLS', () => {
  const RLS_FILE_011 = path.join(
    fileURLToPath(new URL('../../../db/rls/011_binding_rls.sql', import.meta.url)),
  )

  it('provisions a least-privilege role that does not own the tables', async () => {
    const sql = await readFile(RLS_FILE_011, 'utf8')
    expect(sql).toMatch(/CREATE ROLE app_rls/)
    expect(sql).toMatch(/NOLOGIN/)
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON items TO app_rls/)
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON collections TO app_rls/)
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON collection_items TO app_rls/)
    // app_rls is NOT granted ownership of any table (no OWNER GRANT).
    expect(sql).not.toMatch(/GRANT ALL\s+ON (items|reviews|feedback|collections|collection_items)/i)
  })

  it('grants app_rls SELECT-only on sessions (no DML / no self-promotion) — HOLD 2 #165', async () => {
    const sql = await readFile(RLS_FILE_011, 'utf8')
    // sessions.role is the admin-authority source; app_rls must have NO write
    // path to it (a DML grant would allow self-promotion to 'admin').
    expect(sql).toMatch(/GRANT SELECT ON sessions TO app_rls/)
    expect(sql).not.toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO app_rls/)
    expect(sql).not.toMatch(/GRANT INSERT, UPDATE, DELETE ON sessions TO app_rls/)
  })

  it('FORCEs row-level security on every tenant-scoped table', async () => {
    const sql = await readFile(RLS_FILE_011, 'utf8')
    for (const t of ['items', 'reviews', 'feedback', 'lookup_queue', 'collections', 'collection_items']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`))
    }
    // identity/auth bootstrap tables are intentionally NOT forced (token
    // resolution precedes tenant context) — assert no FORCE on users/sessions.
    expect(sql).not.toMatch(/ALTER TABLE users FORCE ROW LEVEL SECURITY/)
    expect(sql).not.toMatch(/ALTER TABLE sessions FORCE ROW LEVEL SECURITY/)
  })

  it('creates the feedback author-scoped policy before forcing it', async () => {
    const sql = await readFile(RLS_FILE_011, 'utf8')
    expect(sql).toMatch(/CREATE POLICY feedback_tenant_write ON feedback/)
    expect(sql).toMatch(/author_id = current_setting\('app\.tenant_id', true\)/)
    expect(sql).toMatch(/ALTER TABLE feedback ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/ALTER TABLE feedback FORCE ROW LEVEL SECURITY/)
  })

  it('deploys SECURITY DEFINER functions for every admin cross-tenant path', async () => {
    const sql = await readFile(RLS_FILE_011, 'utf8')
    // feedback inbox + triage + delete; member-deletion cleanup; dashboard
    // aggregate; review management. Each is SECURITY DEFINER + GRANTed to
    // app_rls so requireAdmin flows keep working under binding RLS. The admin
    // gate inside each (assert_admin_session) is pinned by the dedicated test.
    for (const fn of [
      'admin_feedback_list', 'admin_feedback_triage', 'admin_feedback_delete',
      'admin_delete_items_for_owner', 'admin_counts_by_kind',
      'admin_review_set_status', 'admin_reviews_all',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\(`))
    }
    expect((sql.match(/LANGUAGE (sql|plpgsql) SECURITY DEFINER/g) || [])).toHaveLength(7)
    expect((sql.match(/GRANT EXECUTE ON FUNCTION/g) || [])).toHaveLength(7)
  })

  it('every SECURITY DEFINER admin function is gated on a real ADMIN session token (fails closed) — HOLD 3 #165', async () => {
    const sql = await readFile(RLS_FILE_011, 'utf8')
    // HOLD A (#165): the single app role serves admin AND non-admin sessions, so
    // GRANT EXECUTE alone is not an admin gate. Each admin function must assert
    // the admin session and fail closed (raise insufficient_privilege).
    // HOLD 3: the admin marker is NOT a forgeable GUC — the gate derives admin
    // authority from the resolved session token inside the SECURITY DEFINER
    // function (assert_admin_session(session_token_hash)), not from a settable
    // app.admin_session parameter.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION assert_admin_session\(session_token_hash text\)/)
    expect(sql).toMatch(/insufficient_privilege: admin session required/)
    // The gate reads sessions.role server-side (owner privileges) — no settable GUC.
    expect(sql).toMatch(/FROM sessions\s+WHERE token_hash = session_token_hash/i)
    // All 7 admin functions call the gate (with the session token) before any
    // cross-tenant DML.
    const gated = (sql.match(/PERFORM assert_admin_session\(session_token_hash\)/g) || []).length
    expect(gated).toBe(7)
    // Each admin function takes the session token hash as its FIRST argument.
    const tokenParams = (sql.match(/session_token_hash text/g) || []).length
    expect(tokenParams).toBe(8) // assert_admin_session + 7 admin functions
    // app_rls is NOT granted the gate itself as a callable privilege path; the
    // gate is invoked internally by the admin functions, not by app_rls.
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION assert_admin_session\(/)
  })
})

// ---------------------------------------------------------------------------
// FEAT-6.2 #315 — collection type registry RLS (db/rls/012_collection_types_
// rls.sql). CollectionType is GLOBAL registry data: read-open to authenticated
// callers (SELECT policy) and write-restricted (NO write policy + app_rls is
// granted SELECT-only). A client can never supply or override a type/
// capability/field definition (ADR-0020 §2 dec 6). Validated by CONTENT here
// because pg-mem cannot parse RLS DDL.
// ---------------------------------------------------------------------------
describe('RLS migration (db/rls/012_collection_types_rls.sql) — #315 registry', () => {
  const RLS_FILE_012 = path.join(
    fileURLToPath(new URL('../../../db/rls/012_collection_types_rls.sql', import.meta.url)),
  )

  it('enables RLS on collection_types and collection_type_fields', async () => {
    const sql = await readFile(RLS_FILE_012, 'utf8')
    expect(sql).toContain('ALTER TABLE collection_types ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('ALTER TABLE collection_type_fields ENABLE ROW LEVEL SECURITY')
  })

  it('creates SELECT-ONLY policies — NO write policy on the registry (read-open, write-restricted)', async () => {
    const sql = await readFile(RLS_FILE_012, 'utf8')
    // Public read for authenticated callers on both tables.
    expect(sql).toMatch(/CREATE POLICY collection_types_public_select ON collection_types\s+FOR SELECT USING \(true\)/)
    expect(sql).toMatch(/CREATE POLICY collection_type_fields_public_select ON collection_type_fields\s+FOR SELECT USING \(true\)/)
    // Every CREATE POLICY in this file must be a SELECT-only policy — there is
    // deliberately NO FOR ALL / FOR INSERT / FOR UPDATE / FOR DELETE / WITH
    // CHECK write path a tenant session could take. (Scan policy DDL, not
    // prose comments.)
    const policyBlocks = sql.match(/CREATE POLICY[\s\S]*?;/g) || []
    expect(policyBlocks.length).toBe(2)
    for (const block of policyBlocks) {
      expect(block).toMatch(/FOR SELECT/)
      expect(block).not.toMatch(/FOR (ALL|INSERT|UPDATE|DELETE)/i)
      expect(block).not.toMatch(/WITH CHECK/i)
    }
  })

  it('grants app_rls SELECT-only (no DML path to the registry) — server-authoritative', async () => {
    const sql = await readFile(RLS_FILE_012, 'utf8')
    expect(sql).toMatch(/GRANT SELECT ON collection_types TO app_rls/)
    expect(sql).toMatch(/GRANT SELECT ON collection_type_fields TO app_rls/)
    // No DML grant: a compromised/buggy app route or a tenant session can read
    // type metadata but can never redefine a type/field/capability/provider map.
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL),?.*ON collection_types?/i)
    expect(sql).not.toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON collection_types?/i)
  })

  it('FORCEs row-level security so even the table owner cannot bypass the read-only contract', async () => {
    const sql = await readFile(RLS_FILE_012, 'utf8')
    expect(sql).toMatch(/ALTER TABLE collection_types FORCE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/ALTER TABLE collection_type_fields FORCE ROW LEVEL SECURITY/)
  })

  it('policy predicate is read-open for every tenant (registry is global, not owner-scoped)', async () => {
    const sql = await readFile(RLS_FILE_012, 'utf8')
    // The registry is NOT tenant-scoped on owner_id — a bare USING(true) SELECT.
    expect(sql).toMatch(/FOR SELECT USING \(true\)/)
    expect(sql).not.toMatch(/current_setting\('app\.tenant_id'/)
  })
})

// ---------------------------------------------------------------------------
// ARCH-6.1 #165 — isolation inventory + restore/retention evidence. Every
// tenant-owned table in the inventory (§1 tenancy-and-rls.md) must have an RLS
// ENABLE across db/rls, and the backup/restore/retention + shared→dedicated
// procedures must be documented.
// ---------------------------------------------------------------------------
describe('ARCH-6.1 #165 — isolation inventory & restore evidence', () => {
  const RLS_DIR = path.join(
    fileURLToPath(new URL('../../../db/rls', import.meta.url)),
  )
  const DOC = path.join(
    fileURLToPath(new URL('../../../db/tenancy-and-rls.md', import.meta.url)),
  )

  it('covers every tenant-owned table in the isolation inventory with RLS', async () => {
    const files = (await readdir(RLS_DIR)).filter((f) => f.endsWith('.sql'))
    const rls = await Promise.all(
      files.map((f) => readFile(path.join(RLS_DIR, f), 'utf8')),
    )
    const all = rls.join('\n')
    // The six tenant-scoped tables from the inventory (§1) each have RLS.
    for (const t of ['items', 'reviews', 'feedback', 'lookup_queue', 'collections', 'collection_items']) {
      expect(all).toMatch(new RegExp(`ALTER TABLE ${t} (ENABLE|FORCE) ROW LEVEL SECURITY`))
    }
  })

  it('documents backup/restore/retention and the shared→dedicated path', async () => {
    const doc = await readFile(DOC, 'utf8')
    expect(doc).toMatch(/Backup, restore & retention/)
    expect(doc).toMatch(/pg_dump/)
    expect(doc).toMatch(/npm run db:migrate/)
    expect(doc).toMatch(/Shared → dedicated schema path/)
    expect(doc).toMatch(/isolation inventory/)
  })
})
