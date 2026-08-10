// TEMPORARY local mock of netlify/functions/collection.js used only to verify
// the frontend in the browser without running `netlify dev`. Delete after use.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const stores = { records: new Map(), books: new Map() }
const file = path.join(os.tmpdir(), 'runout-mock.json')
try {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  Object.entries(saved).forEach(([k, arr]) => { stores[k] = new Map(arr.map((it) => [it.id, it])) })
} catch { /* start empty */ }

function persist() {
  fs.writeFileSync(file, JSON.stringify(
    Object.fromEntries(Object.entries(stores).map(([k, m]) => [k, [...m.values()]])),
  ))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost:8888')
  const collection = url.searchParams.get('collection') || 'records'
  if (!stores[collection]) stores[collection] = new Map()
  const store = stores[collection]
  const id = url.searchParams.get('id')
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method === 'GET') {
      send(200, { items: [...store.values()] })
    } else if (req.method === 'POST') {
      const parsed = JSON.parse(body || '{}')
      const newId = crypto.randomUUID()
      const item = { ...parsed, id: newId, dateAdded: parsed.dateAdded || new Date().toISOString() }
      store.set(newId, item)
      send(201, item)
    } else if (req.method === 'PUT') {
      const existing = store.get(id)
      if (!existing) return send(404, { error: 'Not found' })
      const updated = { ...existing, ...JSON.parse(body || '{}'), id }
      store.set(id, updated)
      send(200, updated)
    } else if (req.method === 'DELETE') {
      store.delete(id)
      send(200, { ok: true })
    } else {
      send(405, { error: 'Method not allowed' })
    }
    persist()
  })
})

server.listen(8888, () => console.log('mock collection API listening on 8888'))
