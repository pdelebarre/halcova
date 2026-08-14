// CRUD helpers over the identity blob store: users and signup requests.
//
// Layout inside the single "runout-identity" store:
//   user:<id>      -> { id, name, email, code, collections:{records,books},
//                       features:{lending},   // per-account capability flags; off by default
//                       plan:'free'|'unlimited', // free-tier plan; defaults to 'free'
//                       role:'admin'|'member', status:'active'|'disabled', createdAt }
//   request:<id>   -> { id, name, email, status:'pending'|'approved'|'rejected', createdAt }
//   index:users    -> ordered list of user ids
//   index:requests -> ordered list of request ids
//
// `features` is a map of per-account capability flags (currently only
// `{ lending: boolean }`). New members start without it (absent/false) — the
// admin grants `features.lending` via approve / updateUser (see admin.js);
// the owner always has `features: { lending: true }` (see authorize()).
//
// `plan` is the free-tier plan: new members are stamped `'free'` on approve
// (see admin.js) and reads default to `'free'` when the field is absent (no
// record migration needed). The owner is implicitly unlimited (planLimitFor
// in _shared/plans.js).
//
// Access codes are stored in plaintext so an admin can re-reveal a lost code
// from the admin panel. The blob store is private to the site; this is an
// acceptable trade-off at this scale (see docs/technical.md § Security).

import { getStore } from '@netlify/blobs'
import { normalizeCode } from './codes'

const IDENTITY_STORE = 'runout-identity'
const USER_PREFIX = 'user:'
const REQUEST_PREFIX = 'request:'
const USERS_INDEX = 'index:users'
const REQUESTS_INDEX = 'index:requests'
const CODE_INDEX_PREFIX = 'code:'

const identity = () => getStore(IDENTITY_STORE)

async function listRecords(prefix, indexKey) {
  const store = identity()
  const ids = (await store.get(indexKey, { type: 'json' })) || []
  const records = await Promise.all(ids.map((id) => store.get(`${prefix}${id}`, { type: 'json' })))
  return records.filter(Boolean)
}

async function saveRecord(prefix, indexKey, record) {
  const store = identity()
  await store.setJSON(`${prefix}${record.id}`, record)
  const ids = (await store.get(indexKey, { type: 'json' })) || []
  if (!ids.includes(record.id)) await store.setJSON(indexKey, [...ids, record.id])
}

async function removeRecord(prefix, indexKey, id) {
  const store = identity()
  await store.delete(`${prefix}${id}`)
  const ids = (await store.get(indexKey, { type: 'json' })) || []
  await store.setJSON(indexKey, ids.filter((x) => x !== id))
}

// ---- Users ----

// Every stored user may predate the `plan` field (no migration was run), so
// reads normalize it here — the single choke point every user read flows
// through (listUsers feeds findUserByCode, and getUser covers direct lookups).
function normalizeUser(user) {
  if (!user) return null
  return { ...user, plan: user.plan || 'free' }
}

export const listUsers = async () => (await listRecords(USER_PREFIX, USERS_INDEX)).map(normalizeUser)
export const getUser = async (id) => normalizeUser(await identity().get(`${USER_PREFIX}${id}`, { type: 'json' }))

// ---- Access-code index (T1, ADR-0002 Phase 0) ----
//
// `findUserByCode` used to scan every user record on EVERY authenticated
// request — O(n) over all users. A `code:<normalized>` → `userId` key makes it
// a single blob read. The index is maintained by saveUser (on approve and on
// any code change/rotation) and by removeUserRecord. A missing entry (stores
// written before the index existed) falls back to the O(n) scan ONCE and
// writes the entry — so no account breaks and every pre-existing account is
// backfilled lazily on first use.

async function setCodeIndex(userId, code) {
  const norm = normalizeCode(code)
  if (!norm) return
  await identity().setJSON(`${CODE_INDEX_PREFIX}${norm}`, userId)
}

async function deleteCodeIndex(code) {
  const norm = normalizeCode(code)
  if (!norm) return
  await identity().delete(`${CODE_INDEX_PREFIX}${norm}`)
}

// Save a user and keep the access-code index in sync. When a code changes
// (approve mints a fresh code; a future rotate path re-stamps one), the old
// `code:` key is dropped and the new one written. Users without a code (the
// owner is never stored) skip the index entirely.
export async function saveUser(user) {
  const existing = await getUser(user.id)
  const oldCode = normalizeCode(existing?.code)
  const newCode = normalizeCode(user?.code)
  await saveRecord(USER_PREFIX, USERS_INDEX, user)
  if (oldCode && oldCode !== newCode) await deleteCodeIndex(oldCode)
  if (newCode) await setCodeIndex(user.id, user.code)
}

export async function removeUserRecord(id) {
  const existing = await getUser(id)
  if (existing?.code) await deleteCodeIndex(existing.code)
  await removeRecord(USER_PREFIX, USERS_INDEX, id)
}

// Resolve a member by access code — O(1) via the `code:<normalized>` index.
// Normalizes INSIDE (trim + uppercase) so every caller is consistent whether
// the bearer was pre-uppercased (auth.js) or passed raw (the
// collection/discogs/books authorize()s) — stored codes are uppercase, so
// existing behavior is preserved. Returns the same shape as today: the full
// user record via getUser (plan normalized to 'free' when absent). Missing
// index entries fall back to the O(n) scan and write the entry (lazy
// backfill), so pre-Phase-0 stores keep working.
export async function findUserByCode(code) {
  const norm = normalizeCode(code)
  if (!norm) return null
  const store = identity()

  let userId = null
  try {
    userId = await store.get(`${CODE_INDEX_PREFIX}${norm}`, { type: 'json' })
  } catch {
    userId = null
  }
  if (userId) {
    const user = await getUser(userId)
    if (user && normalizeCode(user.code) === norm) return user
  }

  // Lazy backfill — no index entry (or a stale one pointing nowhere).
  const users = await listUsers()
  const match = users.find((u) => normalizeCode(u.code) === norm) || null
  if (match) {
    try { await setCodeIndex(match.id, match.code) } catch { /* best-effort */ }
  }
  return match
}

// ---- Signup requests ----

export const listRequests = () => listRecords(REQUEST_PREFIX, REQUESTS_INDEX)
export const saveRequest = (req) => saveRecord(REQUEST_PREFIX, REQUESTS_INDEX, req)
export const removeRequest = (id) => removeRecord(REQUEST_PREFIX, REQUESTS_INDEX, id)
export const getRequest = async (id) => identity().get(`${REQUEST_PREFIX}${id}`, { type: 'json' })

export async function findPendingRequestByEmail(email) {
  const norm = String(email || '').trim().toLowerCase()
  if (!norm) return null
  const requests = await listRequests()
  return requests.find(
    (r) => r.status === 'pending' && String(r.email || '').trim().toLowerCase() === norm,
  ) || null
}

// ---- Per-member collection stores ----

const STORE_NAMES = { records: 'runout-collection', books: 'runout-library' }

// The owner keeps the legacy stores (zero migration); every member gets their
// own isolated store per collection kind.
export function storeNameFor(userId, collection) {
  if (userId === 'owner') return STORE_NAMES[collection] || STORE_NAMES.records
  return `collection-${userId}-${collection}`
}

// Delete every blob in a member's two collection stores (used on user delete).
export async function deleteUserCollections(userId) {
  if (userId === 'owner') return
  for (const kind of ['records', 'books']) {
    const store = getStore(`collection-${userId}-${kind}`)
    const listing = await store.list()
    const keys = listing.keys || []
    if (keys.length) await Promise.all(keys.map((entry) => store.delete(entry.key)))
  }
}
