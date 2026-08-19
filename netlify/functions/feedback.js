// netlify/functions/feedback.js — member feedback submissions + the admin inbox
// (feat/feedback, T3 — issue #80, epic #74).
//
// Feedback is PRIVATE to its author + the owner (unlike reviews there is no
// public list): members write, the admin reads the inbox, triages status and
// leaves an owner-only internal admin note. Two auth surfaces, mirroring
// reviews.js / admin.js:
//
//   POST   — the member submission. Authenticated with a Bearer access code OR
//            the admin key (authorize from _shared/collection-store). The
//            author (id + display name) is derived SERVER-SIDE from the
//            session — never trusted from the body — and submissions are
//            rate-limited per identity (5/hr by default) so a runaway client
//            can't flood the inbox. -> 201 { id, … }
//   GET    — the admin inbox (admin key only, like admin.js). Newest-first
//            list with optional ?status= / ?type= filters. -> { items }
//   PATCH  — admin triage (admin key only): { id, status?, adminNote? }.
//            -> the updated feedback (404 unknown id / junk id)
//   DELETE — admin removal (admin key only): ?id= -> 204 (404 unknown)
//
// The data layer is reached through the repository seam (repository.js) —
// Postgres when DATABASE_URL is set, Blobs otherwise. On a Postgres ERROR (an
// outage) the handler returns a controlled 503 DATA_SOURCE_UNAVAILABLE rather
// than masking the outage with a Blobs mirror (SEC-4.1 #202 — parity with
// collection.js / reviews.js).
//
// Security: no access code / admin key / code_hash is ever read, logged or
// returned here. Feedback objects carry only the author's public display name
// (never their code/email), and admin ops are gated on the admin key before
// any work runs.

import { getStore } from '@netlify/blobs'
import { json } from './_shared/collection-store'
import { enforce } from './_shared/policy'
import { filterFor } from './_shared/filter'
import { createRateLimiter, rateLimitIdentity } from './_shared/rate-limit'
import { getRepository } from './_shared/repository'
import { readJsonBody, safeError } from './_shared/security'

const RATE_LIMITS_STORE = 'runout-rate-limits'

// Per-identity submission limit for POST — 5 per hour by default (a runaway
// client or a stuck loop can't flood the inbox). Configurable via env; exported
// so the handler tests can seed the counter for the exact window.
// The env overrides are clamped to positive integers (Math.max(1, …)) so a bad
// env (0 / negative / NaN) can never self-DoS the endpoint by setting a limit
// that rejects every submission or a window that breaks the counter math.
export const FEEDBACK_RATE_LIMIT = Math.max(1, Math.floor(Number(process.env.RUNOUT_FEEDBACK_RATE_LIMIT) || 5))
export const FEEDBACK_RATE_WINDOW_MS = Math.max(1, Math.floor(Number(process.env.RUNOUT_FEEDBACK_RATE_WINDOW_MS) || 3_600_000))

// Length caps. `message` matches the Postgres CHECK (1–4000, 006_feedback.sql):
// an over-long message is REJECTED, never truncated — the repo contract.
const MESSAGE_MAX = 4000
const ADMIN_NOTE_MAX = 4000
const URL_MAX = 2000
const APP_VERSION_MAX = 100
const USER_AGENT_MAX = 500

// Allow-lists (006_feedback.sql). Junk is REJECTED at the API boundary with a
// clean 400 — never a 500, and never silently mis-filed on a user record.
const FEEDBACK_TYPES = new Set(['suggestion', 'bug'])
const FEEDBACK_CATEGORIES = new Set(['records', 'books', 'scanner', 'auth', 'billing', 'games', 'lending', 'other'])
const FEEDBACK_STATUSES = new Set(['open', 'in_progress', 'done', 'wontfix', 'duplicate'])

// The public display name stamped on feedback. NEVER the access code or email
// (those are separate secret fields — see publicUser in _shared/auth.js). The
// owner has no stored name (authorize resolves them as a constant), so fall
// back to a fixed label like reviews.js's authorNameFor.
function authorNameFor(user) {
  const name = String(user?.name || '').trim()
  if (name) return name.slice(0, 80)
  return user?.role === 'admin' ? 'Admin' : 'A Runout member'
}

// Read a JSON body, tolerating a malformed/absent one (→ {}) so junk input is
// rejected by validation with a clean 400, never a 500.
async function readBody(req) {
  // SEC-3.2 (#195): cap the JSON body before parsing (413 over the cap);
  // malformed JSON -> 400. Returns { value } on success or { error: <Response> }.
  const parsed = await readJsonBody(req)
  if (parsed.error) return parsed
  return { value: parsed.value ?? {} }
}

