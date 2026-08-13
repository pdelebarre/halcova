import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { COLLECTIONS, authorize, json, readIndex, writeIndex } from './_shared/collection-store'
import { DEMO_SEED, seedDemoStore } from './_shared/demo-data'
import { planLimitFor } from './_shared/plans'
import { storeNameFor } from './_shared/users'

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
      const ids = await readIndex(store)
      const items = await Promise.all(ids.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })))
      return json(200, { items: items.filter(Boolean) })
    }

    if (req.method === 'POST') {
      const body = await req.json()

      // Free-tier cap: enforced on ADDS only, server-side. Owner / unlimited
      // users bypass it (planLimitFor returns null). The index is read BEFORE
      // writing and re-read again right before writeIndex to narrow the
      // concurrent-POST race (Netlify Blobs has no transactions — see ADR-0001).
      // The cap counts OWNED items only — wishlist "wants" are a separate list
      // of things the member doesn't own yet and never consume the cap.
      const limit = planLimitFor(user)
      if (limit != null) {
        const before = await readIndex(store)
        const ownedCount = (await Promise.all(
          before.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })),
        )).filter(Boolean).filter((it) => !it.wishlist).length
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
      return json(201, item)
    }

    if (req.method === 'PUT') {
      if (!id) return json(400, { error: 'Missing id' })
      const existing = await store.get(`item:${id}`, { type: 'json' })
      if (!existing) return json(404, { error: 'Not found' })
      const patch = await req.json()
      const updated = { ...existing, ...patch, id }
      await store.setJSON(`item:${id}`, updated)
      return json(200, updated)
    }

    if (req.method === 'DELETE') {
      if (!id) return json(400, { error: 'Missing id' })
      await store.delete(`item:${id}`)
      const ids = await readIndex(store)
      await writeIndex(store, ids.filter((existingId) => existingId !== id))
      return json(200, { ok: true })
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return json(500, { error: err.message || 'Internal error' })
  }
}
