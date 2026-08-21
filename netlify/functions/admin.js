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
import { getStore } from '@netlify/blobs'
import { OWNER_ID, generateAccessCode, publicUser } from './_shared/auth'
import { enforce } from './_shared/policy'
import { deleteAllForUser, revokeAllForUser } from './_shared/sessions'
import { parsePagination } from './_shared/pagination'
import { db, isPostgresConfigured } from './_shared/postgres'
import { createReviewsRepo } from './_shared/repositories/reviews-repo'
import { createReviewsBlobStore } from './_shared/reviews-blob'
import { createFeedbackRepo } from './_shared/repositories/feedback-repo'
import { createFeedbackBlobStore } from './_shared/feedback-blob'
import { clientIp, rateLimitGuard } from './_shared/rate-limit'
import { badRequest, json, readJsonBody, safeError } from './_shared/security'
import { emailHash, logAudit } from './_shared/audit'
import { anomalyScope, recordAnomaly } from './_shared/anomaly'
import { getDashboardCounts } from './_shared/dashboard-counts'
import {
  activateProviderProfile,
  createProviderProfile,
  deleteProviderProfile,
  listProviderProfiles,
  testProviderProfile,
  updateProviderProfile,
} from './_shared/ai/ai-admin'
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

const RATE_LIMITS_STORE = 'runout-rate-limits'
// SEC-3.6 (#199): admin actions get their own per-IP limit (the owner is a
// single high-trust identity, so a per-user limit would be pointless). A
// compromised-but-limited source can't script a flood of admin writes. The
// limit is generous (the owner is expected to act) but present and
// env-tunable, matching the collection/auth limiters.
const ADMIN_LIMIT = Number(process.env.RUNOUT_ADMIN_RATE_LIMIT) || 120
// SEC-7.4 (#341): per-ACCOUNT admin limiter (keyed on the resolved admin user
// id) on TOP of the per-IP limit, so a single admin account is bounded even if
// it rotates IPs; and an OVERALL cap so one account (or one IP) can't consume
// the whole per-window admin budget. See docs/operational-thresholds.md.
const ADMIN_ACCOUNT_LIMIT = Number(process.env.RUNOUT_ADMIN_ACCOUNT_RATE_LIMIT) || 120
const ADMIN_OVERALL_LIMIT = Number(process.env.RUNOUT_ADMIN_OVERALL_RATE_LIMIT) || 400


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
  const v = validateId(body.requestId, 'requestId')
  if (v.error) return badRequest(v.error)
  const request = await getRequest(v.value)
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
  logAudit('admin.approve', { requestId: request.id, userId: user.id, emailHash: emailHash(user.email), collections })

  return json(201, { user: publicUser(user), code: user.code })
}

async function handleReject(body) {
  const v = validateId(body.requestId, 'requestId')
  if (v.error) return badRequest(v.error)
  const request = await getRequest(v.value)
  if (!request) return json(404, { error: 'Request not found.' })
  if (request.status !== 'pending') return json(409, { error: 'That request was already handled.' })
  await saveRequest({ ...request, status: 'rejected', rejectedAt: new Date().toISOString() })
  logAudit('admin.reject', { requestId: request.id })
  return json(200, { ok: true })
}

// Part B: the admin "re-reveal a lost code" becomes ROTATION. The member's
// stored code is unrecoverable (only the sha256 hash is kept), so the admin
// mints a brand-new code, stores its hash, and returns the new plaintext in
// this response exactly once — the admin hands it to the member out of band.
// The response shape matches approve ({ user, code }) so the client's existing
// "here is the code" box can reuse it.
async function handleRotate(body) {
  const v = validateId(body.userId, 'userId')
  if (v.error) return badRequest(v.error)
  if (v.value === OWNER_ID) return json(400, { error: 'The owner account cannot be edited here.' })
  const user = await getUser(v.value)
  if (!user) return json(404, { error: 'User not found.' })

  const newCode = generateAccessCode()
  // saveUser hashes the code on the Postgres path (sole authority) and keeps
  // the plaintext Blobs mirror in sync during read-through.
  await saveUser({ ...user, code: newCode })
  // Rotating the credential also kills any live sessions issued under the old
  // code (SEC-EPIC-1 defense in depth) — the member signs in again with the
  // new code.
  await revokeAllForUser(user.id)
  logAudit('admin.rotate', { userId: user.id })
  return json(200, { user: publicUser(user), code: newCode })
}

