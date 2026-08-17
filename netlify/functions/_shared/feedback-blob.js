// feedback-blob.js — Blobs fallback for the feedback data layer (feat/feedback,
// T2). Feedback is a member's suggestion or bug report, PRIVATE to the author +
// the owner (unlike reviews there is no public list): members write, the admin
// reads the inbox, triages status and leaves an owner-only internal admin note.
// There is ONE shared store (not per-user) — like reviews, the owner reads
// every member's feedback:
//
//   store: runout-feedback
//     fb:<id>      -> { feedback… }   (one blob per feedback, camelCase shape)
//     index:open   -> [ "<id>", … ]   (the inbox enumeration)
//
// `fb:<id>` holds the SAME camelCase feedback object that feedback-repo.js maps
// rows into — so the future feedback.js function can pick the Postgres or Blobs
// path without knowing which backend it's on.
//
// NOTE — Postgres (repositories/feedback-repo.js) is the REAL home for feedback.
// Blobs has a LOST-UPDATE RACE under concurrency: two admins triaging the same
// feedback concurrently both read `fb:<id>`, both merge, and the second write
// overwrites the first (Netlify Blobs has no transactions — ADR-0001). Postgres
// makes the status/admin_note update atomic. This module exists so the future
// feedback.js function can choose its path like collection.js does
// (DATABASE_URL ? postgres : blobs) and so a Postgres outage degrades to Blobs
// instead of 500ing.

import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { DEFAULT_LIMIT, MAX_LIMIT } from './pagination'

const FEEDBACK_STORE = 'runout-feedback'
const FB_PREFIX = 'fb:'
const OPEN_INDEX = 'index:open'

// The feedback status enum (migration 006). Junk statuses are no-ops (never a
// 500) — the status column has no CHECK, so the repo keeps junk out of the enum.
const FEEDBACK_STATUSES = new Set(['open', 'in_progress', 'done', 'wontfix', 'duplicate'])

// The feedback type enum (migration 006 has a CHECK on it). Junk types are
// coerced to the 'suggestion' default on create (a submitted feedback must
// never be lost) and ignored as list filters (never a 500).
const FEEDBACK_TYPES = new Set(['suggestion', 'bug'])

// Feedback ids are server-assigned UUIDs. A junk `?id=` must not 500 a request
// (a uuid column would throw on real Postgres) — guard every id-keyed lookup,
// exactly like items-repo's isUuid and feedback-repo's.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// A valid feedback status, or the 'open' default when absent/invalid.
function asStatus(value) {
  return value && FEEDBACK_STATUSES.has(value) ? value : 'open'
}

// A valid feedback type, or the 'suggestion' default when absent/invalid.
// Deliberately a coercion, not a no-op: a malformed `type` must never 500 a
// request, and a submitted feedback must never be silently dropped.
function asType(value) {
  return value && FEEDBACK_TYPES.has(value) ? value : 'suggestion'
}

// Newest first with the same id tiebreak as feedback-repo's
// `ORDER BY created_at DESC, id DESC`. Garbage timestamps (legacy/corrupt
// data) yield NaN, which `||` treats as falsy → falls back to the id sort, so
// a bad row never 500s the inbox.
function byNewest(a, b) {
  return new Date(b.createdAt) - new Date(a.createdAt) || (a.id < b.id ? 1 : -1)
}

