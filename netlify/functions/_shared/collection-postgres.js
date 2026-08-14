// Postgres-backed collection handler (ADR-0002 Phase 1, epic #38). Reached
// ONLY when DATABASE_URL is configured (see netlify/functions/collection.js).
// Same API contract, auth and error bodies as the Blobs path:
//
//   - Reads: DB-first via itemsRepo; falls back to the Blobs store on a DB
//     error or an empty (not-yet-backfilled) store (read-through).
//   - Writes: transactional (itemsRepo.transaction — BEGIN/COMMIT/ROLLBACK
//     around the insert/delete), and the free-tier plan cap uses the SQL owned
//     count inside the same transaction. Each write is ALSO mirrored to the
//     legacy Blob store best-effort so the migration stays reversible (nothing
//     orphans; Blob stores are never renamed/deleted).
//   - The demo space is a read-only, curated dataset and stays in Blobs
//     (self-seeded) even when Postgres is configured.
//
// DB-level errors are deliberately NOT caught here: they propagate to
// collection.js, which degrades the whole request to the Blobs path — a
// Postgres outage behaves exactly like today instead of 500ing.

import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { json, readIndex, writeIndex } from './collection-store'
import { planLimitFor } from './plans'
import { storeNameFor } from './users'
import { parsePagination, sliceIds } from './pagination'
import { DEMO_SEED, seedDemoStore } from './demo-data'
import { adjustOwnedCount } from './counts'
import { invalidateListCache } from './list-cache'
import { getRepository } from './repository'

function planLimitError(limit) {
  const err = new Error(`You've reached the free plan limit of ${limit} items. Ask the admin to upgrade your plan.`)
  err.code = 'PLAN_LIMIT'
  return err
}

// --- Reads ---

// The Blobs read path (also the demo reader): index-ordered, paginated, with
// the demo auto-seed. Mirrors the Blobs GET exactly (no list-cache here — the
// cache layer stays a Blobs-only optimization for now; see the report).
async function readItemsFromBlobs(req, { user, collection, url }) {
  const store = getStore(storeNameFor(user.id, collection))
  if (user.role === 'demo') await seedDemoStore(store, DEMO_SEED[collection])
  const ids = await readIndex(store)
  const { offset, limit } = parsePagination(url.searchParams)
  const slice = sliceIds(ids, offset, limit)
  const items = (await Promise.all(
    slice.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })),
  )).filter(Boolean)
  return json(200, { items })
}

// DB-first read-through: serve Postgres when it has rows, otherwise fall back
// to Blobs (pre-backfill or DB error).
async function readItems(req, { user, collection, url }) {
  const repo = getRepository()
  const { offset, limit } = parsePagination(url.searchParams)
  let items
  try {
    items = await repo.items.listItems(user.id, collection, { limit, offset })
  } catch {
    items = null
  }
  if (items === null || items.length === 0) {
    return readItemsFromBlobs(req, { user, collection, url })
  }
  return json(200, { items })
}

// --- Reversible Blob mirrors (best-effort — Postgres is the source of truth) ---

async function mirrorAdd(userId, collection, item) {
  try {
    const store = getStore(storeNameFor(userId, collection))
    await store.setJSON(`item:${item.id}`, item)
    const ids = await readIndex(store)
    if (!ids.includes(item.id)) await writeIndex(store, [item.id, ...ids])
    if (!item.wishlist) await adjustOwnedCount(store, +1)
    await invalidateListCache(store)
  } catch { /* mirror is best-effort */ }
}

async function mirrorUpdate(userId, collection, id, updated, existing) {
  try {
    const store = getStore(storeNameFor(userId, collection))
    await store.setJSON(`item:${id}`, updated)
    const wasOwned = !existing?.wishlist
    const nowOwned = !updated.wishlist
    if (wasOwned !== nowOwned) await adjustOwnedCount(store, wasOwned ? -1 : 1)
    await invalidateListCache(store)
  } catch { /* mirror is best-effort */ }
}

async function mirrorDelete(userId, collection, id, existing) {
  try {
    const store = getStore(storeNameFor(userId, collection))
    await store.delete(`item:${id}`)
    const ids = await readIndex(store)
    await writeIndex(store, ids.filter((x) => x !== id))
    if (existing && !existing.wishlist) await adjustOwnedCount(store, -1)
    await invalidateListCache(store)
  } catch { /* mirror is best-effort */ }
}

// --- Writes ---

async function handlePost(req, { user, collection }) {
  const body = await req.json()
  const repo = getRepository()
  const limit = planLimitFor(user)
  const newId = randomUUID()
  const item = { ...body, id: newId, dateAdded: body.dateAdded || new Date().toISOString() }

  // The plan-limit check and the insert share one transaction so the SQL owned
  // count can't drift between the check and the write.
  try {
    await repo.items.transaction(async (tx) => {
      if (limit != null) {
        const owned = await tx.countOwned(user.id, collection)
        if (owned >= limit) throw planLimitError(limit)
      }
      await tx.insertItem(user.id, collection, item)
    })
  } catch (err) {
    if (err?.code === 'PLAN_LIMIT') return json(403, { error: err.message, code: 'PLAN_LIMIT' })
    throw err // DB-level error -> the Blobs fallback in collection.js handles it
  }

  await mirrorAdd(user.id, collection, item)
  return json(201, item)
}

async function handlePut(req, { user, collection, id }) {
  if (!id) return json(400, { error: 'Missing id' })
  const repo = getRepository()
  let existing = null
  try {
    existing = await repo.items.getItem(user.id, collection, id)
  } catch {
    existing = null
  }
  if (!existing) {
    // Read-through: a pre-backfill item lives in Blobs.
    try {
      const store = getStore(storeNameFor(user.id, collection))
      existing = await store.get(`item:${id}`, { type: 'json' })
    } catch {
      existing = null
    }
  }
  if (!existing) return json(404, { error: 'Not found' })

  const patch = await req.json()
  const updated = { ...existing, ...patch, id }
  await repo.items.transaction(async (tx) => {
    await tx.updateItem(user.id, collection, id, updated)
  })
  await mirrorUpdate(user.id, collection, id, updated, existing)
  return json(200, updated)
}

async function handleDelete(req, { user, collection, id }) {
  if (!id) return json(400, { error: 'Missing id' })
  const repo = getRepository()
  let existing = null
  try {
    existing = await repo.items.getItem(user.id, collection, id)
  } catch {
    existing = null
  }
  if (!existing) {
    try {
      const store = getStore(storeNameFor(user.id, collection))
      existing = await store.get(`item:${id}`, { type: 'json' })
    } catch {
      existing = null
    }
  }
  await repo.items.transaction(async (tx) => {
    await tx.deleteItem(user.id, collection, id)
  })
  await mirrorDelete(user.id, collection, id, existing)
  return json(200, { ok: true })
}

// Entry point. DB errors propagate (fall back to Blobs in collection.js);
// business outcomes are returned here.
export async function handlePostgres(req, { user, collection, id, url }) {
  if (user.role === 'demo') return readItemsFromBlobs(req, { user, collection, url })
  if (req.method === 'GET') return readItems(req, { user, collection, url })
  if (req.method === 'POST') return handlePost(req, { user, collection })
  if (req.method === 'PUT') return handlePut(req, { user, collection, id })
  if (req.method === 'DELETE') return handleDelete(req, { user, collection, id })
  return json(405, { error: 'Method not allowed' })
}
