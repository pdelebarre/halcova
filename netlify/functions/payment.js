// Payment API (ADR-0003 §2, S3): client-facing self-serve checkout.
//
//   POST { action: 'checkout', plan, name?, email? } -> { url, sessionId }
//   POST { action: 'status', sessionId }             -> { status, user?, code? }
//   POST { action: 'portal' }                        -> { url }
//
// There is NO admin in the loop. A visitor either signs in with an access code
// (an existing member upgrading) or checks out pre-auth with just an email (a
// brand-new prospect). The plan maps to a SERVER-SIDE price id via env
// (STRIPE_PRICE_PREMIUM / STRIPE_PRICE_LIFETIME) — the client never sends an
// amount. The pending `request:<id>` record (reused from the S1 magic-link
// flow, deduped by email) is the stable identity the billing.js webhook
// attaches the entitlement to.
//
// The provider boundary is _shared/stripe.js — this function only sees the
// REST helpers, so a future Paddle swap is a different implementation behind
// the same surface (ADR-0003 §4.3).
//
// Security rules (non-negotiable):
//   - The generated access code is returned ONCE, over HTTPS, to the session
//     owner via the `status` poll (they hold the sessionId — a capability
//     token). The webhook never echoes it; publicUser strips billing ids.
//   - owner / demo identities can never create checkout sessions (403).
//   - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET never leave the server.

import { randomUUID } from 'node:crypto'
import {
  ADMIN_KEY,
  bearer,
  generateAccessCode,
  isDemoCode,
  publicUser,
} from './_shared/auth'
import {
  findPendingRequestByEmail,
  findUserByCode,
  findUserByEmail,
  findUserByStripeSession,
  getRequest,
  plaintextCodeFor,
  saveRequest,
  saveUser,
} from './_shared/users'
import {
  createCheckoutSession,
  createPortalSession,
  priceIdForPlan,
  retrieveSession,
} from './_shared/stripe'
import { materializeCheckoutSession } from './_shared/entitlements'

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json' },
})

// A thrown helper error carrying its own HTTP status + `{ error, code }` body —
// caught once in the default export and formatted there.
function httpError(status, body) {
  const err = new Error(body?.error || `HTTP ${status}`)
  err.httpStatus = status
  err.body = body
  return err
}

// A light shape check before we send a prospect to Stripe — enough to reject
// obvious garbage without a backtracking-prone regex (same as auth.js).
function looksLikeEmail(email) {
  const value = String(email || '')
  if (value.length < 5 || value.includes(' ')) return false
  const at = value.indexOf('@')
  if (at <= 0 || at === value.length - 1) return false
  const domain = value.slice(at + 1)
  return domain.includes('.') && domain.length >= 3
}

function cleanEmail(email) {
  return String(email || '').trim().slice(0, 120).toLowerCase()
}

function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || ''
  return local.trim().slice(0, 80) || 'Member'
}

// Where the post-checkout redirect should land. STRIPE_SITE_URL is the S3 env
// for success/cancel + portal return URLs (falls back to RUNOUT_SITE_URL, then
// the request origin so `netlify dev` works with no env).
function siteUrl(req) {
  const configured = process.env.STRIPE_SITE_URL || process.env.RUNOUT_SITE_URL
  if (configured) return configured.trimEnd('/')
  const origin = req?.headers?.get('origin')
  if (origin) return origin
  const host = req?.headers?.get('host')
  if (host) return `https://${host}`
  return 'http://localhost:8888'
}

// Resolve the caller's identity for checkout/portal:
//   - a Bearer access code → an existing member ({ kind: 'member', user }),
//   - no Bearer → a pre-auth prospect from { name, email } ({ kind, name, email }).
// The owner and the demo identity are rejected with 403 — they must never be
// able to start a checkout (the owner already has every plan; the demo space
// is read-only). Returns an object or throws an httpError.
async function resolveIdentity(req, body) {
  const code = bearer(req)
  if (code) {
    if (code === ADMIN_KEY) {
      throw httpError(403, { error: "The owner already has every plan.", code: 'PAYMENT_REQUIRED' })
    }
    if (isDemoCode(code)) {
      throw httpError(403, { error: "The demo space is read-only and can't be upgraded.", code: 'PAYMENT_REQUIRED' })
    }
    const user = await findUserByCode(code)
    if (!user) throw httpError(401, { error: "That access code isn't recognized." })
    if (user.status !== 'active') throw httpError(403, { error: 'This account is disabled.' })
    return { kind: 'member', user }
  }
  const name = String(body.name || '').trim().slice(0, 80)
  const email = cleanEmail(body.email)
  if (!email || !looksLikeEmail(email)) {
    throw httpError(400, { error: 'Add a valid email to check out.' })
  }
  return { kind: 'prospect', name: name || nameFromEmail(email), email }
}

// The dependency set for the shared materializer — the webhook and the status-
// poll reconcile path must never drift (ADR-0003 §2.2), so both build the same
// object from the same repository facade.
const materializeDeps = {
  saveUser,
  saveRequest,
  findUserByEmail,
  getRequest,
  generateAccessCode,
  randomUUID,
}

