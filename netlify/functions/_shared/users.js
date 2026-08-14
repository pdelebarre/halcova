// Facade over the identity store, backed by the repository interface
// (ADR-0002 Phase 1). Exposes the SAME function names the functions have always
// imported, so auth.js / admin.js / discogs.js / books.js / collection-store.js
// are untouched:
//   - DATABASE_URL unset  -> the Blobs implementation (runout-identity store),
//     byte-for-byte identical to before (see repositories/blob-users.js).
//   - DATABASE_URL set    -> the Postgres repo (read DB first, fall back to
//     Blobs on miss/error; writes dual-write to both — see repository.js).
//
// The blob layout and per-member store helpers (`storeNameFor`,
// `deleteUserCollections`) stay here; `deleteUserCollections` also removes the
// member's Postgres items when Postgres is configured so nothing orphans.

import { getRepository } from './repository'
import { deleteUserCollections as blobDeleteUserCollections, getUser as blobGetUser } from './repositories/blob-users'

export { storeNameFor } from './repositories/blob-users'

export const listUsers = () => getRepository().users.listUsers()
export const getUser = (id) => getRepository().users.getUser(id)
export const saveUser = (user) => getRepository().users.saveUser(user)
export const removeUserRecord = (id) => getRepository().users.removeUserRecord(id)
export const findUserByCode = (code) => getRepository().users.findUserByCode(code)
export const findUserByEmail = (email) => getRepository().users.findUserByEmail(email)
export const listRequests = () => getRepository().users.listRequests()
export const getRequest = (id) => getRepository().users.getRequest(id)
export const saveRequest = (request) => getRepository().users.saveRequest(request)
export const removeRequest = (id) => getRepository().users.removeRequest(id)
export const findPendingRequestByEmail = (email) => getRepository().users.findPendingRequestByEmail(email)
// S3 (ADR-0003 §2.5): O(1) webhook-idempotency lookups keyed on the Stripe
// billing ids — a replayed webhook event resolves the already-materialized user
// in one read instead of re-creating it.
export const findUserByStripeSession = (id) => getRepository().users.findUserByStripeSession(id)
export const findUserByStripeSubscription = (id) => getRepository().users.findUserByStripeSubscription(id)

// The plaintext access code for a user, read from the legacy Blobs mirror
// (runout-identity). Postgres stores only the sha256 hash (ADR-0002 Part B);
// the S1/S3 dual-write keeps the plaintext in the mirror so the S3 status poll
// can return the issued code to its owner exactly once over HTTPS without ever
// storing plaintext in Postgres. Returns null when the mirror has no record
// (e.g. the owner, who is never stored).
export async function plaintextCodeFor(userId) {
  const record = await blobGetUser(userId)
  return record?.code || null
}

// Delete every blob in a member's two collection stores (used on user delete),
// plus their Postgres items when Postgres is configured (owner is a no-op).
export async function deleteUserCollections(userId) {
  await blobDeleteUserCollections(userId)
  const repo = getRepository()
  if (repo.backend === 'postgres') {
    try { await repo.items.deleteAllForOwner(userId) } catch { /* best-effort */ }
  }
}
