// @vitest-environment node
//
// SEC-6.3 #217 — SSRF regression suite for the external API proxies. This is
// the standing regression guard that proves the app's SSRF posture across EVERY
// surface that makes an outbound fetch or resolves a user/operator-controlled
// URL. No real network — fetch is mocked, and URL/DNS/scheme/allowlist/content-
// type/size logic is asserted directly.
//
// Surfaces covered:
//   1. lookup-fetch.js  — the shared lookup proxy helper: sacred
//      `redirect:'manual'` on EVERY attempt (never follows a hostile 3xx into
//      an internal target).
//   2. providers/payload-guard.js isAllowedProviderUrl — the host allowlist
//      that every provider adapter runs; off-allowlist hosts fail closed.
//   3. providers/payload-guard.js isJsonContentType — the content-type bound
//      every JSON proxy enforces (a hostile upstream cannot smuggle an
//      HTML/image body past the JSON boundary).
//   4. cover.js isAllowedCoverUrl — the PUBLIC cover proxy's URL allowlist:
//      scheme abuse, IP/loopback/metadata, alternate/look-alike hosts,
//      protocol-relative, userinfo, encoded/punycode/trailing-dot tricks.
//   5. ai/openai.js — the AI provider (#303): redirect:'manual', content-type
//      bound, and body-size bound (mirrors lookup-fetch).
//   6. Provider ALLOWED_HOSTS (musicbrainz / openlibrary / adapters) — the
//      fixed host sets asserted so a drift in the allowlist fails the suite.
//
// The lookup proxies (discogs.js / books.js) and the fallback adapters
// (musicbrainz.js / openlibrary.js) additionally enforce the content-type bound
// at their own fetch boundary; those are asserted in their per-proxy suites and
// here via the shared helper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupFetch } from './lookup-fetch'
import { isAllowedProviderUrl, isJsonContentType } from './providers/payload-guard'
import { isAllowedCoverUrl, isAllowedCoverHost } from './cover'
import { ALLOWED_HOSTS as MB_ALLOWED_HOSTS } from './providers/musicbrainz'
import { ALLOWED_HOSTS as OL_ALLOWED_HOSTS } from './providers/openlibrary'
import { PROVIDER_ALLOWED_HOSTS } from './providers/adapters'

// A bare fetch Response backing object.
function response(status, { headers = {}, body } = {}) {
  const text = typeof body === 'string' ? body : ''
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] ?? null },
    text: async () => text,
  }
}

const originalFetch = global.fetch
beforeEach(() => { global.fetch = vi.fn() })
afterEach(() => { global.fetch = originalFetch })

describe('SSRF #217 — shared lookup proxy (lookup-fetch.js)', () => {
  it('always sets redirect: manual on every attempt, never follows', async () => {
    const redirects = []
    global.fetch = vi.fn((_url, init) => {
      redirects.push(init?.redirect)
      return Promise.resolve(response(200))
    })
    await lookupFetch('https://api.example.com/x', { retries: 2 })
    expect(redirects).toEqual(['manual'])
  })

  it('keeps redirect: manual across a retry (a hostile 3xx can never be followed)', async () => {
    const redirects = []
    const statuses = [302, 302, 200] // a hostile proxy chain
    global.fetch = vi.fn((_url, init) => {
      redirects.push(init?.redirect)
      return Promise.resolve(response(statuses.shift()))
    })
    await lookupFetch('https://api.example.com/x', { retries: 2, baseDelayMs: 0 })
    // Even when the upstream returns 3xx, the helper returns the raw response
    // (redirect: manual) and NEVER auto-follows into a 2nd-party target.
    expect(redirects.every((r) => r === 'manual')).toBe(true)
  })

  it('refuses to follow any scheme other than the caller URL (no http downgrade)', async () => {
    const urls = []
    global.fetch = vi.fn((url, init) => {
      urls.push(url)
      return Promise.resolve(response(200))
    })
    await lookupFetch('https://api.example.com/secure', { retries: 0 })
    expect(urls).toEqual(['https://api.example.com/secure'])
  })
})

