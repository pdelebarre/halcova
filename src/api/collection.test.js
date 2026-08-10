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
    saveSession({ user: { id: 'u1' }, code: 'RU-AAAA-BBBB-CCCC' })
  })

  it('lists items with the collection param', async () => {
    global.fetch.mockResolvedValue(okJson({ items: [{ id: '1' }] }))
    const items = await collection.listItems('books')
    expect(items).toEqual([{ id: '1' }])
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/.netlify/functions/collection')
    expect(url).toContain('collection=books')
  })

  it('sends the signed-in access code as a Bearer header on every call', async () => {
    global.fetch.mockResolvedValue(okJson({ items: [] }))
    await collection.listItems('records')
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer RU-AAAA-BBBB-CCCC')
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
})
