// netlify/functions/reviews.js — community reviews API (feat/reviews, Task 4).
//
// Reviews are SHARED across ALL users: a release's reviews are public, so
// unlike collections/items there is NO per-user store — one shared
// `runout-reviews` blob store, or the `reviews` Postgres table when
// DATABASE_URL is set (chosen via isPostgresConfigured()). On a Postgres
// ERROR (an outage) the handler returns a controlled 503
// DATA_SOURCE_UNAVAILABLE rather than masking the outage with a Blobs mirror
// (SEC-4.1 #202 — parity with collection.js).
//
// Auth on every request (Bearer access code / admin key — `authorize` from
// _shared/collection-store), a per-kind plan gate for members (a member
// without the kind's plan is 403 PLAN_FORBIDDEN), and per-identity rate
// limiting on WRITES (POST/DELETE). Reads (GET) stay open to any
// authenticated caller.
//
// Route surface:
//   GET    /reviews?kind=<records|books>&sourceId=<id>
//          -> 200 { reviews: [published, newest first], aggregate: { avg,
//             count }, mine: <caller's own review (any status) | null> }
//   POST   /reviews  body { kind, sourceId, rating (int 1..5), body (<=2000) }
//          -> 201 { review } on create / 200 { review } on update (upsert —
//             one review per member per release, never a duplicate)
//   DELETE /reviews?id=<reviewId> (kind/sourceId optional)
//          -> 200 { ok: true }; 404 not found; 403 someone else's review
//   *      any other method -> 405 (collection.js has no OPTIONS/CORS handling
//          either, so neither do we)

import { getStore } from '@netlify/blobs'
import { COLLECTIONS, json } from './_shared/collection-store'
import { enforce, forbidden } from './_shared/policy'
import { filterMany } from './_shared/filter'
import { consumeDistinct, createRateLimiter, rateLimitIdentity, rateLimitKey } from './_shared/rate-limit'
import { isPostgresConfigured, db } from './_shared/postgres'
import { createReviewsRepo } from './_shared/repositories/reviews-repo'
import { createReviewsBlobStore } from './_shared/reviews-blob'
import { isValidSourceId, sourceIdError } from './_shared/reviews-shared'
import { readJsonBody, safeError } from './_shared/security'

const RATE_LIMITS_STORE = 'runout-rate-limits'
// Per-identity fixed-window limit for review WRITES (POST/DELETE); GET stays
// open (the list + aggregate are public once you're authenticated).
const REVIEWS_RATE_LIMIT = Number(process.env.RUNOUT_REVIEWS_RATE_LIMIT) || 30
// SEC-7.4 (#341): per-identity READ limiter for the GET path. Reviews are
// public-but-shared (the list + aggregate are expensive scans across a shared
// store), so a runaway client hammering one release's thread is throttled.
// Deliberately GENEROUS (300/min default) — must never throttle legit reads.
const REVIEWS_READ_LIMIT = Number(process.env.RUNOUT_REVIEWS_READ_RATE_LIMIT) || 300
// M3 — per-release write limiting: how many DISTINCT sourceIds one identity can
// open a review thread on per kind per window (see writeGuardError). Bounds
// new-thread creation across arbitrary releases; editing releases you already
// reviewed stays free. Exported so the handler tests can seed the counter.
export const REVIEWS_DISTINCT_LIMIT = Number(process.env.RUNOUT_REVIEWS_DISTINCT_LIMIT) || 10

const BODY_MAX_LENGTH = 2000
const RATINGS = new Set([1, 2, 3, 4, 5])
const REVIEW_STATUS_PUBLISHED = 'published'

// The public display name stamped on a review. NEVER the access code or email
// (those are separate secret fields — see publicUser in _shared/auth.js). The
// owner has no stored name (authorize resolves them as a constant), so fall
// back to a fixed label like auth.js's profileForCode ('Admin').
function authorNameFor(user) {
  const name = String(user?.name || '').trim()
  if (name) return name.slice(0, 80)
  return user?.role === 'admin' ? 'Admin' : 'A Runout member'
}

