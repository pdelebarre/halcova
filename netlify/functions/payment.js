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
//   - The generated access code is returned EXACTLY ONCE, over HTTPS, to the
//     session owner via the first `status` poll (they hold the sessionId — a
//     capability token). The webhook never echoes it; publicUser strips
//     billing ids. A signed-in member never sees a code via `status` (M2).
//   - owner / demo identities can never create checkout sessions (403).
//   - `checkout` and `status` are rate-limited (M1): both are pre-auth or
//     unauthenticated surfaces, so a flood can't create unlimited pending
//     requests or fire unbounded Stripe API calls (cost/quota).
//   - STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET never leave the server.

import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import {
  bearer,
  generateAccessCode,
  publicUser,
} from './_shared/auth'
import { resolveSession } from './_shared/session-auth'
import { createSession } from './_shared/sessions'
import {
  findPendingRequestByEmail,
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
import { clientIp, rateLimitGuard } from './_shared/rate-limit'
import { anomalyScope } from './_shared/anomaly'
import { materializeCheckoutSession } from './_shared/entitlements'
import { json, readJsonBody, safeError } from './_shared/security'
import { emailHash, logAudit } from './_shared/audit'

const RATE_LIMITS_STORE = 'runout-rate-limits'
// M1 (S8, #54): `checkout` is pre-auth (a prospect checks out with just an
// email) and `status` is unauthenticated (anyone with the sessionId polls it).
// Per-IP bounds a flood from one source; per-email bounds one inbox being
// spammed with pending requests + Stripe Checkout sessions (cost/quota).
// Mirrors the auth.js fixed-window pattern (same Blob store, `RATE_LIMIT` code).
const CHECKOUT_IP_LIMIT = Number(process.env.RUNOUT_PAYMENT_CHECKOUT_IP_RATE_LIMIT) || 20
const CHECKOUT_EMAIL_LIMIT = Number(process.env.RUNOUT_PAYMENT_CHECKOUT_RATE_LIMIT) || 5
const STATUS_IP_LIMIT = Number(process.env.RUNOUT_PAYMENT_STATUS_IP_RATE_LIMIT) || 60

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
//
// m2 (S8, #54): production must be EXPLICITLY configured — never trust the
// request Host/Origin headers there (host-header injection could point the
// post-checkout / portal return URL at an attacker's origin). Fail closed with
// a 503 instead; the header fallback is dev/test-only.
function siteUrl(req) {
  const configured = process.env.STRIPE_SITE_URL || process.env.RUNOUT_SITE_URL
  if (configured) return configured.trimEnd('/')
  if (process.env.NODE_ENV === 'production') {
    throw httpError(503, { error: "Payments aren't configured for this site yet.", code: 'CHECKOUT_FAILED' })
  }
  const origin = req?.headers?.get('origin')
  if (origin) return origin
  const host = req?.headers?.get('host')
  if (host) return `https://${host}`
  return 'http://localhost:8888'
}

// Resolve the caller's identity for checkout/portal:
//   - a Bearer session token → an existing member ({ kind: 'member', user }),
//   - no Bearer → a pre-auth prospect from { name, email } ({ kind, name, email }).
// The owner and the demo identity are rejected with 403 — they must never be
// able to start a checkout (the owner already has every plan; the demo space
// is read-only). Returns an object or throws an httpError.
async function resolveIdentity(req, body) {
  const token = bearer(req)
  if (token) {
    // SEC-EPIC-1 (#176): the Bearer is a session token now, not an access code.
    const resolved = await resolveSession(req)
    if (resolved.error) {
      throw httpError(401, { error: 'Sign in to check out.', code: 'SESSION_INVALID' })
    }
    const user = resolved.user
    if (user.role === 'admin') {
      throw httpError(403, { error: "The owner already has every plan.", code: 'PAYMENT_REQUIRED' })
    }
    if (user.role === 'demo') {
      throw httpError(403, { error: "The demo space is read-only and can't be upgraded.", code: 'PAYMENT_REQUIRED' })
    }
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
  // M1: `checkout` is pre-auth (a prospect checks out with email alone) — rate
  // limit before any identity/Stripe work. Per-IP bounds a flood from one
  // source; per-email bounds one inbox being spammed into unbounded pending
  // requests + Checkout sessions (Stripe cost/quota). SEC-7.4.x (#383): routed
  // through rateLimitGuard; per-IP limiter gets an anonymous burstScope.
  const ip = clientIp(req)
  if (ip) {
    const byIp = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'payment:checkout:ip',
      limit: CHECKOUT_IP_LIMIT,
      identity: ip,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope: anomalyScope('rlx:payment:checkout:ip', ip),
    })
    if (byIp) return byIp
  }

  const identity = await resolveIdentity(req, body)
  const email = identity.kind === 'member' ? cleanEmail(identity.user.email) : cleanEmail(identity.email)
  if (email) {
    const byEmail = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'payment:checkout:email',
      limit: CHECKOUT_EMAIL_LIMIT,
      identity: email,
      anomalyStore: getStore(RATE_LIMITS_STORE),
    })
    if (byEmail) return byEmail
  }

  const plan = String(body.plan || '').trim()
  if (plan !== 'premium' && plan !== 'lifetime') {
    return json(400, { error: "Choose a plan to buy (premium or lifetime).", code: 'PRICE_UNKNOWN' })
  }
  const priceId = priceIdForPlan(plan)
  if (!priceId) {
    return json(400, { error: "That plan isn't available yet.", code: 'PRICE_UNKNOWN' })
  }

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

  logAudit('payment.checkout_created', { kind: identity.kind, emailHash: emailHash(email), plan })
  return json(200, { url: session.url, sessionId: session.id })
}

