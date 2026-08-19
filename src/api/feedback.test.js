import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as feedback from './feedback'
import { saveSession } from '../utils/session'

function okJson(data) {
  return { ok: true, status: 200, json: async () => data }
}

function createdJson(data) {
  return { ok: true, status: 201, json: async () => data }
}

function noContent() {
  return { ok: true, status: 204, json: async () => { throw new Error('no body') } }
}

function errorJson(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const SESSION_TOKEN = 'tok-feedback-session-abc123'

describe('feedback API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    saveSession({ user: { id: 'u1', name: 'Ada', role: 'member' }, session: SESSION_TOKEN })
  })

  it('submits feedback with POST and a JSON body, and returns the created item', async () => {
    const created = { id: 'fb-1', type: 'bug', category: 'scanner', message: 'Scan fails', status: 'open' }
    global.fetch.mockResolvedValue(createdJson(created))
    const item = await feedback.submitFeedback({
      type: 'bug',
      category: 'scanner',
      message: 'Scan fails',
      url: '/settings',
      appVersion: '1.2.3',
    })
    expect(item).toEqual(created)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/feedback')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`)
    expect(JSON.parse(init.body)).toEqual({
      type: 'bug',
      category: 'scanner',
      message: 'Scan fails',
      url: '/settings',
      appVersion: '1.2.3',
    })
  })

  it('lists the admin inbox with optional status/type filters', async () => {
    const payload = { items: [{ id: 'fb-1', type: 'suggestion', status: 'open' }] }
    global.fetch.mockResolvedValue(okJson(payload))
    const items = await feedback.listFeedback({ status: 'open', type: 'bug' })
    expect(items).toEqual(payload.items)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/feedback')
    expect(url).toContain('status=open')
    expect(url).toContain('type=bug')
    // GET is the default method — no method key in the init (collection.js convention).
    expect(init.method).toBeUndefined()
    expect(init.headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`)
  })

  it('maps a missing items key to an empty list', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    expect(await feedback.listFeedback()).toEqual([])
  })

  it('omits empty filters from the list query', async () => {
    global.fetch.mockResolvedValue(okJson({ items: [] }))
    await feedback.listFeedback({ status: '', type: undefined })
    const url = global.fetch.mock.calls[0][0]
    expect(url).not.toContain('status=')
    expect(url).not.toContain('type=')
  })

  it('updates feedback status and adminNote with PATCH and a JSON body', async () => {
    const updated = { id: 'fb-1', status: 'done', adminNote: 'Fixed in 1.3' }
    global.fetch.mockResolvedValue(okJson(updated))
    const item = await feedback.updateFeedback({ id: 'fb-1', status: 'done', adminNote: 'Fixed in 1.3' })
    expect(item).toEqual(updated)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/feedback')
    expect(init.method).toBe('PATCH')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`)
    expect(JSON.parse(init.body)).toEqual({ id: 'fb-1', status: 'done', adminNote: 'Fixed in 1.3' })
  })

  it('only sends the fields the caller provided on update', async () => {
    global.fetch.mockResolvedValue(okJson({ id: 'fb-1', status: 'wontfix' }))
    await feedback.updateFeedback({ id: 'fb-1', status: 'wontfix' })
    const [, init] = global.fetch.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ id: 'fb-1', status: 'wontfix' })
    expect(JSON.parse(init.body).adminNote).toBeUndefined()
  })

  it('deletes feedback with DELETE and the id query param (204 resolves to undefined)', async () => {
    global.fetch.mockResolvedValue(noContent())
    const result = await feedback.deleteFeedback('fb-9')
    expect(result).toBeUndefined()
    const [url, init] = global.fetch.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('id=fb-9')
    expect(init.headers.Authorization).toBe(`Bearer ${SESSION_TOKEN}`)
  })

  it('surfaces a server-provided error message and its code (429 RATE_LIMIT)', async () => {
    global.fetch.mockResolvedValue(errorJson(429, {
      error: 'Too many submissions — try again later.',
      code: 'RATE_LIMIT',
    }))
    await expect(feedback.submitFeedback({ message: 'hi' })).rejects.toMatchObject({
      message: 'Too many submissions — try again later.',
      code: 'RATE_LIMIT',
    })
  })

  it('passes through server codes (400 INVALID_TYPE, 403 DEMO_READONLY, 404)', async () => {
    global.fetch.mockResolvedValue(errorJson(400, { error: 'Unknown type', code: 'INVALID_TYPE' }))
    await expect(feedback.submitFeedback({ type: 'nope', message: 'x' })).rejects.toMatchObject({ code: 'INVALID_TYPE' })

    global.fetch.mockResolvedValue(errorJson(403, { error: 'The demo space is read-only.', code: 'DEMO_READONLY' }))
    await expect(feedback.submitFeedback({ message: 'x' })).rejects.toMatchObject({ code: 'DEMO_READONLY' })

    global.fetch.mockResolvedValue(errorJson(404, { error: 'Not found' }))
    await expect(feedback.updateFeedback({ id: 'junk' })).rejects.toThrow('Not found')
  })

  it('falls back to a generic message and HTTP_ERROR code when the body has no error/code', async () => {
    global.fetch.mockResolvedValue(errorJson(500, {}))
    try {
      await feedback.listFeedback()
      throw new Error('expected listFeedback to reject')
    } catch (err) {
      expect(err.message).toBe('Request failed (500)')
      expect(err.code).toBe('HTTP_ERROR')
    }
  })

  it('falls back to a generic message and HTTP_ERROR code when the error body is not JSON', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not json') },
    })
    try {
      await feedback.submitFeedback({ message: 'x' })
      throw new Error('expected submitFeedback to reject')
    } catch (err) {
      expect(err.message).toBe('Request failed (502)')
      expect(err.code).toBe('HTTP_ERROR')
    }
  })

  it('throws a NO_TOKEN code without hitting the network when not signed in', async () => {
    saveSession(null)
    const calls = [
      () => feedback.submitFeedback({ message: 'x' }),
      () => feedback.listFeedback(),
      () => feedback.updateFeedback({ id: 'fb-1' }),
      () => feedback.deleteFeedback('fb-1'),
    ]
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ code: 'NO_TOKEN' })
    }
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
