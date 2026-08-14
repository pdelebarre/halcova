// @vitest-environment node
//
// Tests for the transactional mailer (_shared/mailer.js). S8 (#54, M3):
//   - a missing RUNOUT_MAIL_API_KEY is a DEV-ONLY no-op — the link is logged so
//     a developer can click through,
//   - in PRODUCTION a missing key FAILS CLOSED: sendMagicLink throws
//     (code MAIL_NOT_CONFIGURED) and the link is never minted or logged, so a
//     misconfigured prod can't mint sign-in links for arbitrary emails,
//   - with the key configured, the mail is sent via the Resend REST API.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDevEmailMode, isMailConfigured, sendMagicLink } from './mailer'

const LINK = 'http://localhost:8888/?magic-link=abc123'

afterEach(() => {
  delete process.env.RUNOUT_MAIL_API_KEY
  delete process.env.RUNOUT_MAIL_FROM
  delete process.env.NODE_ENV
  delete process.env.RUNOUT_DEV_EMAIL
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isDevEmailMode / isMailConfigured', () => {
  it('treats non-production as dev email mode', () => {
    delete process.env.NODE_ENV
    expect(isDevEmailMode()).toBe(true)
  })

  it('treats NODE_ENV=production as NOT dev unless RUNOUT_DEV_EMAIL=1', () => {
    process.env.NODE_ENV = 'production'
    expect(isDevEmailMode()).toBe(false)
    process.env.RUNOUT_DEV_EMAIL = '1'
    expect(isDevEmailMode()).toBe(true)
  })

  it('reports whether the mail key is configured', () => {
    expect(isMailConfigured()).toBe(false)
    process.env.RUNOUT_MAIL_API_KEY = 're_test_123'
    expect(isMailConfigured()).toBe(true)
  })
})

describe('sendMagicLink — dev no-op vs production fail-closed (M3)', () => {
  it('in dev, a missing key returns { sent: false } and logs the link (no-op mailer)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await sendMagicLink({ email: 'ada@example.com', link: LINK })
    expect(result).toEqual({ sent: false })
    // The link (not the access code) is logged so a developer can click through.
    expect(log).toHaveBeenCalledWith(`[mailer:dev] magic-link for ada@example.com: ${LINK}`)
  })

  it('in production, a missing key THROWS MAIL_NOT_CONFIGURED and never logs the link', async () => {
    process.env.NODE_ENV = 'production'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await expect(sendMagicLink({ email: 'ada@example.com', link: LINK })).rejects.toMatchObject({ code: 'MAIL_NOT_CONFIGURED' })
    expect(log).not.toHaveBeenCalled()
  })

  it('in dev with RUNOUT_DEV_EMAIL=1 under NODE_ENV=production, keeps the no-op log', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RUNOUT_DEV_EMAIL = '1'
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const result = await sendMagicLink({ email: 'ada@example.com', link: LINK })
    expect(result).toEqual({ sent: false })
    expect(log).toHaveBeenCalled()
  })

  it('in production with the key configured, sends via the provider', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RUNOUT_MAIL_API_KEY = 're_test_123'
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendMagicLink({ email: 'ada@example.com', link: LINK })
    expect(result).toEqual({ sent: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(opts.headers.Authorization).toBe('Bearer re_test_123')
    const payload = JSON.parse(opts.body)
    expect(payload.to).toEqual(['ada@example.com'])
    expect(payload.html).toContain(LINK)
  })

  it('throws a provider error (the caller surfaces a 502) when Resend rejects', async () => {
    process.env.RUNOUT_MAIL_API_KEY = 're_test_123'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => 'validation error' }))
    await expect(sendMagicLink({ email: 'ada@example.com', link: LINK })).rejects.toThrow(/Mail send failed/)
  })
})
