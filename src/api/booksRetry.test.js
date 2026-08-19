import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupFetch } from '../../netlify/functions/_shared/lookup-fetch'

// The shared T1 retry helper (netlify/functions/_shared/lookup-fetch.js) now
// owns the fetch+retry logic previously inlined in books.js as
// `fetchGoogleWithRetry`. This suite keeps the original books retry contract
// covered through the shared helper; the full helper policy (deadlines, bounded
// Retry-After, full-jitter) has its own dedicated suite in
// _shared/lookup-fetch.test.js.
//
// The helper only fetches — it returns the fetch Response, and the caller
// (netlify/functions/books.js lookup / discogs.js) decides what to cache. We
// pin `retries` to 1 (2 attempts, matching the old default) and pass a 0 budget
// for the backoff window so the tests stay fast (no real backoff sleep).
function response(status) {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) }
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('lookupFetch (books retry contract)', () => {
  it('retries a transient 429 and returns the eventual 200', async () => {
    global.fetch
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200))
    const result = await lookupFetch('https://www.googleapis.com/books/v1/volumes', { retries: 1, baseDelayMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(result.status).toBe(200)
  })

  it('surfaces a persistent 429 after the retries are exhausted', async () => {
    global.fetch.mockResolvedValue(response(429))
    const result = await lookupFetch('https://www.googleapis.com/books/v1/volumes', { retries: 1, baseDelayMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
    expect(result.status).toBe(429)
  })

  it('catches a network error, retries, and rethrows when it keeps failing', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(lookupFetch('https://www.googleapis.com/books/v1/volumes', { retries: 1, baseDelayMs: 0 }))
      .rejects.toThrow('Failed to fetch')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('returns a non-transient failure immediately without retrying', async () => {
    global.fetch.mockResolvedValue(response(404))
    const result = await lookupFetch('https://www.googleapis.com/books/v1/volumes', { retries: 1, baseDelayMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(result.status).toBe(404)
  })
})
