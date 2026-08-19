import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as collection from './collection'
import { saveSession } from '../utils/session'

function okJson(data) {
  return { ok: true, status: 200, json: async () => data }
}

function errorJson(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('collection API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    saveSession({ user: { id: 'u1' }, session: 'tok-collection-session-abc123' })
  })

  it('lists items with the collection param', async () => {
    global.fetch.mockResolvedValue(okJson({ items: [{ id: '1' }] }))
    const items = await collection.listItems('books')
    expect(items).toEqual([{ id: '1' }])
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/.netlify/functions/collection')
    expect(url).toContain('collection=books')
  })

  it('sends the signed-in session token as a Bearer header on every call', async () => {
    global.fetch.mockResolvedValue(okJson({ items: [] }))
    await collection.listItems('records')
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok-collection-session-abc123')
  })

  it('defaults listItems to records and maps missing items to []', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    expect(await collection.listItems()).toEqual([])
    expect(global.fetch.mock.calls[0][0]).toContain('collection=records')
  })

  it('adds an item with POST and JSON body', async () => {
    global.fetch.mockResolvedValue(okJson({ id: 'new' }))
    const saved = await collection.addItem({ title: 'X' }, 'records')
    expect(saved).toEqual({ id: 'new' })
    const [, init] = global.fetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ title: 'X' })
  })

  it('updates an item with PUT and id query param', async () => {
    global.fetch.mockResolvedValue(okJson({ id: '1', notes: 'n' }))
    const result = await collection.updateItem('1', { notes: 'n' }, 'records')
    expect(result).toEqual({ id: '1', notes: 'n' })
    const [url, init] = global.fetch.mock.calls[0]
    expect(init.method).toBe('PUT')
    expect(url).toContain('id=1')
    expect(JSON.parse(init.body)).toEqual({ notes: 'n' })
  })

  it('deletes an item with DELETE', async () => {
    global.fetch.mockResolvedValue(okJson({ ok: true }))
    await collection.deleteItem('9', 'records')
    const [url, init] = global.fetch.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('id=9')
  })

  it('surfaces a server-provided error message', async () => {
    global.fetch.mockResolvedValue(errorJson(500, { error: 'Blob store exploded' }))
    await expect(collection.listItems()).rejects.toThrow('Blob store exploded')
  })

  it('falls back to a generic message when the body has no error', async () => {
    global.fetch.mockResolvedValue(errorJson(500, {}))
    await expect(collection.listItems()).rejects.toThrow('Request failed (500)')
  })

  it('falls back to a generic message when the body is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json') },
    })
    await expect(collection.listItems()).rejects.toThrow('Request failed (500)')
  })

  it('attaches the server code to a 403 PLAN_LIMIT error from add', async () => {
    global.fetch.mockResolvedValue(errorJson(403, {
      error: "You've reached the free plan limit of 10 items. Ask the admin to upgrade your plan.",
      code: 'PLAN_LIMIT',
    }))
    try {
      await collection.addItem({ title: 'X' }, 'records')
      throw new Error('expected addItem to reject')
    } catch (err) {
      expect(err.message).toContain('free plan limit of 10 items')
      expect(err.code).toBe('PLAN_LIMIT')
    }
  })

  it('attaches the server code to a 403 DEMO_READONLY error from delete', async () => {
    global.fetch.mockResolvedValue(errorJson(403, {
      error: 'The demo collection is read-only. Sign in to add your own items.',
      code: 'DEMO_READONLY',
    }))
    await expect(collection.deleteItem('r1', 'records')).rejects.toMatchObject({
      message: 'The demo collection is read-only. Sign in to add your own items.',
      code: 'DEMO_READONLY',
    })
  })

  it('surfaces the server message for a 403 / 404 error body', async () => {
    global.fetch.mockResolvedValue(errorJson(403, { error: "Your plan doesn't include the books collection." }))
    await expect(collection.listItems('books')).rejects.toThrow("Your plan doesn't include the books collection.")
    // SEC-7.1 (#338): the collection function no longer returns a distinguishable
    // 404 for an object-by-id update of a missing item — a non-owner (or already-
    // gone) id is a uniform 403 FORBIDDEN. The client surfaces it as before.
    global.fetch.mockResolvedValue(errorJson(403, { error: 'Not authorized.', code: 'FORBIDDEN' }))
    await expect(collection.updateItem('nope', { notes: 'x' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('treats a FORBIDDEN delete as an idempotent success (SEC-7.1 non-enumeration)', async () => {
    // Deleting a missing item now returns a uniform 403 FORBIDDEN (was 200). To
    // preserve idempotent-delete UX, the client treats FORBIDDEN on delete as a
    // benign success (the item is already gone from the caller's own store).
    global.fetch.mockResolvedValue(errorJson(403, { error: 'Not authorized.', code: 'FORBIDDEN' }))
    const result = await collection.deleteItem('ghost', 'records')
    expect(result).toEqual({ ok: true })
    const [url, init] = global.fetch.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('id=ghost')
  })

  it('still surfaces a DEMO_READONLY delete as an error', async () => {
    global.fetch.mockResolvedValue(errorJson(403, { error: 'The demo collection is read-only.', code: 'DEMO_READONLY' }))
    await expect(collection.deleteItem('r1', 'records')).rejects.toMatchObject({ code: 'DEMO_READONLY' })
  })

  it('throws a code-less error when the error body has an error but no code', async () => {
    global.fetch.mockResolvedValue(errorJson(500, { error: 'Blob store exploded' }))
    try {
      await collection.listItems()
      throw new Error('expected listItems to reject')
    } catch (err) {
      expect(err.message).toBe('Blob store exploded')
      expect(err.code).toBeUndefined()
    }
  })
})