// Validate a POST submission. Returns { …fields } on success, or
// { error: <Response> } carrying a 400 on the first problem. `message` is
// trimmed and required; `type`/`category` are allow-listed (with defaults).
function validateSubmission(body) {
  const message = String(body?.message ?? '').trim()
  if (!message) {
    return { error: json(400, { error: 'A message is required.', code: 'MESSAGE_REQUIRED' }) }
  }
  if (message.length > MESSAGE_MAX) {
    return { error: json(400, { error: `Message is too long (max ${MESSAGE_MAX} characters).`, code: 'MESSAGE_TOO_LONG' }) }
  }
  // `type` defaults to 'suggestion'; anything outside the allow-list is
  // rejected — a typo surfaces as a clean 400 rather than being silently
  // filed under the wrong kind.
  const type = body?.type ?? 'suggestion'
  if (!FEEDBACK_TYPES.has(type)) {
    return { error: json(400, { error: 'Unknown type — must be "suggestion" or "bug".', code: 'INVALID_TYPE' }) }
  }
  const category = body?.category ?? 'other'
  if (!FEEDBACK_CATEGORIES.has(category)) {
    return { error: json(400, { error: 'Unknown category.', code: 'INVALID_CATEGORY' }) }
  }
  return {
    type,
    category,
    message,
    url: String(body?.url ?? '').slice(0, URL_MAX),
    appVersion: String(body?.appVersion ?? '').slice(0, APP_VERSION_MAX),
  }
}

// Validate an admin triage PATCH. Returns { id, patch } on success, or
// { error: <Response> } carrying a 400. `status` must be in the allow-list;
// at least one of status/adminNote must be present.
function validateTriage(body, url) {
  const id = url.searchParams.get('id') || body?.id
  if (!id) return { error: json(400, { error: 'Missing id.', code: 'MISSING_ID' }) }
  const patch = {}
  if (body?.status !== undefined && !FEEDBACK_STATUSES.has(body.status)) {
    return { error: json(400, { error: 'Unknown status.', code: 'INVALID_STATUS' }) }
  }
  if (body?.status !== undefined) patch.status = body.status
  if (body?.adminNote !== undefined) patch.adminNote = String(body.adminNote).slice(0, ADMIN_NOTE_MAX)
  if (patch.status === undefined && patch.adminNote === undefined) {
    return { error: json(400, { error: 'Nothing to update.', code: 'NOTHING_TO_UPDATE' }) }
  }
  return { id, patch }
}

// POST — create a feedback row/entry. The author (id + display name) comes
// from the authenticated session, never the body; the user-agent is read from
// the request header, also server-side.
//
// SEC-7.2 (#339): the POST response is the AUTHOR-facing DTO — it routes
// through the feedback allowlist (filterFor), which strips the admin-only
// `adminNote` (C7). The internal note is only ever present in the admin inbox
// view, never in a submission response.
async function handleCreate(req, feedback, user, v) {
  const item = await feedback.createFeedback({
    type: v.type,
    category: v.category,
    message: v.message,
    authorId: user.id,
    authorName: authorNameFor(user),
    url: v.url,
    appVersion: v.appVersion,
    userAgent: String(req.headers?.get?.('user-agent') || '').slice(0, USER_AGENT_MAX),
  })
  return json(201, filterFor(user, 'feedback', item))
}

// GET — the admin inbox, newest first, optionally status- AND/OR type-filtered.
// Junk filters are a no-op in both repos (never a 500). The inbox carries
// private member feedback (PII-adjacent), so the response is explicitly
// uncacheable (no-store) and never shared (private) — a proxy/CDN must not
// serve a cached copy to a different admin session.
async function handleList(feedback, url, user) {
  const items = await feedback.listFeedback({
    status: url.searchParams.get('status') || undefined,
    type: url.searchParams.get('type') || undefined,
  })
  // SEC-7.2 (#339): the inbox is the ADMIN view — each entry keeps the internal
  // adminNote (admin-only, C7) via the feedback allowlist (admin:true).
  const visible = items.map((f) => filterFor(user, 'feedback', f, { admin: true }))
  return json(200, { items: visible }, { 'Cache-Control': 'no-store, private' })
}