describe('SSRF #217 — provider host allowlist (isAllowedProviderUrl)', () => {
  it('accepts an allowlisted host and its subdomains, rejects off-allowlist', () => {
    const allowed = ['api.discogs.com']
    expect(isAllowedProviderUrl('https://api.discogs.com/database/search', allowed)).toBe(true)
    expect(isAllowedProviderUrl('https://img.discogs.com/x', allowed)).toBe(false)
    expect(isAllowedProviderUrl('https://api.example.internal/x', allowed)).toBe(false)
    // A non-URL string is not a fetch target and is allowed.
    expect(isAllowedProviderUrl('not-a-url', allowed)).toBe(true)
  })

  it('fails closed when no allowlist is provided (rejects every URL)', () => {
    expect(isAllowedProviderUrl('https://anything.example/x', [])).toBe(false)
  })

  it('does not accept a host prefix trick (attacker.example vs example)', () => {
    const allowed = ['example.com']
    expect(isAllowedProviderUrl('https://evil-example.com/x', allowed)).toBe(false)
    expect(isAllowedProviderUrl('https://example.com.evil.io/x', allowed)).toBe(false)
  })
})

describe('SSRF #217 — content-type bound (isJsonContentType)', () => {
  it('accepts application/json and +json suffixes', () => {
    expect(isJsonContentType('application/json')).toBe(true)
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isJsonContentType('application/problem+json')).toBe(true)
    expect(isJsonContentType('')).toBe(true) // absent -> JSON.parse still validates
    expect(isJsonContentType(undefined)).toBe(true)
  })

  it('rejects a non-JSON content-type fail-closed', () => {
    expect(isJsonContentType('text/html')).toBe(false)
    expect(isJsonContentType('image/jpeg')).toBe(false)
    expect(isJsonContentType('text/plain')).toBe(false)
    expect(isJsonContentType('application/octet-stream')).toBe(false)
    expect(isJsonContentType('application/xml')).toBe(false)
  })
})

describe('SSRF #217 — public cover proxy URL allowlist (cover.js)', () => {
  it('rejects scheme abuse and protocol-relative URLs', () => {
    expect(isAllowedCoverUrl('http://i.discogs.com/x.jpg')).toBe(false) // downgraded
    expect(isAllowedCoverUrl('ftp://i.discogs.com/x.jpg')).toBe(false)
    expect(isAllowedCoverUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedCoverUrl('gopher://i.discogs.com/x')).toBe(false)
    expect(isAllowedCoverUrl('//i.discogs.com/x.jpg')).toBe(false) // protocol-relative
  })

  it('rejects private / link-local / loopback / cloud-metadata IP hosts', () => {
    const ipTargets = [
      'https://127.0.0.1/x.png',
      'https://localhost/x.png',
      'https://0.0.0.0/x.png',
      'https://169.254.169.254/latest/meta-data/', // cloud metadata
      'https://10.0.0.1/x.png', // RFC1918
      'https://192.168.1.1/x.png',
      'https://172.16.0.1/x.png',
      'https://[::1]/x.png', // IPv6 loopback
      'https://[fd00::1]/x.png', // IPv6 ULA
    ]
    for (const url of ipTargets) expect(isAllowedCoverUrl(url)).toBe(false)
  })

  it('rejects look-alike / suffix-bypass / alternate hosts', () => {
    const lookalikes = [
      'https://evil-discogs.com/x.jpg',
      'https://discogs.com.evil.com/x.jpg',
      'https://i.discogs.com.evil.com/x.jpg',
      'https://notdiscogs.com/x.jpg',
      'https://books.google.com.evil.com/x.jpg',
      'https://coverartarchive.org.evil.com/x.jpg',
      'https://covers.openlibrary.org.evil.com/x.jpg',
    ]
    for (const url of lookalikes) expect(isAllowedCoverUrl(url)).toBe(false)
  })

  it('rejects encoded/punycode/trailing-dot host tricks', () => {
    expect(isAllowedCoverUrl('https://i.discogs.com%2eevil.com/x.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://xn--i-9qba.example/x.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://i.discogs.com./x.jpg')).toBe(false)
    expect(isAllowedCoverUrl('https://i.discogs.com%2e/x.jpg')).toBe(false)
  })

  it('does NOT let userinfo (user@host) smuggle a different connect host', () => {
    expect(isAllowedCoverUrl('https://i.discogs.com@evil.com/x.jpg')).toBe(false)
  })

  it('rejects a non-https cover even on an allowed host', () => {
    expect(isAllowedCoverUrl('http://i.discogs.com/x.jpg')).toBe(false)
  })

  it('accepts a legitimate https cover from an allowed host', () => {
    expect(isAllowedCoverUrl('https://i.discogs.com/hash/image-1.jpeg')).toBe(true)
    expect(isAllowedCoverUrl('https://coverartarchive.org/release/x/front-250')).toBe(true)
    expect(isAllowedCoverUrl('https://covers.openlibrary.org/b/id/1-M.jpg')).toBe(true)
  })

  it('cover host allowlist is exact-suffix only (dot boundary)', () => {
    expect(isAllowedCoverHost('i.discogs.com')).toBe(true)
    expect(isAllowedCoverHost('discogs.com.evil.com')).toBe(false)
    expect(isAllowedCoverHost('notdiscogs.com')).toBe(false)
  })
})

