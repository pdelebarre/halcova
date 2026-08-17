// reviews-blob.js — Blobs fallback for the reviews data layer (feat/reviews,
// Task 3). Reviews are SHARED across all users (a release's reviews are public)
// — so unlike items/users there is ONE shared store, NOT per-user:
//
//   store: runout-reviews
//     release:<kind>:<sourceId>  -> { reviews: [ { review… }, … ] }
//     id:<reviewId>              -> [kind, sourceId]     (O(1) id lookup)
//     index:releases             -> [ "<kind>:<sourceId>", … ]  (enumeration)
//
// Each release's array is a LAST-WRITE-WINS MERGE keyed on the review's
// authorId (the same upsert semantic as Postgres's UNIQUE (kind, source_id,
// author_id)): a member editing their review replaces their entry in place
// (keeping its id and createdAt), a new author appends a fresh review.
//
// NOTE — Postgres (repositories/reviews-repo.js) is the REAL home for reviews.
// Blobs has a LOST-UPDATE RACE under concurrency: two members writing reviews
// for the same release simultaneously both read the array, both merge, and the
// second write overwrites the first (Netlify Blobs has no transactions —
// ADR-0001). Postgres makes the (kind, source_id, author_id) upsert atomic.
// This module exists so the future reviews.js function can choose its path
// like collection.js does (DATABASE_URL ? postgres : blobs) and so a Postgres
// outage degrades to Blobs instead of 500ing.

import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { parseReleaseKey } from './reviews-shared'

const REVIEWS_STORE = 'runout-reviews'
const RELEASE_PREFIX = 'release:'
const ID_PREFIX = 'id:'
const RELEASES_INDEX = 'index:releases'