async function handleUpdateUser(body) {
  const v = validateId(body.userId, 'userId')
  if (v.error) return badRequest(v.error)
  if (v.value === OWNER_ID) return json(400, { error: 'The owner account cannot be edited here.' })
  const user = await getUser(v.value)
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
  logAudit('admin.update_user', { userId: user.id, status: user.status })
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
export async function deleteMemberReviews(userId) {
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
export async function deleteMemberFeedback(userId) {
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
  const v = validateId(body.userId, 'userId')
  if (v.error) return badRequest(v.error)
  if (v.value === OWNER_ID) return json(400, { error: 'The owner account cannot be deleted.' })
  const user = await getUser(v.value)
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
  logAudit('admin.delete_user', { userId: user.id, emailHash: emailHash(user.email) })
  return json(200, { ok: true })
}

// Task 5 — admin review moderation. All three are admin-key-only (the default
// export 401s before any action runs). Each returns { ok: true } on success,
// 400 for a missing reviewId and 404 for an unknown one — consistent with the
// rest of admin.js.
async function handleHideReview(body) {
  const v = validateId(body.reviewId, 'reviewId')
  if (v.error) return badRequest(v.error)
  const { result: ok } = await withReviews((store) => store.setStatus(v.value, 'hidden'))
  if (!ok) return json(404, { error: 'Review not found.' })
  return json(200, { ok: true })
}

async function handleShowReview(body) {
  const v = validateId(body.reviewId, 'reviewId')
  if (v.error) return badRequest(v.error)
  const { result: ok } = await withReviews((store) => store.setStatus(v.value, 'published'))
  if (!ok) return json(404, { error: 'Review not found.' })
  return json(200, { ok: true })
}

async function handleDeleteReview(body) {
  const v = validateId(body.reviewId, 'reviewId')
  if (v.error) return badRequest(v.error)
  // Admin override: deleteReview removes the row/entry regardless of author.
  const { result: ok } = await withReviews((store) => store.deleteReview(v.value))
  if (!ok) return json(404, { error: 'Review not found.' })
  return json(200, { ok: true })
}

// (ADMIN-3.2, #304) — secure LLM provider-profile administration. All six are
// admin-only (the default export's requireAdmin gate rejects a member/demo
// session before any handler runs) and POST-rate-limited like every other
// admin write. Each action delegates to the ai-admin facade, which owns the
// security invariants: secrets are stored encrypted and NEVER returned
// (masked only), base_url is SSRF-validated before it is written, activation
// is atomic and only after a passing connection test, and audit events never
// carry the secret.
async function handleAiList() {
  const profiles = await listProviderProfiles()
  return json(200, { providers: profiles })
}

async function handleAiCreate(body) {
  const result = await createProviderProfile(body)
  if (result.error) return json(400, { error: result.error.message, code: result.error.code })
  return json(201, result)
}

async function handleAiUpdate(body) {
  const v = validateId(body.profileId, 'profileId')
  if (v.error) return badRequest(v.error)
  const result = await updateProviderProfile(v.value, body)
  if (result.error) return json(404, { error: result.error.message, code: result.error.code })
  return json(200, result)
}

async function handleAiDelete(body) {
  const v = validateId(body.profileId, 'profileId')
  if (v.error) return badRequest(v.error)
  const result = await deleteProviderProfile(v.value)
  if (result.error) return json(404, { error: result.error.message, code: result.error.code })
  return json(200, result)
}

async function handleAiTest(body) {
  const v = validateId(body.profileId, 'profileId')
  if (v.error) return badRequest(v.error)
  const result = await testProviderProfile(v.value)
  if (result.error) return json(400, { error: result.error.message, code: result.error.code })
  return json(200, result)
}

async function handleAiActivate(body) {
  const v = validateId(body.profileId, 'profileId')
  if (v.error) return badRequest(v.error)
  const result = await activateProviderProfile(v.value)
  if (result.error) return json(400, { error: result.error.message, code: result.error.code })
  return json(200, result)
}

// Validate the ids shared across admin actions (SEC-3.1, #194): requestId,
// userId and reviewId must be short, non-empty strings. Reused by each handler
// so the shape checks live in one place instead of being re-derived. The
// message keeps the field name (e.g. 'Missing reviewId.') for client parity.
function validateId(value, label) {
  const missing = value === undefined || value === null
    || (typeof value !== 'string' && typeof value !== 'number')
    || String(value).trim() === ''
  if (missing) return { error: { code: 'MISSING_ID', message: `Missing ${label}.` } }
  const v = String(value).trim()
  if (v.length > 200) return { error: { code: 'INVALID_ID', message: `${label} is too long.` } }
  return { value: v }
}

export default async (req) => {
  try {
    // SEC-1.6 (#181) + SEC-7.1 (#338): authorize by the SESSION's role through
    // the shared policy layer (`admin:*` requires:'admin'), not by re-checking
    // the bearer equals ADMIN_KEY. The admin key only ever minted this session
    // at login (auth.js); a member session or a forged/absent key is rejected.
    // normalizeReject (inside enforce) keeps the 401/403 shape stable.
    const admin = await enforce(req, 'admin:*')
    if (admin.error) {
      // SEC-6.6 (#220): a burst of authorization denials from one IP (a
      // non-admin probing the admin surface) is an anomaly signal.
      const denyIp = clientIp(req)
      if (denyIp) {
        // NIT M5: the burst-counter key (transient) may use the raw IP, but the
        // audit `scope` carries only a truncated hash — never the raw address.
        await recordAnomaly(getStore(RATE_LIMITS_STORE), `anom:admin:deny:${denyIp}`, { threshold: 10, signal: 'admin_denial_burst', scope: anomalyScope('anom:admin:deny', denyIp) })
      }
      return admin.error
    }

    // SEC-3.6 (#199): admin writes are rate-limited per IP. The owner is a
    // single identity, so keying on the client IP bounds a flood source.
    // SEC-7.4 (#341): also per-ACCOUNT (the resolved admin user id) and an
    // OVERALL cap so one account/IP can't consume the whole budget.
    // SEC-7.4.x (#383): each limiter routed through rateLimitGuard so 429s emit
    // `rate_limit.served` + the exhaust burst signal. The per-IP limiter keys
    // on the client IP, so its burstScope is an anonymous anomalyScope hash.
    if (req.method === 'POST') {
      const ip = clientIp(req)
      if (ip) {
        const rl = await rateLimitGuard({
          store: getStore(RATE_LIMITS_STORE),
          scope: 'admin',
          limit: ADMIN_LIMIT,
          identity: ip,
          anomalyStore: getStore(RATE_LIMITS_STORE),
          burstScope: anomalyScope('rlx:admin', ip),
        })
        if (rl) return rl
      }
      // Per-account (keyed on the resolved admin user id) + overall caps.
      if (admin.user?.id) {
        const acctRl = await rateLimitGuard({
          store: getStore(RATE_LIMITS_STORE),
          scope: 'admin:account',
          limit: ADMIN_ACCOUNT_LIMIT,
          identity: admin.user.id,
          anomalyStore: getStore(RATE_LIMITS_STORE),
        })
        if (acctRl) return acctRl
      }
      const overallRl = await rateLimitGuard({
        store: getStore(RATE_LIMITS_STORE),
        scope: 'admin:overall',
        limit: ADMIN_OVERALL_LIMIT,
        identity: 'all',
        anomalyStore: getStore(RATE_LIMITS_STORE),
      })
      if (overallRl) return overallRl
    }

    if (req.method === 'GET') {
      const url = new URL(req.url)
      // (ADMIN-EPIC-1, #264) — CWE-200 counts-only mode. The owner's PWA polls
      // GET /admin every 60s just to read counts.pendingRequests for the badge,
      // but the plain response returns the FULL requests+users lists (names +
      // emails). ?counts=1 returns ONLY the { counts } block: the requests/users
      // lists are never serialized into the response, so no PII leaves the
      // function. They are still LOADED internally — the user-derived metrics
      // (pendingRequests/members/signups/plans) aggregate from them — but never
      // built into a body. If both ?dashboard=1 and ?counts=1 are present,
      // dashboard wins (unchanged); the plain member-list call stays
      // byte-for-byte unchanged. requireAdmin already gated this GET.
      const wantDashboard = url.searchParams.get('dashboard') === '1'
      const wantCountsOnly = !wantDashboard && url.searchParams.get('counts') === '1'

      const [requests, users] = await Promise.all([listRequests(), listUsers()])
      if (wantCountsOnly) {
        return json(200, { counts: await getDashboardCounts({ requests, users }) })
      }

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
      // (ADMIN-EPIC-1, #259) — Dashboard counts. Opt-in via ?dashboard=1 so the
      // plain member-list call stays lightweight and byte-for-byte unchanged.
      // requireAdmin already gated this GET (member/demo/forged -> 401/403); the
      // counts block is AGGREGATES ONLY — never ids, emails, names, IPs or codes
      // (epic §5 data minimization; publicUser already strips codes from users).
      // User-derived metrics aggregate in memory from the requests/users this
      // GET already loads; feedback/reviews/collections prefer SQL on the
      // Postgres path and the Blobs stores otherwise (see dashboard-counts.js).
      if (wantDashboard) {
        body.counts = await getDashboardCounts({ requests, users })
      }
      // (ADMIN-3.2, #304) — AI provider-profile listing. Opt-in via
      // ?providers=1. requireAdmin already gated this GET; profiles are
      // returned with the secret MASKED (tail only) and never the ciphertext
      // or plaintext (the ai-admin facade strips them).
      if (url.searchParams.get('providers') === '1') {
        body.providers = await listProviderProfiles()
      }
      return json(200, body)
    }

    if (req.method === 'POST') {
      // SEC-3.2 (#195): cap the JSON body before parsing.
      const { value: body, error } = await readJsonBody(req)
      if (error) return error
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
        // (ADMIN-3.2, #304) — AI provider-profile administration.
        case 'aiCreate': return await handleAiCreate(body)
        case 'aiUpdate': return await handleAiUpdate(body)
        case 'aiDelete': return await handleAiDelete(body)
        case 'aiTest': return await handleAiTest(body)
        case 'aiActivate': return await handleAiActivate(body)
        default: return json(400, { error: 'Unknown action.' })
      }
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