async function handleStatus(body, req) {
  const sessionId = String(body.sessionId || '').trim()
  if (!sessionId) return json(400, { error: 'Missing sessionId.' })

  // M1: `status` is unauthenticated (anyone who ever sees `?session_id=…` can
  // poll it) — per-IP limit so one source can't hammer Stripe retrieve calls
  // (cost/quota) and can't brute-force a session id. SEC-7.4.x (#383): routed
  // through rateLimitGuard; per-IP limiter gets an anonymous burstScope.
  const ip = clientIp(req)
  if (ip) {
    const byIp = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'payment:status:ip',
      limit: STATUS_IP_LIMIT,
      identity: ip,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope: anomalyScope('rlx:payment:status:ip', ip),
    })
    if (byIp) return byIp
  }

  // M2 (SEC-EPIC-1, #176): a signed-in member ALREADY holds a session —
  // `status` must never hand their code back out over the wire. If a Bearer
  // session token is present, require it to be valid (401/403 on an unknown /
  // disabled account, 403 for the owner/demo who have no code to collect) and
  // suppress the code from the response entirely.
  const sessionToken = bearer(req)
  let member = null
  if (sessionToken) {
    const resolved = await resolveSession(req)
    if (resolved.error) {
      throw httpError(401, { error: 'Sign in to check out.', code: 'SESSION_INVALID' })
    }
    if (resolved.user.role === 'admin' || resolved.user.role === 'demo') {
      throw httpError(403, { error: "This account doesn't collect a checkout code.", code: 'PAYMENT_REQUIRED' })
    }
    member = resolved.user
  }

  // SEC-6.2 (#216): bind a signed-in caller to the checkout session. A member
  // may only poll a `status` for a session that belongs to them (matched by
  // normalized email) — otherwise 403, so user A can't read user B's checkout
  // status/code by guessing a sessionId.
  const assertOwnership = (targetEmail) => {
    const memberEmail = cleanEmail(member?.email)
    const target = cleanEmail(targetEmail)
    if (member && memberEmail && target && memberEmail !== target) {
      throw httpError(403, { error: "That checkout doesn't belong to you.", code: 'SESSION_MISMATCH' })
    }
  }

  // Deliver the completion response. The access code goes out ONLY to a
  // non-member caller (a brand-new prospect who just paid) and ONLY on the
  // first successful poll (`codeDelivered`) WITHIN the code-delivery window
  // (SEC-6.2, #216), so a leaked sessionId is a bounded one-time capability,
  // not a permanent backdoor to the member's code. Both the webhook fast-path
  // and the reconcile path funnel through here so the once-delivery guarantee
  // can never drift.
  const respondComplete = async (user, code) => {
    const notYetDelivered = user.codeDelivered !== true
    const withinWindow = !user.codeDeliverableUntil || Date.now() < new Date(user.codeDeliverableUntil).getTime()
    let deliverCode = null
    if (!member && notYetDelivered && withinWindow) {
      deliverCode = code || await plaintextCodeFor(user.id)
    }
    if (deliverCode) {
      // Persist the delivery marker so the NEXT poll (or anyone with the URL)
      // can never read the code again.
      await saveUser({ ...user, codeDelivered: true, codeDeliveredAt: new Date().toISOString() })
    }
    // SEC-EPIC-1 (#176/#177): a brand-new prospect is signed STRAIGHT IN with a
    // fresh session token — the code is still handed over exactly once (so they
    // can sign in on another device) but it is never persisted client-side.
    let session = null
    if (!member) {
      const created = await createSession({ userId: user.id, role: user.role || 'member' })
      session = created.token
    }
    logAudit('payment.status', {
      status: 'complete',
      userId: user.id,
      member: !!member,
      codeDelivered: !!deliverCode,
    })
    return json(200, {
      status: 'complete',
      user: publicUser(user),
      ...(session ? { session } : {}),
      ...(deliverCode ? { code: deliverCode } : {}),
    })
  }

  // Fast path: the webhook already landed and materialized the entitlement.
  const materialized = await findUserByStripeSession(sessionId)
  if (materialized) {
    assertOwnership(materialized.email)
    return respondComplete(materialized, null)
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

  // SEC-6.2 (#216): bind the signed-in caller to the Stripe session's email
  // before materializing, so user A can't materialize/read user B's checkout.
  assertOwnership(session.customer_email)

  try {
    const { user, code } = await materializeCheckoutSession(session, materializeDeps)
    return respondComplete(user, code)
  } catch {
    // A concurrent webhook delivery may have materialized in the meantime —
    // re-check before surfacing a failure (idempotent either way).
    const again = await findUserByStripeSession(sessionId)
    if (again) return respondComplete(again, null)
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
    logAudit('payment.portal_opened', { userId: user.id })
    return json(200, { url: portal.url })
  } catch {
    return json(502, { error: 'Could not open the billing portal.', code: 'CHECKOUT_FAILED' })
  }
}

export default async (req) => {
  try {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    // SEC-3.2 (#195): cap the JSON body before parsing.
    const { value: body, error } = await readJsonBody(req)
    if (error) return error
    // Handlers may throw an httpError (e.g. resolveIdentity's 401/403) — they
    // are AWAITED so the try/catch below formats them instead of letting the
    // rejection escape the function.
    if (body.action === 'checkout') return await handleCheckout(body, req)
    if (body.action === 'status') return await handleStatus(body, req)
    if (body.action === 'portal') return await handlePortal(body, req)
    return json(400, { error: 'Unknown action.' })
  } catch (err) {
    // A thrown helper error carries its own safe { error, code } body.
    if (err?.httpStatus) return json(err.httpStatus, err.body)
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