const REVIEW_STATUSES = new Set(['published', 'pending', 'hidden'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

function releaseKey(kind, sourceId) {
  return `${RELEASE_PREFIX}${kind}:${sourceId}`
}

// Resolve a `id:<reviewId>` index value (an array [kind, sourceId], or a
// legacy STRING `<kind>:<sourceId>`) back into { kind, sourceId }.
// parseReleaseKey splits on the FIRST `:` only, so even a legacy value whose
// sourceId contains `:` can't mis-split. Returns { kind: '', sourceId: '' } for
// a corrupt value — the lookup then simply finds nothing, never a 500.
function idIndexToKindSource(value) {
  if (Array.isArray(value) && value.length >= 2) return { kind: value[0], sourceId: value[1] }
  return parseReleaseKey(value) || { kind: '', sourceId: '' }
}

// Clamp a rating into 1..5 (parity with the Postgres CHECK) — a junk rating
// never 500s. Non-numeric defaults to 5 (the reviews.js function validates).
function asRating(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 5
  return Math.max(1, Math.min(5, Math.trunc(n)))
}

function asStatus(value) {
  return value && REVIEW_STATUSES.has(value) ? value : 'published'
}

// `store` is any @netlify/blobs-shaped store ({ get, setJSON, delete }).
// Defaults to the real shared `runout-reviews` store; tests inject an
// in-memory store so no site context is required.
export function createReviewsBlobStore({ store = getStore(REVIEWS_STORE) } = {}) {
  async function readReleases() {
    const keys = (await store.get(RELEASES_INDEX, { type: 'json' })) || []
    return Array.isArray(keys) ? keys : []
  }

  async function writeReleases(keys) {
    await store.setJSON(RELEASES_INDEX, keys)
  }

  async function readRelease(kind, sourceId) {
    const data = await store.get(releaseKey(kind, sourceId), { type: 'json' })
    return data?.reviews && Array.isArray(data.reviews) ? data.reviews : []
  }

  async function writeRelease(kind, sourceId, reviews) {
    await store.setJSON(releaseKey(kind, sourceId), { reviews })
  }

  // Keep `index:releases` in sync so listAll / deleteByAuthor can enumerate.
  async function ensureReleaseIndexed(kind, sourceId) {
    const keys = await readReleases()
    const key = `${kind}:${sourceId}`
    if (!keys.includes(key)) await writeReleases([...keys, key])
  }

  // Upsert a member's review for a release (last-write-wins merge on authorId).
  // Same preserve-on-undefined status rule as the Postgres repo: an edit with
  // no `status` keeps the existing status (an admin's 'hidden'/'pending' is
  // never silently reset).
  async function upsertReview(input) {
    const kind = String(input?.kind ?? '')
    const sourceId = String(input?.sourceId ?? '')
    const authorId = String(input?.authorId ?? '')
    const reviews = await readRelease(kind, sourceId)
    const existing = reviews.find((r) => r.authorId === authorId)
    const now = new Date().toISOString()
    let review
    if (existing) {
      review = {
        ...existing,
        authorName: String(input?.authorName ?? ''),
        rating: asRating(input?.rating),
        body: String(input?.body ?? ''),
        status: input?.status === undefined ? existing.status : asStatus(input?.status),
        updatedAt: now,
      }
      reviews.splice(reviews.indexOf(existing), 1, review)
    } else {
      review = {
        id: isUuid(input?.id) ? input.id : randomUUID(),
        kind,
        sourceId,
        authorId,
        authorName: String(input?.authorName ?? ''),
        rating: asRating(input?.rating),
        body: String(input?.body ?? ''),
        status: asStatus(input?.status),
        createdAt: now,
        updatedAt: now,
      }
      reviews.push(review)
    }
    await writeRelease(kind, sourceId, reviews)
    await store.setJSON(`${ID_PREFIX}${review.id}`, [kind, sourceId])
    await ensureReleaseIndexed(kind, sourceId)
    return review
  }

  // A release's reviews (newest first) + the rating aggregate, both scoped to
  // the same status filter (published by default) — parity with listReviews.
  async function listReviews(kind, sourceId, { status = 'published' } = {}) {
    const reviews = (await readRelease(kind, sourceId))
      .filter((r) => r.status === status)
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || (a.id < b.id ? 1 : -1))
    const count = reviews.length
    const avg = count ? reviews.reduce((sum, r) => sum + Number(r.rating), 0) / count : 0
    return { reviews, aggregate: { avg, count } }
  }

  async function getReview(id) {
    if (!isUuid(id)) return null
    const key = await store.get(`${ID_PREFIX}${id}`, { type: 'json' })
    if (!key) return null
    const { kind, sourceId } = idIndexToKindSource(key)
    const reviews = await readRelease(kind, sourceId)
    return reviews.find((r) => r.id === id) || null
  }

  async function getByAuthor(kind, sourceId, authorId) {
    const reviews = await readRelease(kind, sourceId)
    return reviews.find((r) => r.authorId === authorId) || null
  }

  async function deleteReview(id) {
    if (!isUuid(id)) return false
    const key = await store.get(`${ID_PREFIX}${id}`, { type: 'json' })
    if (!key) return false
    const { kind, sourceId } = idIndexToKindSource(key)
    const reviews = await readRelease(kind, sourceId)
    const idx = reviews.findIndex((r) => r.id === id)
    if (idx === -1) return false
    reviews.splice(idx, 1)
    await writeRelease(kind, sourceId, reviews)
    await store.delete(`${ID_PREFIX}${id}`)
    return true
  }

  async function setStatus(id, status) {
    if (!isUuid(id) || !REVIEW_STATUSES.has(status)) return false
    const key = await store.get(`${ID_PREFIX}${id}`, { type: 'json' })
    if (!key) return false
    const { kind, sourceId } = idIndexToKindSource(key)
    const reviews = await readRelease(kind, sourceId)
    const review = reviews.find((r) => r.id === id)
    if (!review) return false
    review.status = status
    review.updatedAt = new Date().toISOString()
    await writeRelease(kind, sourceId, reviews)
    return true
  }

  // Admin listing: enumerate every release, newest-first, optionally
  // status-filtered.
  async function listAll({ status } = {}) {
    const keys = await readReleases()
    const all = []
    for (const key of keys) {
      const { kind, sourceId } = parseReleaseKey(key) || { kind: '', sourceId: '' }
      all.push(...(await readRelease(kind, sourceId)))
    }
    return all
      .filter((r) => !status || r.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }

  // (ADMIN-EPIC-1, #259) — dashboard aggregate: review volume by status as
  // `[{ status, count }]`, enumerated across every indexed release — NOT capped
  // by listAll's pagination window, so the totals are exact.
  async function countsByStatus() {
    const tally = {}
    for (const key of await readReleases()) {
      const { kind, sourceId } = parseReleaseKey(key) || { kind: '', sourceId: '' }
      for (const r of await readRelease(kind, sourceId)) {
        const status = REVIEW_STATUSES.has(r.status) ? r.status : 'published'
        tally[status] = (tally[status] || 0) + 1
      }
    }
    return Object.entries(tally).map(([status, count]) => ({ status, count }))
  }

  // Member deletion cleanup: remove every review the member wrote across all
  // releases, keep each release's array + the id index consistent.
  async function deleteByAuthor(authorId) {
    const keys = await readReleases()
    let removed = 0
    for (const key of keys) {
      const { kind, sourceId } = parseReleaseKey(key) || { kind: '', sourceId: '' }
      const reviews = await readRelease(kind, sourceId)
      const remaining = reviews.filter((r) => r.authorId !== authorId)
      if (remaining.length !== reviews.length) {
        for (const r of reviews) {
          if (r.authorId === authorId) await store.delete(`${ID_PREFIX}${r.id}`)
        }
        await writeRelease(kind, sourceId, remaining)
        removed += reviews.length - remaining.length
      }
    }
    return removed > 0
  }

  return {
    upsertReview,
    listReviews,
    getReview,
    getByAuthor,
    deleteReview,
    setStatus,
    listAll,
    countsByStatus,
    deleteByAuthor,
  }
}
