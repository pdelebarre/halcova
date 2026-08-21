// @vitest-environment node
//
// FEAT-6.2 #315 — handler-level tests for the READ-ONLY Collection Type
// Registry API (netlify/functions/collection-types.js). Uses a REAL pg-mem-
// backed repository (getPool() returns a pg-mem `db`) so the full
// server-authoritative path is exercised end-to-end:
//   * GET lists all registered types (labels/icons/capabilities/fields).
//   * GET ?type=<id> returns a single type's public projection.
//   * Unknown type -> stable 404 UNKNOWN_TYPE.
//   * Non-GET -> 405 (the API never accepts a type definition from the client).
//   * The client can never write/override a definition (read-only by contract).

import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../collection-types'
import { createMemDb } from './repositories/test-helpers'

// Postgres is "configured"; getPool() returns a pg-mem-backed `db` ({ query,
// connect }), so the REAL createCollectionTypeRepository builds against it —
// the full server-authoritative path runs with no live DB.
const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null } }))
vi.mock('./postgres', () => ({
  isPostgresConfigured: () => true,
  getPool: () => dbRef.current,
}))

// The registry is read-open to any authenticated caller. Bypass the real
// session-resolution (covered elsewhere) so we can exercise the function's
// registry logic against the real pg-mem repository.
vi.mock('./policy', () => ({
  enforce: async () => ({ user: { id: 'u1', role: 'member' }, error: null }),
}))

function req(method = 'GET', path = '') {
  return {
    method,
    url: `http://localhost/.netlify/functions/collection-types${path}`,
    headers: { get: () => null },
    json: async () => ({}),
  }
}

let db

beforeEach(async () => {
  db = await createMemDb()
  dbRef.current = db
})

describe('GET — registry list (Books and Records through the same mechanism)', () => {
  it('returns both registered types with their public metadata', async () => {
    const res = await handler(req('GET'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.collectionTypes.map((t) => t.id).sort()
    expect(ids).toEqual(['books', 'records'])
    const records = body.collectionTypes.find((t) => t.id === 'records')
    expect(records.displayName).toBe('Records')
    expect(records.icon).toBe('disc')
    expect(records.capabilities).toContain('lookup.discogs')
    expect(records.providerMappings[0]).toEqual({ provider: 'discogs', role: 'primary' })
    expect(records.fields.canonical.length).toBeGreaterThan(0)
    // Public projection only — no raw DB internals leak.
    expect(records.created_at).toBeUndefined()
    expect(records.updated_at).toBeUndefined()
  })
})

describe('GET ?type= — single type', () => {
  it('returns the requested type', async () => {
    const res = await handler(req('GET', '?type=books'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.collectionType.id).toBe('books')
    expect(body.collectionType.fields.canonical.some((f) => f.key === 'isbn')).toBe(true)
  })

  it('returns a stable 404 UNKNOWN_TYPE for an unknown type', async () => {
    const res = await handler(req('GET', '?type=games'))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('UNKNOWN_TYPE')
    expect(body.error).toContain('games')
  })
})

describe('read-only contract — a client can never supply/override a definition', () => {
  it('405s on any non-GET method (no write path exists)', async () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await handler(req(m))
      expect(res.status).toBe(405)
      expect((await res.json()).code).toBe('METHOD_NOT_ALLOWED')
    }
  })

  it('ignores any client-supplied type definition in the body (never read)', async () => {
    // A hostile POST body with a forged type/capability definition is rejected
    // at the method gate BEFORE anything is read — the definition is never used.
    const res = await handler({
      method: 'POST',
      url: 'http://localhost/.netlify/functions/collection-types',
      headers: { get: () => null },
      json: async () => ({
        id: 'evil',
        capabilities: ['lookup.hacked'],
        providerMappings: [{ provider: 'evil', role: 'primary' }],
      }),
    })
    expect(res.status).toBe(405)
    // The registry is unchanged — only the two seeded types exist.
    const { rows } = await db.query('SELECT id FROM collection_types ORDER BY id')
    const allIds = rows.map((r) => r.id)
    expect(allIds).toEqual(['books', 'records'])
    expect(allIds.includes('evil')).toBe(false)
  })
})
