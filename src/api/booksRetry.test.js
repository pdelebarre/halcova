import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGoogleWithRetry } from '../../netlify/functions/books'

// The retry helper only fetches — it returns the fetch Response, and the
// caller (netlify/functions/books.js lookup) decides what to cache. delayMs 0
// keeps the tests fast (no real 800ms backoff).
function response(status) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) }
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('fetchGoogleWithRetry', () => {
  it('retries a transient 429 and returns the eventual 200', async () => {
    global.fetch
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200))
    const result = await fetchGoogleWithRetry('https://www.googleapis.com/books/v1/volumes', { delayMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(result.status).toBe(200)
  })

  it('surfaces a persistent 429 after the retries are exhausted', async () => {
    global.fetch.mockResolvedValue(response(429))
    const result = await fetchGoogleWithRetry('https://www.googleapis.com/books/v1/volumes', { delayMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(result.status).toBe(429)
  })

  it('catches a network error, retries, and rethrows when it keeps failing', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchGoogleWithRetry('https://www.googleapis.com/books/v1/volumes', { delayMs: 0 }))
      .rejects.toThrow('Failed to fetch')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns a non-transient failure immediately without retrying', async () => {
    global.fetch.mockResolvedValue(response(404))
    const result = await fetchGoogleWithRetry('https://www.googleapis.com/books/v1/volumes', { delayMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(result.status).toBe(404)
  })
})
