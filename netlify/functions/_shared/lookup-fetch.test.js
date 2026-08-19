// @vitest-environment node
//
// Dedicated unit suite for the shared T1 lookup fetch-retry helper
// (netlify/functions/_shared/lookup-fetch.js, RES-1.1 #284). Covers the full
// policy: retry-only-on-429/5xx, full-jitter + bounded Retry-After, per-attempt
// timeout + overall deadline abort, persistent-failure return contract, and the
// sacred SSRF `redirect:'manual'`. No real network — global.fetch is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  lookupFetch,
  isRetryableStatus,
  parseRetryAfter,
  fullJitterDelay,
  LookupTimeoutError,
} from './lookup-fetch'

// A bare fetch Response backing object (what the helper returns / examines).
function response(status, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
  }
}

// A fetch mock whose promise is never-resolving but rejects when the caller's
// AbortSignal fires — so a helper-controlled abort (per-attempt timeout or
// overall deadline) surfaces as a fetch rejection, exactly like the real one.
function abortableFetchMock() {
  return vi.fn((_url, init) => new Promise((resolve, reject) => {
    const signal = init?.signal
    if (!signal) return // should never happen (redirect manual only asserts signal presence elsewhere)
    const onAbort = () => {
      const err = new Error('The operation was aborted.')
      err.name = 'AbortError'
      reject(err)
    }
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
  }))
}

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = originalFetch
  vi.useRealTimers()
})

describe('isRetryableStatus', () => {
  it('retries only 429 and 5xx', () => {
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(502)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
    expect(isRetryableStatus(302)).toBe(false)
    expect(isRetryableStatus(200)).toBe(false)
  })
})

describe('parseRetryAfter', () => {
  it('parses a positive number of seconds', () => {
    expect(parseRetryAfter('3')).toBe(3)
    expect(parseRetryAfter('120')).toBe(120)
  })
  it('returns null for absent, malformed, or non-positive values', () => {
    expect(parseRetryAfter(null)).toBeNull()
    expect(parseRetryAfter(undefined)).toBeNull()
    expect(parseRetryAfter('abc')).toBeNull()
    expect(parseRetryAfter('0')).toBeNull()
    expect(parseRetryAfter('-5')).toBeNull()
    expect(parseRetryAfter('')).toBeNull()
  })
})

describe('success after retry', () => {
  it('retries a 429 then returns the eventual 200', async () => {
    global.fetch
      .mockResolvedValueOnce(response(429))
      .mockResolvedValueOnce(response(200))
    const res = await lookupFetch('https://api.example.com/x', { retries: 1, baseDelayMs: 0 })
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries a 5xx then returns the eventual 200', async () => {
    global.fetch
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200))
    const res = await lookupFetch('https://api.example.com/x', { retries: 1, baseDelayMs: 0 })
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})

describe('persistent retryable failure', () => {
  it('returns the LAST raw retryable Response (status preserved) after retries exhaust', async () => {
    global.fetch.mockResolvedValue(response(429))
    const res = await lookupFetch('https://api.example.com/x', { retries: 2, baseDelayMs: 0 })
    // 3 attempts, then the final 429 is surfaced raw for the caller to map.
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(res.status).toBe(429)
  })

  it('does the same for a persistent 5xx', async () => {
    global.fetch.mockResolvedValue(response(503))
    const res = await lookupFetch('https://api.example.com/x', { retries: 2, baseDelayMs: 0 })
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(res.status).toBe(503)
  })
})

describe('network failure', () => {
  it('retries a network error and succeeds on a later attempt', async () => {
    global.fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(response(200))
    const res = await lookupFetch('https://api.example.com/x', { retries: 2, baseDelayMs: 0 })
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws the underlying error when network failure persists across all attempts', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(lookupFetch('https://api.example.com/x', { retries: 2, baseDelayMs: 0 }))
      .rejects.toThrow('Failed to fetch')
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })
})

describe('overall deadline', () => {
  it('aborts the in-flight attempt and throws LookupTimeoutError when the overall deadline fires', async () => {
    vi.useFakeTimers()
    global.fetch = abortableFetchMock()
    // deadline 100ms; an attempt that never completes (until aborted). Attach
    // the rejection expectation BEFORE advancing timers so the throw is
    // considered handled (no unhandled-rejection noise from Vitest/Node).
    const promise = lookupFetch('https://api.example.com/x', { deadlineMs: 100, retries: 5 })
    // Explicitly mark the rejecting promise as handled so Node/Vitest don't
    // report an unhandled rejection before we await the assertion below.
    promise.catch(() => {})
    const assertion = expect(promise).rejects.toBeInstanceOf(LookupTimeoutError)

    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(global.fetch).toHaveBeenCalledTimes(1) // aborted mid-first-attempt; no further attempts
  })
})

