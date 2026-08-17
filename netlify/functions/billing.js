// Stripe webhook (ADR-0003 §2, S3). Stripe-only, NO Bearer auth — the request
// is authenticated by the `Stripe-Signature` header over the RAW body
// (HMAC-SHA256 with STRIPE_WEBHOOK_SECRET, constant-time compare — see
// _shared/stripe.js). The raw body is read first (`req.text()`) and verified
// BEFORE any JSON parsing, so a forged payload is rejected with 400 before it
// is ever interpreted.
//
// Events handled (all idempotent):
//   - checkout.session.completed        — create user:<id> + issue RU- code for
//                                         a prospect, or upgrade an existing
//                                         member. Replayed events are no-ops
//                                         (keyed on stripeCheckoutSessionId).
//   - customer.subscription.updated     — sync planExpiresAt / plan.
//   - customer.subscription.deleted     — downgrade to free (items kept; the
//                                         cap only blocks new adds).
//   - invoice.payment_failed            — keep entitlements until period end,
//                                         record the failure server-side.
//
// The generated access code is NEVER echoed by this function (it returns only
// `{ received: true }`); the session owner retrieves it once via the
// payment.js `status` poll. STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET never
// leave the server.

import { randomUUID } from 'node:crypto'
import { verifyWebhookSignature } from './_shared/stripe'
import {
  findUserByEmail,
  findUserByStripeSession,
  findUserByStripeSubscription,
  getRequest,
  saveRequest,
  saveUser,
} from './_shared/users'
import { applyEntitlement, materializeCheckoutSession } from './_shared/entitlements'
import { generateAccessCode } from './_shared/auth'
import { json, securityHeaders } from './_shared/security'

// Webhook JSON responder with the security headers applied (SEC-3.4, #197).
const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json', ...securityHeaders() },
})

// The same dependency set the payment.js reconcile path uses — both build the
// shared materializer from the same repository facade so they can never drift
// (ADR-0003 §2.2).
const materializeDeps = {
  saveUser,
  saveRequest,
  findUserByEmail,
  getRequest,
  generateAccessCode,
  randomUUID,
}

// checkout.session.completed — idempotent by stripeCheckoutSessionId. A replay
// (Stripe redelivery) resolves the already-materialized user via the O(1)
// `stripe:session:<id>` index and is a no-op. The shared materializer also
// flips the pending request to approved.
async function handleCheckoutCompleted(session) {
  const sessionId = String(session?.id || '')
  if (!sessionId) return // nothing to key on — ignore
  const existing = await findUserByStripeSession(sessionId)
  if (existing) return // replayed event — already materialized
  await materializeCheckoutSession(session, materializeDeps)
}

// customer.subscription.created/updated/deleted — idempotent by
// stripeSubscriptionId. Syncs plan / planExpiresAt (updated) or downgrades to
// free (deleted). A subscription we have no member for (e.g. created by a
// manual Stripe action) is a no-op.
async function handleSubscriptionEvent(event) {
  const subscription = event?.data?.object || event?.object
  const subscriptionId = String(subscription?.id || '')
  if (!subscriptionId) return
  const user = await findUserByStripeSubscription(subscriptionId)
  if (!user) return
  await saveUser(applyEntitlement(user, event))
}

// invoice.payment_failed — keep entitlements until period end (ADR-0003 §2.3;
// applyEntitlement returns the user unchanged). Record the failure server-side
// only — never the access code, never a Stripe secret.
async function handlePaymentFailed(event) {
  const invoice = event?.data?.object || event?.object
  const subscriptionId = String(invoice?.subscription || '')
  console.log(`[billing] invoice.payment_failed subscription=${subscriptionId}`)
  // No user mutation: entitlements persist until the current period end, and
  // the member can retry from the Billing Portal.
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // Read + verify the RAW body before touching JSON (never req.json() first).
  // SEC-3.2 (#195): cap the raw webhook body so a malicious oversized payload
  // can't buffer unbounded bytes before the signature check rejects it.
  const rawBody = await req.text().catch(() => '')
  if (Buffer.byteLength(rawBody, 'utf8') > 1 * 1024 * 1024) {
    return json(413, { error: 'Webhook payload too large.', code: 'PAYLOAD_TOO_LARGE' })
  }
  const signature = req.headers.get('stripe-signature') || ''
  if (!verifyWebhookSignature({ rawBody, signature })) {
    return json(400, { error: 'Invalid signature.' })
  }

  let event
  try {
    event = JSON.parse(rawBody)
  } catch {
    return json(400, { error: 'Invalid event payload.' })
  }

  try {
    const type = event?.type
    const object = event?.data?.object
    if (type === 'checkout.session.completed') {
      await handleCheckoutCompleted(object)
    } else if (
      type === 'customer.subscription.created'
      || type === 'customer.subscription.updated'
      || type === 'customer.subscription.deleted'
    ) {
      await handleSubscriptionEvent(event)
    } else if (type === 'invoice.payment_failed') {
      await handlePaymentFailed(event)
    }
    // Any other event type is acked (Stripe treats 2xx as delivered).
    return json(200, { received: true })
  } catch (err) {
    // Transient failure (DB / Blobs mirror) — return 500 so Stripe retries.
    // The webhook is idempotent (keyed on the billing ids + unique indexes),
    // so a retry converges. Never log the code or any secret.
    console.error('[billing] webhook processing failed:', err?.message || err)
    return json(500, { error: 'Processing failed' })
  }
}
