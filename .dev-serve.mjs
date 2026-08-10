// TEMPORARY local dev server for verification only: serves the production
// build (dist/) plus a collection-aware mock of netlify/functions/collection.js
// on one port, so the browser can exercise the full records + books flow.
// Delete after use.
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const PORT = 8890
const ROOT = path.resolve('dist')
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

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
}

function handleApi(req, res, url) {
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
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  if (url.pathname.startsWith('/.netlify/functions/collection')) {
    handleApi(req, res, url)
    return
  }
  // Static files + SPA fallback
  let p = decodeURIComponent(url.pathname)
  if (p === '/') p = '/index.html'
  const filePath = path.join(ROOT, p)
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(fs.readFileSync(filePath))
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(fs.readFileSync(path.join(ROOT, 'index.html')))
  }
})

server.listen(PORT, () => console.log(`verification server on http://localhost:${PORT}`))
