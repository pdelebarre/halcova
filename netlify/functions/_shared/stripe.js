// Server-only Stripe helpers (ADR-0003 §2, S3). Dependency-free: talks to the
// Stripe REST API with plain `fetch` (Basic auth with the secret key) and
// verifies webhook signatures itself with Node `crypto` (HMAC-SHA256 +
// timingSafeEqual — the same pattern as _shared/magic-link.js). The `stripe`
// npm SDK is deliberately NOT a dependency (the sandbox has no guaranteed
// network and the REST surface we use is tiny).
//
// This module is the whole provider boundary: `payment.js` / `billing.js` only
// ever see `createCheckoutSession` / `retrieveSession` / `retrieveSubscription`
// / `createPortalSession` / `verifyWebhookSignature`, so a future Paddle swap
// (ADR-0003 §4.3) is a different implementation behind the same surface.
//
// Security rules (non-negotiable):
//   - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET are read from env here,
//     server-only. They never reach the SPA, never appear in logs, and are
//     never part of any response.
//   - Webhook signatures are verified over the RAW body (never req.json() first)
//     with a constant-time compare and a replay-window tolerance.

import { createHmac, timingSafeEqual } from 'node:crypto'

const STRIPE_API = 'https://api.stripe.com/v1'
// Stripe recommends rejecting signatures older than ~5 minutes (replay guard).
export const SIGNATURE_TOLERANCE_SECONDS = 300

export function stripeSecretKey() {
  return process.env.STRIPE_SECRET_KEY || ''
}

export function stripeWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET || ''
}

// Map a plan to its SERVER-SIDE price id (ADR-0003 §2.4: the client never sends
// an amount). Returns undefined when the plan has no configured price.
export function priceIdForPlan(plan) {
  if (plan === 'premium') return process.env.STRIPE_PRICE_PREMIUM
  if (plan === 'lifetime') return process.env.STRIPE_PRICE_LIFETIME
  return undefined
}

// One form-encoded REST call to Stripe. `params` values that are undefined/null
// are dropped; keys may contain brackets (e.g. `metadata[kind]`) — URLSearchParams
// encodes them and Stripe decodes them back. GET params ride the query string;
// everything else is a form body. Throws { code: 'STRIPE_NOT_CONFIGURED' } when
// the secret key is absent and { code: 'STRIPE_API_ERROR', status } on a
// non-2xx response.
async function stripeFetch(path, { method = 'GET', params = {} } = {}) {
  const key = stripeSecretKey()
  if (!key) {
    const err = new Error('Stripe secret key not configured.')
    err.code = 'STRIPE_NOT_CONFIGURED'
    throw err
  }
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, v)
  }
  const query = method === 'GET' ? `?${body.toString()}` : ''
  const basicAuth = 'Basic ' + Buffer.from(`${key}:`).toString('base64')
  const res = await fetch(`${STRIPE_API}${path}${query}`, {
    method,
    headers: {
      Authorization: basicAuth,
      ...(method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(method !== 'GET' ? { body: body.toString() } : {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe API error (${res.status})`)
    err.code = 'STRIPE_API_ERROR'
    err.status = res.status
    throw err
  }
  return data
}

// Create a hosted Checkout Session. `client_reference_id` is the stable
// `request:<id>` identity the webhook attaches the entitlement to; `kind` is
// 'prospect' | 'member' (metadata — dashboard-informational only). `premium`
// maps to a subscription, `lifetime` to a one-time payment.
export async function createCheckoutSession({ plan, priceId, requestId, email, kind, successUrl, cancelUrl }) {
  const mode = plan === 'premium' ? 'subscription' : 'payment'
  const data = await stripeFetch('/checkout/sessions', {
    method: 'POST',
    params: {
      mode,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'client_reference_id': requestId,
      'customer_email': email || undefined,
      'metadata[kind]': kind || 'prospect',
      'success_url': successUrl,
      'cancel_url': cancelUrl,
      'allow_promotion_codes': 'true',
    },
  })
  return { id: data.id, url: data.url }
}

export async function retrieveSession(sessionId) {
  return stripeFetch(`/checkout/sessions/${sessionId}`)
}

export async function retrieveSubscription(subscriptionId) {
  return stripeFetch(`/subscriptions/${subscriptionId}`)
}

export async function createPortalSession({ customerId, returnUrl }) {
  const data = await stripeFetch('/billing_portal/sessions', {
    method: 'POST',
    params: { customer: customerId, return_url: returnUrl },
  })
  return { url: data.url }
}

// Verify a `Stripe-Signature` header over the RAW request body (HMAC-SHA256
// with STRIPE_WEBHOOK_SECRET, constant-time compare, replay-window tolerance).
// This is the ONLY thing that authenticates billing.js — never parse the JSON
// body before this passes. `now` / `toleranceSeconds` are injectable for tests.
export function verifyWebhookSignature({
  rawBody,
  signature,
  now = Date.now(),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
}) {
  const secret = stripeWebhookSecret()
  if (!secret || typeof signature !== 'string') return false

  // Stripe-Signature: t=<epoch-seconds>,v1=<hex>,v0=<hex>
  const parts = {}
  for (const pair of signature.split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    parts[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
  }
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false

  // Replay guard: reject signatures older than the tolerance window.
  const timestamp = Number(t)
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > toleranceSeconds) return false

  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest()
  let provided
  try {
    provided = Buffer.from(v1, 'hex')
  } catch {
    return false
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}