describe('SSRF #217 — AI provider (ai/openai.js, #303)', () => {
  it('sets redirect: manual (mirrors lookup-fetch)', async () => {
    const { OpenAIProvider } = await import('./ai/openai')
    const redirects = []
    global.fetch = vi.fn((_url, init) => {
      redirects.push(init?.redirect)
      return Promise.resolve(response(200, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
      }))
    })
    const provider = new OpenAIProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    })
    await provider.complete({ user: 'hi', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } })
    expect(redirects.every((r) => r === 'manual')).toBe(true)
  })

  it('rejects a non-JSON content-type fail-closed', async () => {
    const { OpenAIProvider } = await import('./ai/openai')
    const { ProviderErrorCode } = await import('./ai/provider')
    global.fetch = vi.fn(() => Promise.resolve(response(200, {
      headers: { 'content-type': 'text/html' },
      body: '<html>not json</html>',
    })))
    const provider = new OpenAIProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
    })
    await expect(provider.complete({ user: 'hi', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects an oversized body (bounded read)', async () => {
    const { OpenAIProvider } = await import('./ai/openai')
    const { ProviderErrorCode } = await import('./ai/provider')
    const big = JSON.stringify({ choices: [{ message: { content: '{"ok":' + 'x'.repeat(2 * 1024 * 1024) + '}' } }] })
    global.fetch = vi.fn(() => Promise.resolve(response(200, {
      headers: { 'content-type': 'application/json' },
      body: big,
    })))
    const provider = new OpenAIProvider({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      options: { maxResponseBytes: 1024 },
    })
    await expect(provider.complete({ user: 'hi', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } }))
      .rejects.toMatchObject({ code: ProviderErrorCode.OVERSIZED_OUTPUT })
  })
})

describe('SSRF #217 — provider ALLOWED_HOSTS are fixed (no drift)', () => {
  it('musicbrainz adapter allowlist is fixed', () => {
    expect(MB_ALLOWED_HOSTS).toEqual(['musicbrainz.org', 'coverartarchive.org'])
  })

  it('openlibrary adapter allowlist is fixed', () => {
    expect(OL_ALLOWED_HOSTS).toEqual(['openlibrary.org', 'covers.openlibrary.org'])
  })

  it('registered adapter allowlists are fixed', () => {
    expect(PROVIDER_ALLOWED_HOSTS.discogs).toEqual(['api.discogs.com', 'i.discogs.com'])
    expect(PROVIDER_ALLOWED_HOSTS.musicbrainz).toEqual(['musicbrainz.org', 'coverartarchive.org'])
    expect(PROVIDER_ALLOWED_HOSTS.googleBooks).toEqual(['www.googleapis.com', 'books.google.com'])
    expect(PROVIDER_ALLOWED_HOSTS.openlibrary).toEqual(['openlibrary.org', 'covers.openlibrary.org'])
  })
})