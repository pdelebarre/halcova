// Shared test helper for SEC-EPIC-1 (session-token auth): mints a REAL session
// token against the CURRENT repository backend — the in-memory @netlify/blobs
// mock (runout-sessions store) or the pg-mem Postgres `sessions` table — so
// handler-level tests can authenticate as an owner / demo / member exactly like
// the running app does after login.
//
// The raw token is what the client would hold; the server stores only its
// sha256 hash. `resolveSession` reconstructs the owner/demo constant identities
// from (role, userId); members must be seeded (users store / users table) with
// the matching userId before the token is used.

import { createSession } from './sessions'

export async function sessionTokenFor({ userId, role = 'member' }) {
  const { token } = await createSession({ userId, role })
  return token
}

// Convenience factories for the three identities the tests use.
export const adminSessionToken = () => sessionTokenFor({ userId: 'owner', role: 'admin' })
export const demoSessionToken = () => sessionTokenFor({ userId: 'demo', role: 'demo' })
