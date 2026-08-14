// Entitlement resolution (ADR-0003 §2.3, S2). Lending is DERIVED from the plan:
// any paid plan includes it, and the owner/admin role is always entitled — while
// the admin keeps a manual per-account override via `features.lending`.
//
// Games stays EXACTLY as the merged games-entitlement work defined it: an
// admin-granted per-account flag (`user.features.games`), NOT derived from the
// plan. This module deliberately does not rebuild the raw `features` map, so
// that integration is untouched — `effectiveFeatures` only resolves `lending`
// today. The client still reads the raw flag at session.user.features.games.
//
// `paid` = any of the uncapped plans: 'premium' (subscription), 'lifetime'
// (one-time), 'unlimited' (grandfathered private-test value).

export const PAID_PLANS = ['premium', 'lifetime', 'unlimited']

export function isPaidPlan(user) {
  return !!user && PAID_PLANS.includes(user.plan)
}

// ---- S3: payment entitlement materialization (ADR-0003 §2.3) ---------------

import { randomUUID } from 'node:crypto'

// Map a Stripe price id to the plan it purchases. The mapping is server-side
// via env (STRIPE_PRICE_PREMIUM / STRIPE_PRICE_LIFETIME) — the client never
// sends a price. Unknown prices return null (the webhook then leaves the
// user's plan untouched).
export function planForPrice(priceId) {
  if (!priceId) return null
  if (process.env.STRIPE_PRICE_PREMIUM && priceId === process.env.STRIPE_PRICE_PREMIUM) return 'premium'
  if (process.env.STRIPE_PRICE_LIFETIME && priceId === process.env.STRIPE_PRICE_LIFETIME) return 'lifetime'
  return null
}

// Stripe event types we materialize (ADR-0003 §2.2/§2.3).
const CHECKOUT_COMPLETED = 'checkout.session.completed'
const SUBSCRIPTION_CREATED = 'customer.subscription.created'
const SUBSCRIPTION_SYNC = 'customer.subscription.updated'
const SUBSCRIPTION_DELETED = 'customer.subscription.deleted'
const PAYMENT_FAILED = 'invoice.payment_failed'

// Stripe timestamps are epoch SECONDS; the user shape stores ISO strings.
const toIso = (epochSeconds) => (
  epochSeconds ? new Date(Number(epochSeconds) * 1000).toISOString() : undefined
)

// Idempotently apply a Stripe event to a user and return the UPDATED user
// object (never mutates the input). Sets `plan`, `planExpiresAt`,
// `planChangedAt`, `stripeCustomerId`, `stripeSubscriptionId`,
// `stripeCheckoutSessionId` from the event. Lending comes along automatically
// for premium/lifetime via `effectiveFeatures` (derived from the plan — this
// module never bakes a lending flag into `features`, so a
// `customer.subscription.deleted` downgrade to `free` correctly drops it).
//
// `event` is either a webhook event ({ type, data: { object } }) or a
// normalized shape ({ type, object }) — the status-poll reconcile path in
// payment.js builds the latter from `sessions.retrieve`. Idempotent by
// construction: replaying the same event produces the same fields.
export function applyEntitlement(user, event) {
  if (!user) return null
  const type = event?.type
  const object = event?.data?.object || event?.object
  if (!type || !object) return { ...user }
  const now = new Date().toISOString()

  switch (type) {
    case CHECKOUT_COMPLETED: {
      // Async payment methods can land a completed session while still unpaid —
      // do not materialize until the money clears.
      if (object.payment_status && !['paid', 'no_payment_required'].includes(object.payment_status)) {
        return { ...user }
      }
      const next = {
        ...user,
        plan: object.mode === 'subscription' ? 'premium' : 'lifetime',
        planChangedAt: now,
        stripeCustomerId: object.customer || user.stripeCustomerId || null,
        stripeCheckoutSessionId: object.id || user.stripeCheckoutSessionId || null,
        stripeSubscriptionId: object.subscription || user.stripeSubscriptionId || null,
      }
      // For a subscription the period end rides on the subscription object; the
      // webhook / reconcile paths attach it to the session shape, otherwise it
      // arrives via customer.subscription.updated shortly after.
      const periodEnd = toIso(object.current_period_end)
      if (periodEnd) next.planExpiresAt = periodEnd
      return next
    }
    case SUBSCRIPTION_CREATED:
    case SUBSCRIPTION_SYNC: {
      const priceId = object.items?.data?.[0]?.price?.id
      return {
        ...user,
        plan: planForPrice(priceId) || user.plan,
        planChangedAt: now,
        stripeCustomerId: object.customer || user.stripeCustomerId || null,
        stripeSubscriptionId: object.id || user.stripeSubscriptionId || null,
        planExpiresAt: toIso(object.current_period_end) || user.planExpiresAt || null,
      }
    }
    case SUBSCRIPTION_DELETED: {
      // Downgrade to free. Items and billing ids are kept — the cap only blocks
      // NEW adds (collection.js), existing items stay browsable.
      return {
        ...user,
        plan: 'free',
        planChangedAt: now,
        planExpiresAt: null,
        stripeCustomerId: object.customer || user.stripeCustomerId || null,
        stripeSubscriptionId: object.id || user.stripeSubscriptionId || null,
      }
    }
    case PAYMENT_FAILED:
      // Keep entitlements until period end (ADR-0003 §2.3). No user mutation —
      // billing.js records the failure in the server log.
      return { ...user }
    default:
      return { ...user }
  }
}

