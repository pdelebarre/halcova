// dashboard-counts.js — aggregate counts for the admin Dashboard tab
// (ADMIN-EPIC-1, #259). Everything is computed from data that ALREADY exists —
// no new collection, no new tables. Mirrors how the admin list + the reviews
// moderation already dispatch across the two backends:
//
//   - user-derived counts (pendingRequests / members / signups / plans) are
//     aggregated IN MEMORY from the full `requests` + `users` lists the admin
//     GET already loads (listRequests()/listUsers() via the repository seam) —
//     zero extra reads on either backend.
//   - feedback / reviews / collections prefer SQL aggregates on the Postgres
//     path (createXxxRepo(db).countsBy*()) and fall back to the Blobs stores
//     (createXxxBlobStore().countsBy*()) — the same Postgres-first / Blobs-
//     fallback choice `withReviews` makes in admin.js.
//
// AGGREGATES ONLY — never ids, emails, names, IPs or codes (data minimization,
// epic §5). The caller (admin.js GET) has already requireAdmin-gated the call,
// so member/demo/anonymous never reach this module.

import { getStore } from '@netlify/blobs'
import { db, isPostgresConfigured } from './postgres'
import { readOwnedCount, ownedCountOf } from './counts'
import { storeNameFor } from './repositories/blob-users'
import { createFeedbackRepo } from './repositories/feedback-repo'
import { createFeedbackBlobStore } from './feedback-blob'
import { createReviewsRepo } from './repositories/reviews-repo'
import { createReviewsBlobStore } from './reviews-blob'
import { createItemsRepo } from './repositories/items-repo'

const PLANS = ['free', 'premium', 'lifetime', 'unlimited']
const FEEDBACK_STATUSES = ['open', 'in_progress', 'done', 'wontfix', 'duplicate']
const REVIEW_STATUSES = ['published', 'pending', 'hidden']

// --- Pure aggregation helpers (unit-testable) --------------------------------

// Members are the only stored users (the owner and the demo visitor are
// constants that never appear in listUsers()). The defensive role check keeps
// any future stored admin record from skewing the member metrics.
function isMember(user) {
  return (user?.role || 'member') === 'member'
}

// UTC day/week/month boundaries (epoch ms). Buckets are UTC so the signup
// numbers are deterministic regardless of the server's local timezone.
function startOfUtcDay(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Monday-based week start (ISO-8601): getUTCDay() is 0 (Sun)..6 (Sat), so
// `(day + 6) % 7` is the number of days since Monday.
function startOfUtcWeek(d) {
  const sinceMonday = (d.getUTCDay() + 6) % 7
  return startOfUtcDay(new Date(d.getTime() - sinceMonday * 86400000))
}

function startOfUtcMonth(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

// Tally members into the today / thisWeek / thisMonth UTC buckets from their
// createdAt. Members with an unparseable createdAt are skipped (never a 500).
function signupBuckets(members, now) {
  const dayStart = startOfUtcDay(now)
  const weekStart = startOfUtcWeek(now)
  const monthStart = startOfUtcMonth(now)
  const buckets = { today: 0, thisWeek: 0, thisMonth: 0 }
  for (const u of members) {
    const t = u?.createdAt ? new Date(u.createdAt).getTime() : Number.NaN
    if (Number.isNaN(t)) continue
    if (t >= dayStart) buckets.today += 1
    if (t >= weekStart) buckets.thisWeek += 1
    if (t >= monthStart) buckets.thisMonth += 1
  }
  return buckets
}

// Aggregate the user-derived counts from the full requests + users lists the
// admin GET already loads. Pure (no I/O) so it is trivially testable and cheap
// on both backends. `now` is injectable for deterministic tests.
export function aggregateUserCounts(requests = [], users = [], now = new Date()) {
  const members = (users || []).filter(isMember)

  const status = { active: 0, disabled: 0 }
  const plans = Object.fromEntries(PLANS.map((p) => [p, 0]))
  for (const u of members) {
    if (u?.status === 'disabled') status.disabled += 1
    else status.active += 1
    const plan = PLANS.includes(u?.plan) ? u.plan : 'free'
    plans[plan] += 1
  }

  return {
    pendingRequests: (requests || []).filter((r) => r?.status === 'pending').length,
    members: { total: members.length, ...status },
    signups: { ...signupBuckets(members, now), total: members.length },
    plans,
  }
}

// Tally `[{ status, count }]` rows (SQL GROUP BY / blob enumeration) into the
// feedback map shape with a hard total. An unknown status (a data bug) is not
// placed in the map but still counts toward the total, so `total` is always
// the true feedback volume.
function feedbackCountsMap(rows) {
  const map = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0]))
  let total = 0
  for (const r of rows || []) {
    const n = Number(r?.count) || 0
    total += n
    if (Object.hasOwn(map, r?.status)) map[r.status] = n
  }
  return { ...map, total }
}