describe('per-attempt timeout', () => {
  it('aborts a hung attempt, retries, and succeeds on the next attempt', async () => {
    vi.useFakeTimers()
    const abortable = abortableFetchMock()
    // First call hangs (until the per-attempt timeout aborts it); later calls
    // resolve 200. One real upstream "call" (the successful one) reaches 200.
    let call = 0
    global.fetch = vi.fn((url, init) => {
      call += 1
      if (call === 1) return abortable(url, init)
      return Promise.resolve(response(200))
    })

    const promise = lookupFetch('https://api.example.com/x', {
      retries: 2,
      attemptTimeoutMs: 50,
      deadlineMs: 100000,
      baseDelayMs: 0,
    })

    // Let attempt 0 hit its per-attempt timeout (aborts), triggering a retry.
    await vi.advanceTimersByTimeAsync(50)
    // Attempt 1 now proceeds and resolves 200.
    const res = await promise
    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })
})

describe('bounded Retry-After', () => {
  it('caps a huge 429 Retry-After to retryAfterMaxMs', async () => {
    // A hostile/huge Retry-After (e.g. 10 years) must be bounded. Use a slow
    // real timer with a tiny retryAfterMaxMs and verify the helper does not wait
    // anywhere near the upstream value.
    const started = Date.now()
    global.fetch
      .mockResolvedValueOnce(response(429, { 'retry-after': '999999' }))
      .mockResolvedValue(response(200))
    const res = await lookupFetch('https://api.example.com/x', {
      retries: 1,
      retryAfterMaxMs: 5, // tiny bound so the test is fast
      baseDelayMs: 0,
    })
    expect(res.status).toBe(200)
    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(2000) // nowhere near 999999s
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('uses full-jitter (bounded, non-retry-after) delay for 5xx', async () => {
    // 5xx should NOT honor Retry-After; verify it still respects the small
    // backoff window by completing quickly.
    const started = Date.now()
    global.fetch
      .mockResolvedValueOnce(response(503, { 'retry-after': '999999' }))
      .mockResolvedValue(response(200))
    const res = await lookupFetch('https://api.example.com/x', { retries: 1, baseDelayMs: 0, retryAfterMaxMs: 5 })
    expect(res.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('non-retryable statuses', () => {
  it.each([400, 401, 404, 403])('does not retry a %s', async (status) => {
    global.fetch
      .mockResolvedValueOnce(response(status))
      .mockResolvedValue(response(200))
    const res = await lookupFetch('https://api.example.com/x', { retries: 2 })
    expect(res.status).toBe(status)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not retry a 3xx (returns it raw so the caller rejects it)', async () => {
    global.fetch
      .mockResolvedValueOnce(response(302, { location: 'https://evil.example/' }))
      .mockResolvedValue(response(200))
    const res = await lookupFetch('https://api.example.com/x', { retries: 2 })
    expect(res.status).toBe(302)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('SSRF control — redirect: manual', () => {
  it('always sets redirect: manual on every attempt', async () => {
    let redirectValues = []
    global.fetch = vi.fn((_url, init) => {
      redirectValues.push(init?.redirect)
      return Promise.resolve(response(200))
    })
    await lookupFetch('https://api.example.com/x', { retries: 2 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(redirectValues).toEqual(['manual'])
  })

  it('sets redirect: manual even on a retry attempt', async () => {
    const redirects = []
    global.fetch = vi.fn((_url, init) => {
      redirects.push(init?.redirect)
      return Promise.resolve(response(retransientNext()))
    })
    // Provide two 429s then a success to trigger a retry and confirm both have
    // redirect: manual.
    const statuses = [429, 429, 200]
    function retransientNext() { return statuses.shift() }
    const res = await lookupFetch('https://api.example.com/x', { retries: 2, baseDelayMs: 0 })
    expect(res.status).toBe(200)
    expect(redirects).toEqual(['manual', 'manual', 'manual'])
  })
})

describe('fullJitterDelay', () => {
  it('stays within [0, base * 2^attempt) and never negative', () => {
    expect(fullJitterDelay(0, 500)).toBeGreaterThanOrEqual(0)
    expect(fullJitterDelay(0, 500)).toBeLessThan(500)
    expect(fullJitterDelay(1, 500)).toBeLessThan(1000) // base*2
    expect(fullJitterDelay(2, 500)).toBeLessThan(2000) // base*4
    expect(fullJitterDelay(3, 0)).toBe(0)
  })
})
