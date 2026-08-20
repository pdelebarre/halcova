// tenant-rls.js — per-request tenant context for binding PostgreSQL Row Level
// Security (ARCH-6.1 #165, M3 prerequisite). When RLS is BINDING
// (db/rls/011_binding_rls.sql deploys FORCE ROW LEVEL SECURITY + the
// least-privilege `app_rls` role that does not own the tables), every tenant
// policy predicate filters on current_setting('app.tenant_id', true), so the
// app MUST set the resolved session's user.id as the tenant before touching
// tenant-scoped data. An unset tenant fails closed (no rows).
//
// We set the custom GUC with `set_config('app.tenant_id', $1, true)`, the
// parameterized, SET-LOCAL-equivalent (is_local=true scopes it to the current
// transaction). This is used instead of the literal `SET LOCAL app.tenant_id
// = '…'` for two reasons:
//   * it is parameterized (no string interpolation of the resolved user id);
//   * the pg-mem emulator used by the repo unit tests cannot parse the bare
//     `SET LOCAL app.tenant_id = '…'` form (the dotted GUC name breaks its
//     parser), but it DOES parse `SELECT set_config('app.tenant_id', $1, true)`
//     — so the wiring stays exercised in unit tests.
//
// The wiring is OPT-IN: a caller passes a `tenantId` when it has resolved the
// session user. Repos that already scope every query by owner_id in the WHERE
// clause (the primary tenant boundary) continue to work unchanged when no
// tenant is passed; the tenant context is the defense-in-depth layer that makes
// the RLS policies effective once binding RLS is deployed.

// The SQL that sets app.tenant_id for the current transaction. `db` is any
// node-postgres-shaped pool/client ({ query }).
export function tenantContextSql(tenantId) {
  return {
    text: 'SELECT set_config($1, $2, true)',
    params: ['app.tenant_id', String(tenantId)],
  }
}

// Set the tenant context on a connection. No-op when tenantId is null/empty.
export async function setTenantContext(db, tenantId) {
  if (tenantId == null || tenantId === '') return
  await db.query(tenantContextSql(tenantId).text, tenantContextSql(tenantId).params)
}

// ADMIN session context for the SECURITY DEFINER admin cross-tenant functions
// (db/rls/011_binding_rls.sql). Those functions execute with the owner's
// privileges and bypass RLS, so they are a privilege-escalation surface. They
// fail closed unless the session carries this ADMIN marker, which the app sets
// ONLY after requireAdmin() passes (Multi-tenant-Security HOLD A #165). It uses
// the same set_config(..., is_local=true) transaction-scoped form as the tenant
// context, so it is parameterized and pg-mem-compatible.
export function adminContextSql() {
  return { text: 'SELECT set_config($1, $2, true)', params: ['app.admin_session', '1'] }
}

// Set the ADMIN session context on a connection. Call this immediately after
// requireAdmin() succeeds and within the same transaction/connection the admin
// DML runs on. Without it the SECURITY DEFINER admin functions raise and do no
// DML (fail closed). No-op on pg-mem-safe consumers is handled by callers.
export async function setAdminContext(db) {
  await db.query(adminContextSql().text, adminContextSql().params)
}

// Run `fn(repo)` inside a BEGIN/COMMIT/ROLLBACK transaction with
// app.tenant_id set for its duration (when tenantId is provided). `createRepo`
// binds a repo to the same client so every statement commits atomically. Any
// throw rolls back and rethrows. Mirrors the shape the repositories'
// transaction() helpers already use, adding the RLS tenant context.
export async function withTenantTransaction(db, createRepo, tenantId, fn) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    if (tenantId != null && tenantId !== '') {
      await client.query(tenantContextSql(tenantId).text, tenantContextSql(tenantId).params)
    }
    const result = await fn(createRepo(client))
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* connection may be dead */ }
    throw err
  } finally {
    client.release()
  }
}