// Same tally for reviews — total first, per the epic §4.1 shape.
function reviewsCountsMap(rows) {
  const map = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0]))
  let total = 0
  for (const r of rows || []) {
    const n = Number(r?.count) || 0
    total += n
    if (Object.hasOwn(map, r?.status)) map[r.status] = n
  }
  return { total, ...map }
}

function collectionCountsMap(rows) {
  const map = { records: 0, books: 0 }
  for (const r of rows || []) {
    const n = Number(r?.count) || 0
    if (Object.hasOwn(map, r?.kind)) map[r.kind] = n
  }
  return map
}

// --- Backend dispatch (Postgres SQL first, Blobs fallback) ------------------

async function feedbackCounts() {
  if (isPostgresConfigured()) {
    try {
      return feedbackCountsMap(await createFeedbackRepo(db).countsByStatus())
    } catch (err) {
      console.error('admin: Postgres feedback counts failed, falling back to Blobs:', err?.message || err)
    }
  }
  return feedbackCountsMap(await createFeedbackBlobStore().countsByStatus())
}

async function reviewsCounts() {
  if (isPostgresConfigured()) {
    try {
      return reviewsCountsMap(await createReviewsRepo(db).countsByStatus())
    } catch (err) {
      console.error('admin: Postgres reviews counts failed, falling back to Blobs:', err?.message || err)
    }
  }
  return reviewsCountsMap(await createReviewsBlobStore().countsByStatus())
}

// Owned items in a single blob collection store: prefer the denormalized
// `count:owned` key (counts.js — one blob read when it exists), falling back to
// an index scan ONLY when the store never denormalized (typically the owner's
// legacy stores, or stores that only ever held unlimited-plan users). The
// admin GET is owner-only and low-frequency, so the fallback scan is the
// acceptable cost of correctness on the Blobs path (Postgres uses SQL instead).
async function countOwnedInStore(store) {
  const cached = await readOwnedCount(store)
  if (cached != null) return cached
  const ids = (await store.get('index', { type: 'json' })) || []
  const items = await Promise.all(ids.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })))
  return ownedCountOf(items)
}

// Blobs fallback for collections: the owner keeps the legacy stores
// (runout-collection / runout-library) and each member gets isolated
// collection-<userId>-<kind> stores — tally only the stores a member is
// actually granted (their collections map) to avoid pointless reads.
async function blobCollectionCounts(users = []) {
  const members = (users || []).filter(isMember)
  const result = { records: 0, books: 0 }
  const targets = [
    { kind: 'records', userId: 'owner' },
    { kind: 'books', userId: 'owner' },
    ...members.flatMap((u) =>
      ['records', 'books']
        .filter((kind) => u?.collections?.[kind])
        .map((kind) => ({ kind, userId: u.id })),
    ),
  ]
  for (const { kind, userId } of targets) {
    result[kind] += await countOwnedInStore(getStore(storeNameFor(userId, kind)))
  }
  return result
}

async function collectionCounts(users) {
  if (isPostgresConfigured()) {
    try {
      return collectionCountsMap(await createItemsRepo(db).countsByKind())
    } catch (err) {
      console.error('admin: Postgres collections counts failed, falling back to Blobs:', err?.message || err)
    }
  }
  return blobCollectionCounts(users)
}

// Build the full counts block for GET /admin?dashboard=1.
export async function getDashboardCounts({ requests = [], users = [] } = {}) {
  const { pendingRequests, members, signups, plans } = aggregateUserCounts(requests, users)
  const [collections, feedback, reviews] = await Promise.all([
    collectionCounts(users),
    feedbackCounts(),
    reviewsCounts(),
  ])
  return { pendingRequests, members, signups, plans, collections, feedback, reviews }
}
