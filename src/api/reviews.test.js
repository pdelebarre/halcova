import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as reviews from './reviews'
import { saveSession } from '../utils/session'

function okJson(data) {
  return { ok: true, status: 200, json: async () => data }
}

function errorJson(status, body) {
  return { ok: false, status, json: async () => body }
}

describe('reviews API', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
    saveSession({ user: { id: 'u1', name: 'Miles' }, session: 'tok-reviews-session-abc123' })
  })

  it('lists a release thread with kind and sourceId params and unwraps the payload', async () => {
    const payload = {
      reviews: [{ id: 'r1', kind: 'records', sourceId: '101', rating: 5 }],
      aggregate: { avg: 4.5, count: 2 },
      mine: { id: 'r1', rating: 5 },
    }
    global.fetch.mockResolvedValue(okJson(payload))
    const data = await reviews.listReviews('records', '101')
    expect(data).toEqual(payload)
    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/.netlify/functions/reviews')
    expect(url).toContain('kind=records')
    expect(url).toContain('sourceId=101')
  })

  it('maps missing reviews/aggregate/mine to safe defaults (never undefined)', async () => {
    global.fetch.mockResolvedValue(okJson({}))
    const data = await reviews.listReviews('books', 'isbn123')
    expect(data.reviews).toEqual([])
    expect(data.aggregate).toEqual({ avg: 0, count: 0 })
    expect(data.mine).toBeNull()
  })

  it('sends the signed-in session token as a Bearer header on reads', async () => {
    global.fetch.mockResolvedValue(okJson({ reviews: [] }))
    await reviews.listReviews('records', '1')
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok-reviews-session-abc123')
  })

  it('upserts a review with POST and a JSON body', async () => {
    global.fetch.mockResolvedValue(okJson({ review: { id: 'r9', rating: 4 } }))
    const data = await reviews.upsertReview({ kind: 'records', sourceId: '101', rating: 4, body: 'Nice pressing' })
    const [url, init] = global.fetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ kind: 'records', sourceId: '101', rating: 4, body: 'Nice pressing' })
    expect(data.review).toEqual({ id: 'r9', rating: 4 })
  })

  it('deletes a review with DELETE and the kind/sourceId/id query params', async () => {
    global.fetch.mockResolvedValue(okJson({ ok: true }))
    await reviews.deleteReview({ kind: 'books', sourceId: 'isbn123', id: 'r9' })
    const [url, init] = global.fetch.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect(url).toContain('kind=books')
    expect(url).toContain('sourceId=isbn123')
    expect(url).toContain('id=r9')
  })

  it('surfaces the server error message AND its machine-readable code', async () => {
    global.fetch.mockResolvedValue(errorJson(403, {
      error: "Your plan doesn't include reviews.",
      code: 'PLAN_FORBIDDEN',
    }))
    await expect(reviews.upsertReview({ kind: 'records', sourceId: '1', rating: 5 })).rejects.toMatchObject({
      message: "Your plan doesn't include reviews.",
      code: 'PLAN_FORBIDDEN',
    })
  })

  it('attaches other contract codes (RATE_LIMITED / NOT_FOUND / BAD_REQUEST)', async () => {
    global.fetch.mockResolvedValue(errorJson(429, { error: 'Slow down', code: 'RATE_LIMITED' }))
    await expect(reviews.upsertReview({ kind: 'records', sourceId: '1', rating: 5 })).rejects.toMatchObject({ code: 'RATE_LIMITED' })

    global.fetch.mockResolvedValue(errorJson(404, { error: 'Gone', code: 'NOT_FOUND' }))
    await expect(reviews.deleteReview({ kind: 'records', sourceId: '1', id: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    global.fetch.mockResolvedValue(errorJson(400, { error: 'Bad', code: 'BAD_REQUEST' }))
    await expect(reviews.upsertReview({ kind: 'records', sourceId: '1', rating: 9 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('falls back to a generic message when the body has no error', async () => {
    global.fetch.mockResolvedValue(errorJson(500, {}))
    await expect(reviews.listReviews('records', '1')).rejects.toThrow('Request failed (500)')
  })
})