// Validate the POST body. Returns { rating, body } on success, or
// { error: <Response> } carrying a 400 on the first problem.
function validateReview(body, { kind, sourceId }) {
  if (!kind || !COLLECTIONS[kind]) {
    return { error: json(400, { error: 'Unknown collection.', code: 'INVALID_KIND' }) }
  }
  if (!sourceId) {
    return { error: json(400, { error: 'Missing sourceId', code: 'MISSING_SOURCE_ID' }) }
  }
  // M1 — server-side sourceId validation BEFORE any store write: the Blobs
  // release key is `release:<kind>:<sourceId>` (split on `:`), so a `:` or
  // control char inside the id breaks the key split, and unbounded ids pollute
  // the shared store / the unbounded `source_id text` rows in Postgres.
  const srcErr = sourceIdError(sourceId, kind)
  if (srcErr) {
    return { error: json(400, { error: srcErr.message, code: srcErr.code }) }
  }
  const rating = Number(body?.rating)
  if (!Number.isInteger(rating) || !RATINGS.has(rating)) {
    return { error: json(400, { error: 'Rating must be an integer from 1 to 5.', code: 'INVALID_RATING' }) }
  }
  const trimmed = String(body?.body ?? '').trim()
  if (trimmed.length > BODY_MAX_LENGTH) {
    return { error: json(400, { error: `Review is too long (max ${BODY_MAX_LENGTH} characters).`, code: 'BODY_TOO_LONG' }) }
  }
  return { rating, body: trimmed }
}

// Store-agnostic route logic. `store` is any object with the reviews ops
// (listReviews / getByAuthor / upsertReview / getReview / deleteReview) — both
// the Postgres repo (createReviewsRepo) and the Blobs store
// (createReviewsBlobStore) expose them (Task 3), so one dispatcher serves both
// backends and the read-through fallback.
async function handleStore(req, store, ctx) {
  if (req.method === 'GET') return handleGet(store, ctx)
  if (req.method === 'POST') return handlePost(store, ctx)
  if (req.method === 'DELETE') return handleDelete(store, ctx)
  return json(405, { error: 'Method not allowed' })
}

// GET — a release's published reviews (newest first) + the aggregate, plus
// "mine": the caller's own review, ANY status, so the composer can prefill a
// pending/hidden draft too (getByAuthor in both repos).
async function handleGet(store, { user, kind, sourceId }) {
  if (!sourceId) return json(400, { error: 'Missing sourceId', code: 'MISSING_SOURCE_ID' })
  const srcErr = sourceIdError(sourceId, kind)
  if (srcErr) return json(400, { error: srcErr.message, code: srcErr.code })
  const { reviews, aggregate } = await store.listReviews(kind, sourceId, { status: REVIEW_STATUS_PUBLISHED })
  const mine = await store.getByAuthor(kind, sourceId, user.id)
  // L1 + SEC-7.1 (#338): the list is PUBLIC — strip other reviewers' internal
  // authorId via the shared property-filter (filterFor). Only the caller's own
  // entry keeps it (so the client can dedupe against `mine`, which always
  // carries the caller's id). The aggregate is unaffected (it only reads rating).
  const visible = filterMany(user, 'review', reviews, { owns: (r) => r.authorId === user.id })
  return json(200, { reviews: visible, aggregate, mine })
}

// POST — upsert the CALLER's review. A pre-existing review by this author is
// an EDIT (200); otherwise it's a CREATE (201). The upsert itself is atomic in
// both backends (ON CONFLICT in Postgres / last-write-wins merge on authorId
// in Blobs), so a concurrent duplicate can never be written.
async function handlePost(store, { user, kind, sourceId, body }) {
  const validated = validateReview(body, { kind, sourceId })
  if (validated.error) return validated.error
  const existing = await store.getByAuthor(kind, sourceId, user.id)
  const review = await store.upsertReview({
    kind,
    sourceId,
    authorId: user.id,
    authorName: authorNameFor(user),
    rating: validated.rating,
    body: validated.body,
    // No `status`: a new review defaults to 'published'; an edit keeps the
    // existing status (preserve-on-undefined in both repos — an admin's
    // 'hidden'/'pending' is never silently reset).
  })
  return json(existing ? 200 : 201, { review })
}

