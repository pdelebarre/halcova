import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as payment from './payment'
import { getSession, saveSession } from '../utils/session'

function res(status, data) {
  return { ok: status >= 200 && status < 300, status, json: async () => data }
}

const MEMBER = { id: 'u1', name: 'Ada', role: 'member', plan: 'free', collections: { records: true, books: false } }

describe('payment API client (S3)', () => {
  beforeEach(() => {
    global.fetch = vi.fn()
  })

  it('createCheckout sends action/checkout + plan and returns { url, sessionId }', async () => {
    global.fetch.mockResolvedValue(res(200, { url: 'https://checkout.stripe.com/c/pay/cs_1', sessionId: 'cs_1' }))
    const out = await payment.createCheckout('lifetime', { name: 'Ada', email: 'ada@example.com' })
    expect(out).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_1', sessionId: 'cs_1' })

    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toContain('/.netlify/functions/payment')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ action: 'checkout', plan: 'lifetime', name: 'Ada', email: 'ada@example.com' })
    // A brand-new prospect has no session — no auth header.
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('createCheckout for a signed-in member carries their session token as Bearer', async () => {
    saveSession({ user: MEMBER, session: 'tok-member-session' })
    global.fetch.mockResolvedValue(res(200, { url: 'https://checkout.stripe.com/c/pay/cs_1', sessionId: 'cs_1' }))
    await payment.createCheckout('premium')
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok-member-session')
    expect(JSON.parse(init.body)).toEqual({ action: 'checkout', plan: 'premium' })
  })

  it('getCheckoutStatus returns pending and never touches the session', async () => {
    saveSession({ user: MEMBER, session: 'tok-member-session' })
    global.fetch.mockResolvedValue(res(200, { status: 'pending' }))
    const out = await payment.getCheckoutStatus('cs_1')
    expect(out).toEqual({ status: 'pending' })
    expect(getSession()).toEqual({ user: MEMBER, session: 'tok-member-session' })
  })

  it('getCheckoutStatus persists the SESSION (never the code) for a brand-new prospect', async () => {
    global.fetch.mockResolvedValue(res(200, {
      status: 'complete',
      user: { id: 'u2', plan: 'lifetime' },
      session: 'tok-new-prospect',
      code: 'RU-NEWW-NEWW-NEWW',
    }))
    const out = await payment.getCheckoutStatus('cs_1')
    expect(out.status).toBe('complete')
    expect(getSession()).toEqual({ user: { id: 'u2', plan: 'lifetime' }, session: 'tok-new-prospect' })
    // SEC-1.2 (#177): the one-time code is returned but NEVER persisted.
    expect(localStorage.getItem('runout.session')).not.toContain('RU-NEWW')
  })

  it('getCheckoutStatus for an existing member (no new session) does NOT wipe their stored session', async () => {
    saveSession({ user: MEMBER, session: 'tok-member-session' })
    global.fetch.mockResolvedValue(res(200, { status: 'complete', user: { ...MEMBER, plan: 'premium' } }))
    const out = await payment.getCheckoutStatus('cs_1')
    expect(out.status).toBe('complete')
    // The member keeps their existing session — the upgrade only changes the plan.
    expect(getSession().session).toBe('tok-member-session')
  })

  it('openPortal sends the session token as Bearer and returns the portal url', async () => {
    saveSession({ user: MEMBER, session: 'tok-member-session' })
    global.fetch.mockResolvedValue(res(200, { url: 'https://billing.stripe.com/session/xyz' }))
    const out = await payment.openPortal()
    expect(out).toEqual({ url: 'https://billing.stripe.com/session/xyz' })
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer tok-member-session')
    expect(JSON.parse(init.body)).toEqual({ action: 'portal' })
  })

  it('surfaces the machine-readable error code (PRICE_UNKNOWN / CHECKOUT_FAILED / PAYMENT_INCOMPLETE)', async () => {
    global.fetch.mockResolvedValue(res(400, { error: "That plan isn't available yet.", code: 'PRICE_UNKNOWN' }))
    await expect(payment.createCheckout('bogus')).rejects.toMatchObject({ message: "That plan isn't available yet.", code: 'PRICE_UNKNOWN' })

    global.fetch.mockResolvedValue(res(502, { error: 'Could not start checkout. Try again shortly.', code: 'CHECKOUT_FAILED' }))
    await expect(payment.createCheckout('lifetime', { name: 'Ada', email: 'ada@example.com' })).rejects.toMatchObject({ code: 'CHECKOUT_FAILED' })

    global.fetch.mockResolvedValue(res(409, { error: 'Payment is still being processed.', code: 'PAYMENT_INCOMPLETE' }))
    await expect(payment.getCheckoutStatus('cs_1')).rejects.toMatchObject({ code: 'PAYMENT_INCOMPLETE' })
  })

  it('falls back to a generic message for a code-less error', async () => {
    global.fetch.mockResolvedValue(res(500, { error: 'Internal error' }))
    await expect(payment.openPortal()).rejects.toThrow('Internal error')
  })
})