async function handleCheckout(body, req) {
  const identity = await resolveIdentity(req, body)
  const plan = String(body.plan || '').trim()
  if (plan !== 'premium' && plan !== 'lifetime') {
    return json(400, { error: "Choose a plan to buy (premium or lifetime).", code: 'PRICE_UNKNOWN' })
  }
  const priceId = priceIdForPlan(plan)
  if (!priceId) {
    return json(400, { error: "That plan isn't available yet.", code: 'PRICE_UNKNOWN' })
  }

  const email = identity.kind === 'member' ? cleanEmail(identity.user.email) : identity.email
  if (!email) throw httpError(400, { error: 'Your account has no email on file — sign in again.' })

  // Get-or-create the pending `request:<id>` (deduped by email, S1 helpers) —
  // the stable identity the webhook attaches the entitlement to (ADR-0003
  // §2.2). For a member this is usually null (their request was approved at
  // signup), so a fresh request is created and flipped to approved when the
  // webhook lands — a useful audit trace of the upgrade.
  let request = await findPendingRequestByEmail(email)
  if (!request) {
    request = {
      id: randomUUID(),
      name: identity.kind === 'member' ? (identity.user.name || nameFromEmail(email)) : identity.name,
      email,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    await saveRequest(request)
  }

  const base = siteUrl(req)
  let session
  try {
    session = await createCheckoutSession({
      plan,
      priceId,
      requestId: `request:${request.id}`,
      email,
      kind: identity.kind, // 'prospect' | 'member' (metadata, dashboard-only)
      successUrl: `${base}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${base}/?checkout=cancelled`,
    })
  } catch {
    // Stripe is down / not configured — never leak the secret, just surface a
    // stable machine-readable code the client can branch on.
    return json(502, { error: 'Could not start checkout. Try again shortly.', code: 'CHECKOUT_FAILED' })
  }

  return json(200, { url: session.url, sessionId: session.id })
}

async function handleStatus(body) {
  const sessionId = String(body.sessionId || '').trim()
  if (!sessionId) return json(400, { error: 'Missing sessionId.' })

  // Fast path: the webhook already landed and materialized the entitlement.
  const materialized = await findUserByStripeSession(sessionId)
  if (materialized) {
    const code = await plaintextCodeFor(materialized.id)
    return json(200, { status: 'complete', user: publicUser(materialized), code })
  }

  // Reconcile path (self-healing for webhook lag / missed delivery): retrieve
  // the session from Stripe and materialize idempotently.
  let session
  try {
    session = await retrieveSession(sessionId)
  } catch (err) {
    // A Stripe 404 means the id was never a real session — client error; any
    // other failure is a transient Stripe problem — 502.
    if (err?.code === 'STRIPE_API_ERROR' && err?.status === 404) {
      return json(400, { error: 'That checkout session is unknown.', code: 'PAYMENT_INCOMPLETE' })
    }
    return json(502, { error: 'Could not check payment status.', code: 'CHECKOUT_FAILED' })
  }

  const paid = session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required'
  if (!paid) {
    // Checkout finished but the money hasn't cleared (async methods like SEPA):
    // 409 tells the client the payment is genuinely incomplete, not just
    // pending. An open/expired session is plain pending.
    if (session?.status === 'complete') {
      return json(409, { error: 'Payment is still being processed.', code: 'PAYMENT_INCOMPLETE' })
    }
    return json(200, { status: 'pending' })
  }

  try {
    const { user, code } = await materializeCheckoutSession(session, materializeDeps)
    return json(200, { status: 'complete', user: publicUser(user), code })
  } catch {
    // A concurrent webhook delivery may have materialized in the meantime —
    // re-check before surfacing a failure (idempotent either way).
    const again = await findUserByStripeSession(sessionId)
    if (again) {
      const code = await plaintextCodeFor(again.id)
      return json(200, { status: 'complete', user: publicUser(again), code })
    }
    return json(500, { error: 'Could not finalize your payment.' })
  }
}

async function handlePortal(body, req) {
  const identity = await resolveIdentity(req, body)
  if (identity.kind !== 'member') throw httpError(401, { error: 'Sign in to manage billing.' })
  const { user } = identity
  if (!user.stripeCustomerId) {
    return json(409, { error: 'No billing account yet — purchase a plan first.', code: 'PAYMENT_INCOMPLETE' })
  }

  try {
    const portal = await createPortalSession({
      customerId: user.stripeCustomerId,
      returnUrl: `${siteUrl(req)}/?settings=plan`,
    })
    return json(200, { url: portal.url })
  } catch {
    return json(502, { error: 'Could not open the billing portal.', code: 'CHECKOUT_FAILED' })
  }
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    const body = await req.json().catch(() => ({}))
    // Handlers may throw an httpError (e.g. resolveIdentity's 401/403) — they
    // are AWAITED so the try/catch below formats them instead of letting the
    // rejection escape the function.
    if (body.action === 'checkout') return await handleCheckout(body, req)
    if (body.action === 'status') return await handleStatus(body)
    if (body.action === 'portal') return await handlePortal(body, req)
    return json(400, { error: 'Unknown action.' })
  } catch (err) {
    if (err?.httpStatus) return json(err.httpStatus, err.body)
    return json(500, { error: err.message || 'Internal error' })
  }
}