// DELETE — only the author, or the owner (admin key holder), may delete a
// review. SEC-7.1 (#338) non-enumeration: a NON-admin caller gets a uniform 403
// FORBIDDEN whether the review is someone else's OR doesn't exist — the server
// never distinguishes "exists but isn't yours" from "doesn't exist" to a
// non-owner. Only the admin (allowOverride) gets a genuine 404 for a truly
// missing review (no enumeration risk for the owner, who may operate on any
// object).
async function handleDelete(store, { user, id }) {
  if (!id) return json(400, { error: 'Missing id', code: 'MISSING_ID' })
  if (user.role !== 'admin') {
    const review = await store.getReview(id)
    if (!review || review.authorId !== user.id) return forbidden()
  }
  // Admin (owner) override: may delete any review. A genuinely missing review
  // is a real 404 for the admin (who can operate on any object).
  const ok = await store.deleteReview(id)
  if (!ok) return json(404, { error: 'Not found' })
  return json(200, { ok: true })
}

// The Blobs-backed handler — reached when DATABASE_URL is absent, or as the
// read-through fallback when the Postgres path errors (parity with
// collection.js's handleBlobs).
async function handleBlobs(req, ctx) {
  try {
    return await handleStore(req, createReviewsBlobStore(), ctx)
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}

// Postgres-backed handler. DB-level errors are deliberately NOT caught here —
// they propagate to the default export, which returns a controlled 503
// DATA_SOURCE_UNAVAILABLE instead of serving a possibly-divergent Blobs mirror
// (SEC-4.1 #202 — parity with collection-postgres.js/collection.js).
//
// Exported (in addition to the default) so the pg path can be exercised
// directly in tests with an injected pg-mem `db`, mirroring how
// collection-postgres.js is tested.
export async function handlePostgres(req, ctx) {
  return handleStore(req, createReviewsRepo(db), ctx)
}

// POST carries kind/sourceId in the BODY (the route contract); GET/DELETE take
// them from the query string. Parse the body once so the plan gate + rate-limit
// scope can read the kind before the store handler runs.
async function parseRequest(req) {
  const url = new URL(req.url)
  const queryKind = url.searchParams.get('kind')
  const querySourceId = url.searchParams.get('sourceId')
  const id = url.searchParams.get('id')
  const isPost = req.method === 'POST'
  const parsed = isPost ? await readBody(req) : null
  if (parsed?.error) return { error: parsed.error }
  const body = parsed?.value ?? null
  const kind = isPost ? (body?.kind || queryKind) : queryKind
  const sourceId = isPost ? (body?.sourceId || querySourceId) : querySourceId
  return { kind, sourceId, id, body }
}

async function readBody(req) {
  // SEC-3.2 (#195): cap the JSON body before parsing (413 over the cap);
  // malformed JSON -> 400. Returns { value } on success or { error: <Response> }.
  const parsed = await readJsonBody(req)
  if (parsed.error) return parsed
  return { value: parsed.value ?? {} }
}

// Kind gate: required + known for GET/POST; only validated (when present) on
// DELETE, which keys off `id` alone.
function kindError(req, kind) {
  if (req.method === 'DELETE' && (!kind || COLLECTIONS[kind])) return null
  if (!kind) return json(400, { error: 'Missing kind.', code: 'INVALID_KIND' })
  if (!COLLECTIONS[kind]) return json(400, { error: 'Unknown collection.', code: 'INVALID_KIND' })
  return null
}

// Plan gate: a member without the kind's plan can't read or write reviews for
// it (mirrors collection.js's per-collection check, plus a code).
function planError(user, kind) {
  if (kind && !user.collections?.[kind]) {
    return json(403, { error: `Your plan doesn't include the ${kind} collection.`, code: 'PLAN_FORBIDDEN' })
  }
  return null
}

// Writes are rate-limited per identity and blocked for the read-only demo (the
// SHARED reviews store must never be polluted by the constant demo identity).
// Order mirrors collection.js: rate limit, then demo guard.
async function writeGuardError(req, user, kind, sourceId) {
  const identity = rateLimitIdentity(user, req)
  if (identity) {
    const limiter = createRateLimiter({
      store: getStore(RATE_LIMITS_STORE),
      scope: `reviews:${kind}`,
      limit: REVIEWS_RATE_LIMIT,
    })
    const rl = await limiter(identity)
    if (rl.limited) {
      return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
    }
    // M3 — per-release write limiting: the limiter above counts every write
    // (edits included) per identity per kind, so one member could open
    // REVIEWS_RATE_LIMIT new threads/min across arbitrary releases. This cap
    // counts DISTINCT sourceIds written per identity per kind per window —
    // editing a release you already touched this window stays free. A junk id
    // is skipped (validateReview rejects it downstream anyway) so garbage never
    // pollutes the counter.
    if (req.method === 'POST' && isValidSourceId(sourceId, kind)) {
      const distinct = await consumeDistinct(
        getStore(RATE_LIMITS_STORE),
        rateLimitKey(`reviews-distinct:${kind}`, identity),
        sourceId,
        REVIEWS_DISTINCT_LIMIT,
      )
      if (distinct.limited) {
        return json(429, { error: 'Too many new releases reviewed — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(distinct.retryAfter) })
      }
    }
  }
  if (user.role === 'demo') {
    return json(403, { error: 'The demo space is read-only. Sign in to write reviews.', code: 'DEMO_READONLY' })
  }
  return null
}

// GET reads are rate-limited per identity with a GENEROUS cap; the shared
// reviews store must not be scanned unbounded times by one client. Returns a
// 429 Response on limit, else null.
async function readGuardError(req, user) {
  const identity = rateLimitIdentity(user, req)
  if (!identity) return null
  const limiter = createRateLimiter({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'reviews:read',
    limit: REVIEWS_READ_LIMIT,
  })
  const rl = await limiter(identity)
  if (rl.limited) {
    return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
  }
  return null
}

// Map the HTTP method to the SEC-7.1 policy action. Unknown methods fall back
// to the least-restrictive read action so auth is still gated before the 405.
function actionFor(method) {
  if (method === 'GET') return 'review:read'
  if (method === 'POST') return 'review:create'
  if (method === 'DELETE') return 'review:delete'
  return 'review:read'
}

export default async function reviewsHandler(req) {
  try {
    // SEC-7.1 (#338): route authorization through the shared policy layer.
    // DELETE is owner-or-admin (review:delete); writes deny the read-only demo
    // identity (review:create). The principal is always the resolved session
    // user. Unsupported methods still resolve the session first (auth gating
    // before the 405).
    const action = actionFor(req.method)
    const { user, error } = await enforce(req, action, {
      denyCode: 'DEMO_READONLY',
      denyMessage: 'The demo space is read-only. Sign in to write reviews.',
      // The review:delete ownership decision (owner-or-admin, non-enumerating)
      // is made in handleDelete — the policy table declares the rule, and this
      // closure lets the admin allowOverride apply at the right layer. The
      // real target lookup happens once, inside handleDelete.
      ...(action === 'review:delete' ? { ownsTarget: async () => true } : {}),
    })
    if (error) return error

    const parsedReq = await parseRequest(req)
    if (parsedReq.error) return parsedReq.error
    const { kind, sourceId, id, body } = parsedReq

    const kindErr = kindError(req, kind)
    if (kindErr) return kindErr

    const planErr = planError(user, kind)
    if (planErr) return planErr

    if (req.method === 'POST' || req.method === 'DELETE') {
      const guardErr = await writeGuardError(req, user, kind, sourceId)
      if (guardErr) return guardErr
    } else if (req.method === 'GET') {
      const readErr = await readGuardError(req, user)
      if (readErr) return readErr
    }

    const ctx = { user, kind, sourceId, id, body }
    // Postgres when configured (DB first, Blobs fallback on error); Blobs
    // otherwise.
    if (isPostgresConfigured()) {
      try {
        return await handlePostgres(req, ctx)
      } catch (err) {
        // SEC-4.1 (#202): a Postgres outage is NOT masked by serving a Blobs
        // mirror (which could diverge) — surface a controlled 503; the real
        // detail goes to the log only (message, never a secret/stack).
        console.error('reviews: Postgres data source unavailable (503):', err?.message || err)
        return json(503, {
          error: 'The reviews service is temporarily unavailable. Please try again shortly.',
          code: 'DATA_SOURCE_UNAVAILABLE',
        })
      }
    }
    return handleBlobs(req, ctx)
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
