import { describe, expect, it, vi } from 'vitest'
import { isHealthyEmpty, lookupChain, lookupError } from './lookupChain'

// Build a server-style error with the documented `.code` contract.
function err(code, message = `err:${code}`) {
  const e = new Error(message)
  e.code = code
  return e
}

describe('lookupChain', () => {
  it('returns the first healthy result with provider derived from the attempt list', async () => {
    const results = [{ discogsId: 1, title: 'A - B' }]
    const lookup = vi.fn(async () => results)

    const out = await lookupChain({ providers: ['discogs', 'musicbrainz'], lookup })

    expect(out).toEqual({ results, provider: 'discogs', attempts: ['discogs'] })
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(lookup).toHaveBeenCalledWith('discogs', 0, ['discogs', 'musicbrainz'])
  })

  it('prefers the server source marker over the attempted provider on a fallback win', async () => {
    const results = [{ mbid: 'm1', discogsId: null, title: 'A - B' }]
    results.source = 'musicbrainz'
    const lookup = vi.fn(async () => results)

    const out = await lookupChain({ providers: ['discogs', 'musicbrainz'], lookup })

    expect(out.provider).toBe('musicbrainz')
    expect(out.results).toBe(results)
    expect(out.attempts).toEqual(['discogs'])
  })

  it('falls through a healthy-empty result (NO_MATCH outcome) to the next provider', async () => {
    const empty = []
    empty.source = 'discogs'
    empty.outcome = 'NO_MATCH'
    const win = [{ discogsId: 2, title: 'C - D' }]
    const lookup = vi.fn(async (provider) => (provider === 'discogs' ? empty : win))

    const out = await lookupChain({ providers: ['discogs', 'musicbrainz'], lookup })

    expect(out.provider).toBe('musicbrainz')
    expect(out.attempts).toEqual(['discogs', 'musicbrainz'])
    expect(lookup).toHaveBeenNthCalledWith(2, 'musicbrainz', 1, ['discogs', 'musicbrainz'])
  })

  it.each(['RATE_LIMIT', 'HTTP_ERROR', 'SERVER_NO_TOKEN', 'BAD_TOKEN'])(
    'falls through on %s and returns the next provider win',
    async (code) => {
      const win = [{ discogsId: 3, title: 'E - F' }]
      const lookup = vi.fn(async (provider) => {
        if (provider === 'discogs') throw err(code)
        return win
      })

      const out = await lookupChain({ providers: ['discogs', 'musicbrainz'], lookup })

      expect(out.provider).toBe('musicbrainz')
      expect(out.attempts).toEqual(['discogs', 'musicbrainz'])
    },
  )

  it('falls through on a bare network rejection (no error code)', async () => {
    const win = [{ discogsId: 4, title: 'G - H' }]
    const lookup = vi.fn(async (provider) => {
      if (provider === 'discogs') throw new Error('Network down')
      return win
    })

    const out = await lookupChain({ providers: ['discogs', 'musicbrainz'], lookup })

    expect(out.provider).toBe('musicbrainz')
  })

  it('throws NO_MATCH when every provider is healthy-empty', async () => {
    const empty = []
    empty.outcome = 'NO_MATCH'
    const lookup = vi.fn(async () => empty)

    await expect(lookupChain({ providers: ['discogs', 'musicbrainz'], lookup }))
      .rejects.toMatchObject({ code: 'NO_MATCH', attempts: ['discogs', 'musicbrainz'] })
  })

  it('throws ALL_ERROR when every provider errors, preserving the true cause (distinct from NO_MATCH)', async () => {
    const lookup = vi.fn(async (provider) => {
      throw err(provider === 'discogs' ? 'RATE_LIMIT' : 'ALL_PROVIDERS_FAILED')
    })

    await expect(lookupChain({ providers: ['discogs', 'musicbrainz'], lookup }))
      .rejects.toMatchObject({
        code: 'ALL_ERROR',
        attempts: ['discogs', 'musicbrainz'],
        cause: expect.objectContaining({ code: 'ALL_PROVIDERS_FAILED' }),
      })
  })

  it('throws NO_MATCH when no providers are configured (defensive)', async () => {
    await expect(lookupChain({ providers: [], lookup: vi.fn() })).rejects.toMatchObject({ code: 'NO_MATCH' })
    await expect(lookupChain({ providers: null, lookup: vi.fn() })).rejects.toMatchObject({ code: 'NO_MATCH' })
  })

  it('falls through a malformed (non-array) response as an outage', async () => {
    const win = [{ discogsId: 5, title: 'I - J' }]
    const lookup = vi.fn(async (provider) => (provider === 'discogs' ? { not: 'an array' } : win))

    const out = await lookupChain({ providers: ['discogs', 'musicbrainz'], lookup })

    expect(out.provider).toBe('musicbrainz')
  })

  it('isHealthyEmpty detects empty arrays only', () => {
    expect(isHealthyEmpty([])).toBe(true)
    expect(isHealthyEmpty([{ title: 'x' }])).toBe(false)
    expect(isHealthyEmpty(null)).toBe(false)
    expect(isHealthyEmpty(undefined)).toBe(false)
  })

  it('lookupError builds an Error carrying a code and extra metadata', () => {
    const e = lookupError('NO_MATCH', 'nope', { attempts: ['discogs'] })
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('NO_MATCH')
    expect(e.message).toBe('nope')
    expect(e.attempts).toEqual(['discogs'])
  })
})
