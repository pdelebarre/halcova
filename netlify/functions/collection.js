import { getStore } from '@netlify/blobs'
import { randomUUID } from 'node:crypto'

const STORE_NAME = 'runout-collection'
const INDEX_KEY = 'index'

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json' },
})

async function readIndex(store) {
  const data = await store.get(INDEX_KEY, { type: 'json' })
  return data || []
}

async function writeIndex(store, ids) {
  await store.setJSON(INDEX_KEY, ids)
}

export default async (req) => {
  const store = getStore(STORE_NAME)
  const url = new URL(req.url)
  const id = url.searchParams.get('id')

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
