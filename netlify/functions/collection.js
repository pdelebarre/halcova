import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'
import { COLLECTIONS, authorize, json, readIndex, writeIndex } from './_shared/collection-store'
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

  // Owner → legacy stores (existing data preserved); members → their own
  // isolated store per kind.
  const store = getStore(storeNameFor(user.id, collection))

  try {
    if (req.method === 'GET') {
      const ids = await readIndex(store)
      const items = await Promise.all(ids.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })))
      return json(200, { items: items.filter(Boolean) })
    }

    if (req.method === 'POST') {
      const body = await req.json()
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
