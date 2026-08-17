import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as lending from './lending'
import { saveSession } from '../utils/session'

const SESSION_TOKEN = 'tok-lending-session-abc123'

function okJson(data) {
  return { ok: true, status: 200, json: async () => data }
}

function errorJson(status, body = {}) {
  return { ok: false, status, json: async () => body }
}

const LENT = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  lending: { borrower: { name: 'Alice' }, lentOn: '2026-08-01T00:00:00Z' },
}

const RETURNED = { id: 'r1', title: 'Miles Davis - Kind of Blue' }

beforeEach(() => {
  localStorage.clear()
  saveSession({ user: { id: 'u42' }, session: SESSION_TOKEN })
  global.fetch = vi.fn()
})

describe('lend', () => {
  it('lends an item and returns the updated item with lending set', async () => {
    global.fetch.mockResolvedValue(okJson({ item: LENT }))
    const item = await lending.lend({ collection: 'records', itemId: 'r1', borrower: { name: 'Alice' } })
    expect(item).toEqual(LENT)
  })

  it('posts the lend action, collection, itemId, borrower and dueOn to the lending function', async () => {
    global.fetch.mockResolvedValue(okJson({ item: LENT }))
    await lending.lend({
      collection: 'records',
      itemId: 'r1',
      borrower: { name: 'Alice', contact: 'a@x.com' },
      dueOn: '2026-09-01',
    })

    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/.netlify/functions/lending')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${SESSION_TOKEN}` })
    expect(JSON.parse(init.body)).toEqual({
      action: 'lend',
      collection: 'records',
      itemId: 'r1',
      borrower: { name: 'Alice', contact: 'a@x.com' },
      dueOn: '2026-09-01',
    })
  })

  it('surfaces the server error when lending is not enabled for the account (403)', async () => {
    global.fetch.mockResolvedValue(errorJson(403, { error: "Lending isn't enabled for your account." }))
    await expect(lending.lend({ collection: 'records', itemId: 'r1', borrower: { name: 'Alice' } }))
      .rejects.toThrow("Lending isn't enabled for your account.")
  })

  it('surfaces the server error when the item is already on loan (409)', async () => {
    global.fetch.mockResolvedValue(errorJson(409, { error: 'Item is already on loan.' }))
    await expect(lending.lend({ collection: 'records', itemId: 'r1', borrower: { name: 'Alice' } }))
      .rejects.toThrow('Item is already on loan.')
  })
})

describe('returnItem', () => {
  it('marks an item returned and returns the updated item without lending', async () => {
    global.fetch.mockResolvedValue(okJson({ item: RETURNED }))
    const item = await lending.returnItem({ collection: 'records', itemId: 'r1' })
    expect(item).toEqual(RETURNED)
  })

  it('posts the return action to the lending function', async () => {
    global.fetch.mockResolvedValue(okJson({ item: RETURNED }))
    await lending.returnItem({ collection: 'records', itemId: 'r1' })

    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/.netlify/functions/lending')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${SESSION_TOKEN}` })
    expect(JSON.parse(init.body)).toEqual({ action: 'return', collection: 'records', itemId: 'r1' })
  })

  it('surfaces the server error when the item is not on loan (409)', async () => {
    global.fetch.mockResolvedValue(errorJson(409, { error: 'Item is not on loan.' }))
    await expect(lending.returnItem({ collection: 'records', itemId: 'r1' })).rejects.toThrow('Item is not on loan.')
  })

  it('surfaces the server error when the item is not found (404)', async () => {
    global.fetch.mockResolvedValue(errorJson(404, { error: 'Item not found.' }))
    await expect(lending.returnItem({ collection: 'records', itemId: 'missing' })).rejects.toThrow('Item not found.')
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('not json') } })
    await expect(lending.returnItem({ collection: 'records', itemId: 'r1' })).rejects.toThrow('Request failed (500)')
  })
})