// PATCH — admin triage (status and/or adminNote). 404 for an unknown/junk id.
// The response is the ADMIN view (keeps adminNote, C7).
async function handleUpdate(feedback, id, patch, user) {
  const updated = await feedback.updateFeedback(id, patch)
  if (!updated) return json(404, { error: 'Not found' })
  return json(200, filterFor(user, 'feedback', updated, { admin: true }))
}

// DELETE — admin removes a row. 204 on success, 404 unknown/junk id.
async function handleDelete(feedback, id) {
  const ok = await feedback.deleteFeedback(id)
  if (!ok) return json(404, { error: 'Not found' })
  return new Response(null, { status: 204 })
}

// Rate-limit POST submissions per identity (user id; owner is 'owner'). A
// limited identity gets a 429 + Retry-After; the limiter degrades to letting
// the request through if its own store read/write fails (never a 500).
async function submissionGuardError(req, user) {
  const identity = rateLimitIdentity(user, req)
  if (!identity) return null
  const limiter = createRateLimiter({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'feedback',
    limit: FEEDBACK_RATE_LIMIT,
    windowMs: FEEDBACK_RATE_WINDOW_MS,
  })
  const rl = await limiter(identity)
  if (rl.limited) {
    return json(429, { error: 'Too many submissions — try again later.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
  }
  return null
}

// Run one op against the repository seam's feedback store. When Postgres is
// the active backend and an op throws (an outage), the request returns a
// controlled 503 DATA_SOURCE_UNAVAILABLE — the outage is NOT masked by serving
// a possibly-divergent Blobs mirror (SEC-4.1 #202). Blobs errors propagate to
// the handler's outer catch (→ 500).
async function dispatch(op) {
  const repo = getRepository()
  try {
    return await op(repo.feedback)
  } catch (err) {
    if (repo.backend === 'postgres') {
      // SEC-4.1 (#202): a Postgres outage is NOT masked by serving a Blobs
      // mirror (which could diverge) — surface a controlled 503; the real
      // detail goes to the log only (message, never a secret/stack).
      console.error('feedback: Postgres data source unavailable (503):', err?.message || err)
      return json(503, {
        error: 'The feedback service is temporarily unavailable. Please try again shortly.',
        code: 'DATA_SOURCE_UNAVAILABLE',
      })
    }
    throw err
  }
}

// Admin inbox operations (GET/PATCH/DELETE) — already gated on the admin key
// by the caller. `user` is the resolved admin session identity (used for the
// admin-view DTO allowlist). Returns 405 for any other method.
async function routeAdmin(req, url, user) {
  if (req.method === 'GET') return dispatch((feedback) => handleList(feedback, url, user))
  if (req.method === 'PATCH') {
    const parsed = await readBody(req)
    if (parsed.error) return parsed.error
    const body = parsed.value
    const v = validateTriage(body, url)
    if (v.error) return v.error
    return dispatch((feedback) => handleUpdate(feedback, v.id, v.patch, user))
  }
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id')
    if (!id) return json(400, { error: 'Missing id.', code: 'MISSING_ID' })
    return dispatch((feedback) => handleDelete(feedback, id))
  }
  return json(405, { error: 'Method not allowed' })
}

export default async function feedbackHandler(req) {
  try {
    const url = new URL(req.url)

    // Admin inbox operations (GET/PATCH/DELETE) require an admin SESSION — gated
    // through the shared policy layer (`feedback:moderate`, requires:'admin'),
    // exactly like admin.js (SEC-1.6, #181). SEC-7.1 (#338): the method-branch
    // is centralized in the policy table.
    if (req.method !== 'POST') {
      const admin = await enforce(req, 'feedback:moderate')
      if (admin.error) return admin.error
      return routeAdmin(req, url, admin.user)
    }

    // POST — the member submission (Bearer access code OR admin key). The
    // author is resolved server-side from the session; the demo identity is
    // denied by the policy layer (`feedback:create` deny:['demo'],
    // DEMO_READONLY). SEC-7.1 (#338): the principal is always the session user.
    const { user, error } = await enforce(req, 'feedback:create', {
      denyCode: 'DEMO_READONLY',
      denyMessage: 'The demo space is read-only. Sign in to send feedback.',
    })
    if (error) return error
    const guardErr = await submissionGuardError(req, user)
    if (guardErr) return guardErr
    const parsed = await readBody(req)
    if (parsed.error) return parsed.error
    const body = parsed.value
    const v = validateSubmission(body)
    if (v.error) return v.error
    return dispatch((feedback) => handleCreate(req, feedback, user, v))
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
