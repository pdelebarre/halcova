import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { COLLECTIONS, authorize, json, readIndex, writeIndex } from './_shared/collection-store'
import { DEMO_SEED, seedDemoStore } from './_shared/demo-data'
import { planLimitFor } from './_shared/plans'
import { storeNameFor } from './_shared/users'
import { parsePagination, sliceIds, isDefaultPage } from './_shared/pagination'
import { ensureOwnedCount, adjustOwnedCount, wishlistToggleDelta } from './_shared/counts'
import { readListCache, writeListCache, invalidateListCache } from './_shared/list-cache'
import { createRateLimiter, rateLimitIdentity } from './_shared/rate-limit'

const RATE_LIMITS_STORE = 'runout-rate-limits'
// Per-identity fixed-window limit for collection reads/writes (T5).
const COLLECTION_RATE_LIMIT = Number(process.env.RUNOUT_COLLECTION_RATE_LIMIT) || 60

export default async (req) => {
  const url = new URL(req.url)
  const collection = url.searchParams.get('collection') || 'records'
  const id = url.searchParams.get('id')

  const { user, error } = await authorize(req)
  if (error) return error

  if (!COLLECTIONS[collection]) return json(400, { error: 'Unknown collection.' })
  if (!user.collections?.[collection]) {
    return json(403, { error: `Your plan doesn't include the ${collection} collection.` })
  }

  // Per-user rate limit (T5): a runaway client or a stuck loop can't hammer
  // the blob store. Members/owner are keyed by user id; the shared demo
  // identity is keyed by client IP so one demo visitor never throttles the
  // whole demo. Skipped when there's no identity to key on (e.g. a demo
  // visitor with no forwarded IP header).
  const identity = rateLimitIdentity(user, req)
  if (identity) {
    const limiter = createRateLimiter({
      store: getStore(RATE_LIMITS_STORE),
      scope: `collection:${collection}`,
      limit: COLLECTION_RATE_LIMIT,
    })
    const rl = await limiter(identity)
    if (rl.limited) {
      return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
    }
  }

  // The demo space is read-only, enforced server-side. GET stays open so demo
  // visitors can browse, scan and search; every write is rejected.
  if (req.method !== 'GET' && user.role === 'demo') {
    return json(403, {
      error: 'The demo collection is read-only. Sign in to add your own items.',
      code: 'DEMO_READONLY',
    })
  }

  // Owner → legacy stores (existing data preserved); members → their own
  // isolated store per kind.
  const store = getStore(storeNameFor(user.id, collection))

  try {
    if (req.method === 'GET') {
      // Demo space self-seeds on first access (ADR-0001): a fresh store is
      // populated with the curated items so a demo visitor never sees an empty
      // collection — no manual admin seed step required. Idempotent — the seed
      // is skipped as soon as the index is non-empty.
      if (user.role === 'demo') {
        await seedDemoStore(store, DEMO_SEED[collection])
      }
      // The list cache (T4) serves only the default (unpaginated) page — the
      // only shape the client requests today. Explicit limit/offset opts out
      // so paginated reads always see fresh data.
      const defaultPage = isDefaultPage(url.searchParams)
      if (defaultPage) {
        const cached = await readListCache(store)
        if (cached) return json(200, { items: cached })
      }
      // Paginated read (T2): fetch ONLY the requested slice of items, keeping
      // index order. Default limit is high (1000) so the current client is
      // unchanged.
      const ids = await readIndex(store)
      const { offset, limit } = parsePagination(url.searchParams)
      const slice = sliceIds(ids, offset, limit)
      const items = (await Promise.all(
        slice.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })),
      )).filter(Boolean)
      if (defaultPage) await writeListCache(store, items)
      return json(200, { items })
    }

    if (req.method === 'POST') {
      const body = await req.json()

      // Free-tier cap: enforced on ADDS only, server-side. Owner / unlimited
      // users bypass it (planLimitFor returns null). The cap now reads the
      // denormalized `count:owned` key (one blob read) instead of scanning
      // every item (T3); the key is lazily backfilled from the index the first
      // time it's needed. Wishlist "wants" never count toward the cap. The
      // read-compare-write race is narrowed the same way as the index (Netlify
      // Blobs has no transactions — see ADR-0001).
      const limit = planLimitFor(user)
      if (limit != null) {
        const ownedCount = await ensureOwnedCount(store, readIndex)
        if (ownedCount >= limit) {
          return json(403, {
            error: `You've reached the free plan limit of ${limit} items. Ask the admin to upgrade your plan.`,
            code: 'PLAN_LIMIT',
          })
        }
      }

      const newId = randomUUID()
      const item = { ...body, id: newId, dateAdded: body.dateAdded || new Date().toISOString() }
      await store.setJSON(`item:${newId}`, item)
      const ids = await readIndex(store)
      ids.unshift(newId)
      await writeIndex(store, ids)
      // Maintain the owned count (only when it already exists — a missing key
      // is lazily backfilled on the next capped POST, which reads the index
      // AFTER this write, so skipping keeps it correct). Wishlist adds never
      // consume the cap.
      if (!item.wishlist) await adjustOwnedCount(store, +1)
      await invalidateListCache(store)
      return json(201, item)
    }

    if (req.method === 'PUT') {
      if (!id) return json(400, { error: 'Missing id' })
      const existing = await store.get(`item:${id}`, { type: 'json' })
      if (!existing) return json(404, { error: 'Not found' })
      const patch = await req.json()
      const updated = { ...existing, ...patch, id }
      await store.setJSON(`item:${id}`, updated)
      // A wishlist↔owned toggle changes the owned count; only adjust when the
      // patch actually touches `wishlist` (not on notes/rating edits — T3).
      const { delta } = wishlistToggleDelta(patch, existing)
      if (delta !== 0) await adjustOwnedCount(store, delta)
      await invalidateListCache(store)
      return json(200, updated)
    }

    if (req.method === 'DELETE') {
      if (!id) return json(400, { error: 'Missing id' })
      // Read the item first so we know whether it counted toward the owned
      // cap. A missing item still deletes cleanly + 200s, preserving today's
      // idempotent behavior (the count is untouched in that case).
      const existing = await store.get(`item:${id}`, { type: 'json' })
      await store.delete(`item:${id}`)
      const ids = await readIndex(store)
      await writeIndex(store, ids.filter((existingId) => existingId !== id))
      if (existing && !existing.wishlist) await adjustOwnedCount(store, -1)
      await invalidateListCache(store)
      return json(200, { ok: true })
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return json(500, { error: err.message || 'Internal error' })
  }
}
