// Admin API — only reachable with the admin key (RUNOUT_ADMIN_KEY), sent as
// `Authorization: Bearer <key>`. Handles the "accept new users" flow:
//   - list pending requests + members
//   - approve a request (grants Records and/or Books, returns the access code)
//   - reject a request
//   - change a member's collection access / disable them
//   - delete a member (and their collection stores)

import { randomUUID } from 'node:crypto'
import { ADMIN_KEY, OWNER_ID, bearer, generateAccessCode, publicUser } from './_shared/auth'
import {
  deleteUserCollections,
  getRequest,
  getUser,
  listRequests,
  listUsers,
  removeUserRecord,
  saveRequest,
  saveUser,
} from './_shared/users'

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json' },
})

function sanitizeCollections(collections) {
  return {
    records: !!collections?.records,
    books: !!collections?.books,
  }
}

// Only these plan values exist. Anything else is rejected (returns null) — an
// unknown plan must never be silently accepted onto a user record.
// S2 (ADR-0003 §2.3): `premium` (subscription) and `lifetime` (one-time) join
// the enum; `unlimited` is the grandfathered private-test value; `free` is the
// only capped plan. The billing fields are NOT settable here — the S3 payment
// webhook materializes them; the admin only ever picks the plan.
function sanitizePlan(value) {
  if (value === 'free' || value === 'premium' || value === 'lifetime' || value === 'unlimited') return value
  return null
}

// Only these per-account feature flags exist. Anything a client sends that
// isn't in this list is dropped, and every value is coerced to a boolean — a
// client can never smuggle arbitrary feature payloads onto a user record.
// `lending` = loan-out dashboard (W3); `games` = the Play surface (persona,
// quiz, XP, shelf stories — Phase 1 § Play).
export const KNOWN_FEATURES = ['lending', 'games']

// Accepts body.features (e.g. { lending: true, games: true }) and returns the
// complete known-features map, every value coerced to a boolean:
//   { lending: false, games: false }  when missing/empty or all-false.
// NOTE: the map is rebuilt from whatever is sent, so a client must send the
// FULL map it wants to persist — toggling one flag must not silently drop the
// others (see AdminPanel.toggleFeature / toggleGames, which always send both).
export function sanitizeFeatures(features) {
  const result = {}
  for (const key of KNOWN_FEATURES) result[key] = !!features?.[key]
  return result
}

function hasAccess(collections) {
  return !!(collections && (collections.records || collections.books))
}

async function handleApprove(body) {
  if (!body.requestId) return json(400, { error: 'Missing requestId.' })
  const request = await getRequest(body.requestId)
  if (!request) return json(404, { error: 'Request not found.' })
  if (request.status !== 'pending') return json(409, { error: 'That request was already handled.' })

  const collections = sanitizeCollections(body.collections)
  if (!hasAccess(collections)) {
    return json(400, { error: 'Grant at least one collection (Records and/or Books).' })
  }

  const user = {
    id: randomUUID(),
    name: request.name,
    email: request.email,
    collections,
    features: sanitizeFeatures(body.features),
    // New members start on the free tier (T1); the admin can upgrade later.
    plan: 'free',
    code: generateAccessCode(),
    role: 'member',
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  await saveUser(user)
  await saveRequest({ ...request, status: 'approved', approvedAt: new Date().toISOString() })

  return json(201, { user: publicUser(user), code: user.code })
}

async function handleReject(body) {
  if (!body.requestId) return json(400, { error: 'Missing requestId.' })
  const request = await getRequest(body.requestId)
  if (!request) return json(404, { error: 'Request not found.' })
  if (request.status !== 'pending') return json(409, { error: 'That request was already handled.' })
  await saveRequest({ ...request, status: 'rejected', rejectedAt: new Date().toISOString() })
  return json(200, { ok: true })
}

// Part B: the admin "re-reveal a lost code" becomes ROTATION. The member's
// stored code is unrecoverable (only the sha256 hash is kept), so the admin
// mints a brand-new code, stores its hash, and returns the new plaintext in
// this response exactly once — the admin hands it to the member out of band.
// The response shape matches approve ({ user, code }) so the client's existing
// "here is the code" box can reuse it.
async function handleRotate(body) {
  if (!body.userId) return json(400, { error: 'Missing userId.' })
  if (body.userId === OWNER_ID) return json(400, { error: 'The owner account cannot be edited here.' })
  const user = await getUser(body.userId)
  if (!user) return json(404, { error: 'User not found.' })

  const newCode = generateAccessCode()
  // saveUser hashes the code on the Postgres path (sole authority) and keeps
  // the plaintext Blobs mirror in sync during read-through.
  await saveUser({ ...user, code: newCode })
  return json(200, { user: publicUser(user), code: newCode })
}

async function handleUpdateUser(body) {
  if (!body.userId) return json(400, { error: 'Missing userId.' })
  if (body.userId === OWNER_ID) return json(400, { error: 'The owner account cannot be edited here.' })
  const user = await getUser(body.userId)
  if (!user) return json(404, { error: 'User not found.' })

  if (body.collections) {
    const collections = sanitizeCollections(body.collections)
    if (!hasAccess(collections)) {
      return json(400, { error: 'A member needs at least one collection.' })
    }
    user.collections = collections
  }
  if (body.features) user.features = sanitizeFeatures(body.features)
  if (body.status === 'active' || body.status === 'disabled') user.status = body.status
  if (body.plan !== undefined) {
    const plan = sanitizePlan(body.plan)
    if (!plan) return json(400, { error: 'Unknown plan.' })
    user.plan = plan
  }

  await saveUser(user)
  return json(200, { user: publicUser(user) })
}

async function handleDeleteUser(body) {
  if (!body.userId) return json(400, { error: 'Missing userId.' })
  if (body.userId === OWNER_ID) return json(400, { error: 'The owner account cannot be deleted.' })
  const user = await getUser(body.userId)
  if (!user) return json(404, { error: 'User not found.' })

  await removeUserRecord(user.id)
  await deleteUserCollections(user.id)
  return json(200, { ok: true })
}

export default async (req) => {
  try {
    if (bearer(req) !== ADMIN_KEY) {
      return json(401, { error: 'Admin key required. Set RUNOUT_ADMIN_KEY and sign in as the owner.' })
    }

    if (req.method === 'GET') {
      const [requests, users] = await Promise.all([listRequests(), listUsers()])
      // Part B: codes are hashed. The admin list no longer carries plaintext
      // codes (nor their hashes) — re-reveal is replaced by the `rotate` action,
      // which mints a NEW code and returns it exactly once. publicUser strips
      // both `code` and `code_hash`, so the list never leaks either, regardless
      // of which backend served it (the Blobs fallback still holds plaintext).
      return json(200, { requests, users: users.map(publicUser) })
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      switch (body.action) {
        case 'approve': return handleApprove(body)
        case 'reject': return handleReject(body)
        case 'updateUser': return handleUpdateUser(body)
        case 'deleteUser': return handleDeleteUser(body)
        case 'rotate': return handleRotate(body)
        default: return json(400, { error: 'Unknown action.' })
      }
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return json(500, { error: err.message || 'Internal error' })
  }
}
