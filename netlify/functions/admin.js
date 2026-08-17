// Admin API — owner-only. Authorized by the SESSION's role (SEC-1.6, #181):
// the owner signs in with RUNOUT_ADMIN_KEY (login exchanges it for an admin
// session token in auth.js), and every admin call carries
// `Authorization: Bearer <sessionToken>`. requireAdmin() rejects anything that
// isn't a live admin session — a member session or a forged/absent key is
// 401/403. Handles the "accept new users" flow:
//   - list pending requests + members
//   - approve a request (grants Records and/or Books, returns the access code)
//   - reject a request
//   - change a member's collection access / disable them
//   - delete a member (their collection stores AND their reviews)
//   - moderate community reviews (hide / show / delete, plus a listing)

import { randomUUID } from 'node:crypto'
import { OWNER_ID, generateAccessCode, publicUser } from './_shared/auth'
import { requireAdmin } from './_shared/session-auth'
import { deleteAllForUser, revokeAllForUser } from './_shared/sessions'
import { parsePagination } from './_shared/pagination'
import { db, isPostgresConfigured } from './_shared/postgres'
import { createReviewsRepo } from './_shared/repositories/reviews-repo'
import { createReviewsBlobStore } from './_shared/reviews-blob'
import { createFeedbackRepo } from './_shared/repositories/feedback-repo'
import { createFeedbackBlobStore } from './_shared/feedback-blob'
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

// Reviews data-path dispatch (Task 5 + Task 7) — the SAME Postgres-first /
// Blobs-fallback choice reviews.js makes, so admin moderation and the
// deleteUser review cleanup behave identically whether the app is on Postgres
// or Blobs. Both backends (createReviewsRepo / createReviewsBlobStore) expose
// the same ops; `op` runs against the active store and its result is returned
// as { backend, result } — `backend` so callers that need path-specific
// handling (the Blobs listAll ignores limit/offset) can react.
async function withReviews(op) {
  if (isPostgresConfigured()) {
    try {
      return { backend: 'postgres', result: await op(createReviewsRepo(db)) }
    } catch (err) {
      console.error('admin: Postgres reviews path failed, falling back to Blobs:', err?.message || err)
    }
  }
  return { backend: 'blobs', result: await op(createReviewsBlobStore()) }
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
  // Rotating the credential also kills any live sessions issued under the old
  // code (SEC-EPIC-1 defense in depth) — the member signs in again with the
  // new code.
  await revokeAllForUser(user.id)
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
  // A disabled member's live sessions die immediately (SEC-1.9, #184) —
  // defense in depth on top of the per-request status check in resolveSession.
  if (user.status === 'disabled') await revokeAllForUser(user.id)
  return json(200, { user: publicUser(user) })
}

// Task 7 (M2) — deleteUser review cleanup. Removes the member's reviews from
// the backend that is AUTHORITATIVE for reviews, and never silently from a
// DIFFERENT one:
//   - Blobs path (DATABASE_URL unset): the shared Blobs store is the only home
//     of reviews — clean it.
//   - Postgres path (DATABASE_URL set): Postgres is the authoritative home.
//     The Postgres cleanup MUST succeed — falling back to a Blobs-only cleanup
//     (as withReviews would on a Postgres error) would leave the Postgres rows
//     orphaned once the member is deleted. A Postgres failure therefore
//     surfaces: the whole deleteUser 500s and the member is NOT deleted (see
//     the ordering in handleDeleteUser). A best-effort Blobs sweep then catches
//     any read-through writes that landed in Blobs while Postgres was down —
//     parity with deleteUserCollections' dual-clean.
// Idempotent in both backends (a member with no reviews is a no-op).
async function deleteMemberReviews(userId) {
  if (!isPostgresConfigured()) {
    await createReviewsBlobStore().deleteByAuthor(userId)
    return
  }
  const repo = createReviewsRepo(db)
  await repo.deleteByAuthor(userId)
  try {
    await createReviewsBlobStore().deleteByAuthor(userId)
  } catch { /* the authoritative Postgres cleanup already succeeded */ }
}

// T8 (H1) — deleteUser feedback cleanup. The member's feedback is PRIVATE to
// them + the owner (authored message, author_name, url, user_agent), so it
// must go when the member is deleted — GDPR right-to-erasure parity with the
// reviews cleanup above. Same structure as deleteMemberReviews:
//   - Blobs path (DATABASE_URL unset): the shared runout-feedback Blobs store
//     is the only home of feedback — clean it.
//   - Postgres path (DATABASE_URL set): Postgres is the authoritative home.
//     The Postgres cleanup MUST succeed — falling back to a Blobs-only cleanup
//     (as withReviews would on a Postgres error) would leave the Postgres rows
//     orphaned once the member is deleted. A Postgres failure therefore
//     surfaces: the whole deleteUser 500s and the member is NOT deleted (see
//     the ordering in handleDeleteUser). A best-effort Blobs sweep then catches
//     any read-through writes that landed in Blobs while Postgres was down.
// Idempotent in both backends (a member with no feedback is a no-op).
async function deleteMemberFeedback(userId) {
  if (!isPostgresConfigured()) {
    await createFeedbackBlobStore().deleteByAuthor(userId)
    return
  }
  const repo = createFeedbackRepo(db)
  await repo.deleteByAuthor(userId)
  try {
    await createFeedbackBlobStore().deleteByAuthor(userId)
  } catch { /* the authoritative Postgres cleanup already succeeded */ }
}