// `store` is any @netlify/blobs-shaped store ({ get, setJSON, delete }).
// Defaults to the real shared `runout-feedback` store; tests inject an
// in-memory store so no site context is required.
export function createFeedbackBlobStore({ store = getStore(FEEDBACK_STORE) } = {}) {
  async function readIndex() {
    const ids = await store.get(OPEN_INDEX, { type: 'json' })
    return Array.isArray(ids) ? ids : []
  }

  async function writeIndex(ids) {
    await store.setJSON(OPEN_INDEX, ids)
  }

  async function readFeedback(id) {
    const data = await store.get(`${FB_PREFIX}${id}`, { type: 'json' })
    return data && typeof data === 'object' ? data : null
  }

  async function writeFeedback(feedback) {
    await store.setJSON(`${FB_PREFIX}${feedback.id}`, feedback)
  }

  // Keep `index:open` (the inbox enumeration) in sync so listFeedback /
  // deleteByAuthor can enumerate.
  async function ensureIndexed(id) {
    const ids = await readIndex()
    if (!ids.includes(id)) await writeIndex([...ids, id])
  }

  async function removeFromIndex(id) {
    const ids = await readIndex()
    if (ids.includes(id)) await writeIndex(ids.filter((i) => i !== id))
  }

  // Create a feedback object. `id` is server-assigned (a junk/missing id gets a
  // fresh UUID); `type` is allow-listed (junk → 'suggestion'); `status`
  // defaults to 'open' — parity with createFeedback in feedback-repo.js. The
  // message length is NOT clamped here: the future feedback.js function
  // validates `message` (1–4000) before it reaches the repo, so on the Blobs
  // path the stored message is whatever the validated input carried (Postgres
  // enforces the CHECK; Blobs has no such gate and trusts the validated input,
  // never truncating).
  async function createFeedback(input) {
    const id = isUuid(input?.id) ? input.id : randomUUID()
    const now = new Date().toISOString()
    const feedback = {
      id,
      type: asType(input?.type),
      category: String(input?.category ?? 'other'),
      message: String(input?.message ?? ''),
      authorId: String(input?.authorId ?? ''),
      authorName: String(input?.authorName ?? ''),
      url: String(input?.url ?? ''),
      appVersion: String(input?.appVersion ?? ''),
      userAgent: String(input?.userAgent ?? ''),
      status: asStatus(input?.status),
      adminNote: String(input?.adminNote ?? ''),
      createdAt: now,
      updatedAt: now,
    }
    await writeFeedback(feedback)
    await ensureIndexed(id)
    return feedback
  }

  // The admin inbox: newest-first, optionally status- AND/OR type-filtered,
  // paginated with the same clamping as listFeedback in feedback-repo.js. A
  // junk status/type filter is a no-op (ignored), never a 500.
  async function listFeedback({ status, type, limit = DEFAULT_LIMIT, offset = 0 } = {}) {
    const capped = Math.max(0, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT))
    const offsetN = Math.max(0, Number(offset) || 0)
    const all = []
    for (const id of await readIndex()) {
      const feedback = await readFeedback(id)
      // A missing/corrupt `fb:` blob behind a stale index entry is skipped,
      // never a 500.
      if (feedback) all.push(feedback)
    }
    const filtered = all
      .filter((f) => (status && FEEDBACK_STATUSES.has(status) ? f.status === status : true))
      .filter((f) => (type && FEEDBACK_TYPES.has(type) ? f.type === type : true))
      .sort(byNewest)
    return filtered.slice(offsetN, offsetN + capped)
  }
  // (ADMIN-EPIC-1, #259) — dashboard aggregate: feedback volume by status as
  // `[{ status, count }]`, enumerated from index:open — NOT capped by
  // listFeedback's pagination window, so the totals are exact. A missing/
  // corrupt `fb:` blob behind a stale index entry is skipped (never a 500),
  // matching listFeedback.
  async function countsByStatus() {
    const tally = {}
    for (const id of await readIndex()) {
      const feedback = await readFeedback(id)
      if (!feedback) continue
      const status = FEEDBACK_STATUSES.has(feedback.status) ? feedback.status : 'open'
      tally[status] = (tally[status] || 0) + 1
    }
    return Object.entries(tally).map(([status, count]) => ({ status, count }))
  }
  // Admin triage: update a feedback's status and/or owner-only admin note —
  // parity with updateFeedback in feedback-repo.js. A junk id is a no-op
  // (null); a JUNK status makes the WHOLE update a no-op (null) — never a
  // 500. Only the fields the caller actually sends are touched; updated_at is
  // bumped on every write so "triage happened" is observable. Returns the
  // updated object, or null when nothing was updated.
  async function updateFeedback(id, { status, adminNote } = {}) {
    if (!isUuid(id)) return null
    // A provided-but-invalid status invalidates the whole update (junk → no-op).
    if (status !== undefined && !FEEDBACK_STATUSES.has(status)) return null
    // Nothing to update — no-op rather than a pointless bump.
    if (status === undefined && adminNote === undefined) return null

    const feedback = await readFeedback(id)
    if (!feedback) return null
    if (status !== undefined) feedback.status = status
    if (adminNote !== undefined) feedback.adminNote = String(adminNote)
    feedback.updatedAt = new Date().toISOString()
    await writeFeedback(feedback)
    return feedback
  }

  async function deleteFeedback(id) {
    if (!isUuid(id)) return false
    if (!(await readFeedback(id))) return false
    await store.delete(`${FB_PREFIX}${id}`)
    await removeFromIndex(id)
    return true
  }

  // Member deletion cleanup (parity with deleteByAuthor in feedback-repo.js):
  // remove every piece of feedback the member wrote and keep `index:open` in
  // sync.
  async function deleteByAuthor(authorId) {
    const ids = await readIndex()
    const remaining = []
    let removed = 0
    for (const id of ids) {
      const feedback = await readFeedback(id)
      if (feedback?.authorId === authorId) {
        await store.delete(`${FB_PREFIX}${id}`)
        removed += 1
      } else {
        remaining.push(id)
      }
    }
    if (removed) await writeIndex(remaining)
    return removed > 0
  }

  return {
    createFeedback,
    listFeedback,
    countsByStatus,
    updateFeedback,
    deleteFeedback,
    deleteByAuthor,
  }
}
