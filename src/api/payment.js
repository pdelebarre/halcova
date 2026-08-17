// Client for the payment Netlify function (ADR-0003 §2, S3). Mirrors
// src/api/collection.js's `handle()` error-code pattern: every non-2xx
// response throws an Error carrying the server's message AND its
// machine-readable `code` (CHECKOUT_FAILED | PAYMENT_INCOMPLETE |
// PRICE_UNKNOWN | PAYMENT_REQUIRED | RATE_LIMIT) so callers can branch on the
// failure instead of string-matching.
//
// Only the S3 payment client lives here — the paywall UI that uses it is S6.

import { getSessionToken, saveSession } from '../utils/session'

const FN_BASE = '/.netlify/functions/payment'

// Members send their session token as Bearer; a brand-new prospect checks out
// pre-auth (no session yet), so the header is omitted when there is none.
function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Mirror the lookup clients: surface the server's error message AND its
// machine-readable `code`. Code-less errors just carry the message.
async function handle(res) {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    let code
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
      if (body?.code) code = body.code
    } catch { /* ignore */ }
    const err = new Error(msg)
    if (code) err.code = code
    throw err
  }
  return res.json()
}

async function postJson(body) {
  const res = await fetch(FN_BASE, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

// Start a self-serve checkout for a plan ('premium' | 'lifetime' — the amount
// is decided server-side by the env price mapping, never the client).
// `opts` carries `{ name, email }` for a brand-new prospect who has no session
// yet; an existing member checks out with their Bearer code and no opts.
// Returns `{ url, sessionId }` — the caller redirects to `url`.
export async function createCheckout(plan, opts = {}) {
  const { name, email } = opts
  return postJson({ action: 'checkout', plan, ...(name ? { name } : {}), ...(email ? { email } : {}) })
}

// Poll a checkout session after the Stripe redirect. Returns:
//   { status: 'pending' }               — keep polling,
//   { status: 'complete', user, session?, code? } — paid; `session` is a fresh
//     session token for a brand-new prospect (persisted — mirrors
//     login/verifyMagicLink), and `code` is the freshly-issued RU- code
//     returned exactly once so they can sign in on another device. The code is
//     NEVER persisted (SEC-EPIC-1, #177) — localStorage.runout.session holds
//     only `{ user, session }`. An existing member keeps their session, so
//     their stored session is left untouched (they can refresh via me()).
export async function getCheckoutStatus(sessionId) {
  const data = await postJson({ action: 'status', sessionId })
  if (data.status === 'complete' && data.session) {
    saveSession({ user: data.user, session: data.session })
  }
  return data
}

// Open the Stripe Billing Portal for the signed-in member. Returns `{ url }`.
export async function openPortal() {
  return postJson({ action: 'portal' })
}