async function handleDeleteUser(body) {
  if (!body.userId) return json(400, { error: 'Missing userId.' })
  if (body.userId === OWNER_ID) return json(400, { error: 'The owner account cannot be deleted.' })
  const user = await getUser(body.userId)
  if (!user) return json(404, { error: 'User not found.' })

  // Task 7 (M2) + T8 (H1): a member's reviews AND feedback go with them. This
  // runs FIRST, before the user record is removed, so a failed cleanup aborts
  // the whole delete — a member is never left deleted with orphaned rows
  // (reviews pointing at a removed author, or feedback retaining the member's
  // PII) on either backend. Cleanup is idempotent in both backends, so a retry
  // after a partial failure is safe. NOTE: reviews belong to the RELEASE and
  // feedback to the AUTHOR — these run only on user deletion, never on item
  // removal from a collection.
  await deleteMemberReviews(user.id)
  await deleteMemberFeedback(user.id)
  await deleteUserCollections(user.id)
  await removeUserRecord(user.id)
  // The member's sessions go with the account (SEC-1.9, #184) — no orphaned
  // live session can outlive a deleted user.
  await deleteAllForUser(user.id)
  return json(200, { ok: true })
}

// Task 5 — admin review moderation. All three are admin-key-only (the default
// export 401s before any action runs). Each returns { ok: true } on success,
// 400 for a missing reviewId and 404 for an unknown one — consistent with the
// rest of admin.js.
async function handleHideReview(body) {
  if (!body.reviewId) return json(400, { error: 'Missing reviewId.' })
  const { result: ok } = await withReviews((store) => store.setStatus(body.reviewId, 'hidden'))
  if (!ok) return json(404, { error: 'Review not found.' })
  return json(200, { ok: true })
}

async function handleShowReview(body) {
  if (!body.reviewId) return json(400, { error: 'Missing reviewId.' })
  const { result: ok } = await withReviews((store) => store.setStatus(body.reviewId, 'published'))
  if (!ok) return json(404, { error: 'Review not found.' })
  return json(200, { ok: true })
}

async function handleDeleteReview(body) {
  if (!body.reviewId) return json(400, { error: 'Missing reviewId.' })
  // Admin override: deleteReview removes the row/entry regardless of author.
  const { result: ok } = await withReviews((store) => store.deleteReview(body.reviewId))
  if (!ok) return json(404, { error: 'Review not found.' })
  return json(200, { ok: true })
}

export default async (req) => {
  try {
    // SEC-1.6 (#181): authorize by the SESSION's role, not by re-checking the
    // bearer equals ADMIN_KEY. The admin key only ever minted this session at
    // login (auth.js); a member session or a forged/absent key is rejected.
    const admin = await requireAdmin(req)
    if (admin.error) return admin.error

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const [requests, users] = await Promise.all([listRequests(), listUsers()])
      // Part B: codes are hashed. The admin list no longer carries plaintext
      // codes (nor their hashes) — re-reveal is replaced by the `rotate` action,
      // which mints a NEW code and returns it exactly once. publicUser strips
      // both `code` and `code_hash`, so the list never leaks either, regardless
      // of which backend served it (the Blobs fallback still holds plaintext).
      const body = { requests, users: users.map(publicUser) }
      // Task 5 — admin review moderation listing. Opt-in via ?reviews=1 so the
      // member-list call the AdminPanel makes stays lightweight. All reviews,
      // newest first, paginated (pagination.js), with an optional ?status=
      // filter (published | pending | hidden). Review objects never carry
      // codes/emails — only the public authorName + kind + sourceId + rating +
      // body + status + timestamps (the same shape reviews.js serves).
      if (url.searchParams.get('reviews') === '1') {
        const { offset, limit } = parsePagination(url.searchParams)
        const status = url.searchParams.get('status') || undefined
        const { backend, result } = await withReviews((store) => store.listAll({ status, limit, offset }))
        // The Postgres repo applies LIMIT/OFFSET in SQL; the Blobs store
        // ignores them and returns the whole newest-first list — slice there.
        body.reviews = backend === 'blobs' ? result.slice(offset, offset + limit) : result
        body.limit = limit
        body.offset = offset
      }
      return json(200, body)
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      switch (body.action) {
        case 'approve': return handleApprove(body)
        case 'reject': return handleReject(body)
        case 'updateUser': return handleUpdateUser(body)
        // M2 — await so a rejected deleteUser (e.g. the reviews cleanup failing
        // with Postgres down) is caught by the outer try/catch and surfaces as a
        // clean 500 instead of an unhandled rejection. The member is NOT deleted.
        case 'deleteUser': return await handleDeleteUser(body)
        case 'rotate': return handleRotate(body)
        case 'hideReview': return handleHideReview(body)
        case 'showReview': return handleShowReview(body)
        case 'deleteReview': return handleDeleteReview(body)
        default: return json(400, { error: 'Unknown action.' })
      }
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return json(500, { error: err.message || 'Internal error' })
  }
}