// Shared, dependency-injected materializer for a COMPLETED Checkout Session —
// used by BOTH the billing.js webhook and the payment.js status-poll reconcile
// path so the two can never drift (ADR-0003 §2.2: "both the webhook and the
// reconcile path are idempotent"). Idempotent by construction: re-materializing
// the same session returns the same user (an already-entitled member is just
// re-saved with the same fields; the request is only flipped to `approved`
// when it is still pending).
//
// deps: { saveUser, saveRequest, findUserByEmail, getRequest, generateAccessCode, randomUUID }
// Returns { user, code } where `code` is the freshly-issued access code for a
// BRAND-NEW prospect, or null for an existing member (they keep their code).
export async function materializeCheckoutSession(session, deps = {}) {
  const {
    saveUser, saveRequest, findUserByEmail, getRequest,
    generateAccessCode, randomUUID: genId = randomUUID,
  } = deps

  const requestId = String(session.client_reference_id || '').replace(/^request:/, '')
  const request = requestId ? await getRequest(requestId) : null
  const email = String(session.customer_email || request?.email || '').trim().toLowerCase()
  if (!email) throw new Error('Checkout session has no email to attribute.')

  let user = await findUserByEmail(email)
  const isNew = !user
  let code = null
  if (isNew) {
    code = generateAccessCode()
    user = {
      id: genId(),
      name: (request?.name || String(email).split('@')[0] || 'Member').slice(0, 80),
      email,
      collections: { records: true, books: true },
      features: {},
      plan: 'free',
      code,
      role: 'member',
      status: 'active',
      createdAt: new Date().toISOString(),
    }
  } else {
    // Existing member keeps their code, collections and feature flags.
    user = { ...user }
  }

  const applied = applyEntitlement(user, { type: 'checkout.session.completed', data: { object: session } })
  await saveUser(applied)

  if (request && request.status !== 'approved') {
    await saveRequest({ ...request, status: 'approved', approvedAt: new Date().toISOString() })
  }

  return { user: applied, code: isNew ? code : null }
}

// The effective per-account capability set (currently just `lending`):
//   lending = features.lending            (admin's manual per-account override)
//           || plan ∈ {premium,lifetime,unlimited}   (any paid plan)
//           || role === 'admin'           (owner/owner-style identities)
// Defensive for null/unknown users (returns { lending: false }).
export function effectiveFeatures(user) {
  const paid = isPaidPlan(user)
  const lending = !!(user?.features?.lending || paid || user?.role === 'admin')
  return { lending }
}
