// Lending function: lend / return actions against the collection blob stores.
//
// Reuses the W1-extracted helpers from _shared/collection-store.js
// (authorize, json, COLLECTIONS) and the per-user store mapping (storeNameFor
// in _shared/users.js). Lending state lives ON the item blob — no new store,
// no migration; the owner's legacy stores stay untouched:
//   item.lending        -> { borrower:{ name, contact? }, lentOn, dueOn? }  (current loan)
//   item.lendingHistory -> [{ borrower, lentOn, returnedOn, dueOn? }]       (bounded, max 10)
//
// Request (Authorization: Bearer <code>, JSON body):
//   lend   { action: 'lend',   collection, itemId, borrower: { name, contact? }, dueOn? }
//   return { action: 'return', collection, itemId }
// Success: 200 { item } — the updated item (with lending / lendingHistory).
// Errors follow the existing { error } model: 400 / 401 / 403 / 404 / 405 / 409 / 500.

import { getStore } from '@netlify/blobs'
import { COLLECTIONS, json } from './_shared/collection-store'
import { enforce, forbidden } from './_shared/policy'
import { filterFor } from './_shared/filter'
import { effectiveFeatures } from './_shared/entitlements'
import { storeNameFor } from './_shared/users'
import { readJsonBody, safeError } from './_shared/security'
import { createRateLimiter, rateLimitIdentity } from './_shared/rate-limit'

const FEATURE_OFF_MSG = "Lending isn't enabled for your account."
const HISTORY_CAP = 10

// SEC-7.4 (#341): per-user write limiter for lending actions (POST only — this
// function is POST-only). Bounds a runaway client / stuck loop from hammering
// the item blob stores. Members/owner keyed by user id; demo keyed by IP.
const RATE_LIMITS_STORE = 'runout-rate-limits'
const LENDING_RATE_LIMIT = Number(process.env.RUNOUT_LENDING_RATE_LIMIT) || 30

export default async function lending(req) {
  // SEC-7.1 (#338): route authorization through the shared policy layer. The
  // principal is always the resolved session user — a browser-supplied
  // owner/id is never trusted. Lending targets an item in the caller's OWN
  // store (lending:item:*) and denies the read-only demo identity.
  const pre = await enforce(req, 'collection:item:read')
  if (pre.error) return pre.error
  const user = pre.user

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // SEC-7.4 (#341): every lending write (lend/return) is per-identity
  // rate-limited. Lending mutates the caller's item blobs, so a runaway client
  // / stuck loop must not hammer it. Members/owner keyed by user id; the
  // shared demo identity is keyed by client IP (and demo is read-only anyway).
  // The limiter degrades open — a store failure never 500s the request.
  const identity = rateLimitIdentity(user, req)
  if (identity) {
    const limiter = createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'lending', limit: LENDING_RATE_LIMIT })
    const rl = await limiter(identity)
    if (rl.limited) {
      return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
    }
  }

  const body = await readBody(req)
  if (body.error) return body.error

  const invalid = validateAction(body)
  if (invalid) return invalid

  // Enforce the lending-specific policy (deny the demo identity — the shared
  // read action above is demo-open). The feature gate below is the plan +
  // capability check.
  const gated = await enforce(req, body.action === 'lend' ? 'lending:item:lend' : 'lending:item:return')
  if (gated.error) return gated.error

  const denied = featureGate(user, body.collection)
  if (denied) return denied

  const store = getStore(storeNameFor(user.id, body.collection))
  try {
    return body.action === 'lend'
      ? await handleLend(store, user, body.itemId, body)
      : await handleReturn(store, user, body.itemId)
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}

async function readBody(req) {
  // SEC-3.2 (#195): cap the JSON body before parsing (413 over the cap);
  // malformed JSON -> 400. readJsonBody returns { value } on success or
  // { error: <Response> } — the caller returns body.error early. A JSON `null`
  // body defaults to {} so validateAction rejects it with a 400.
  const parsed = await readJsonBody(req)
  if (parsed.error) return parsed
  return parsed.value ?? {}
}

// Borrower text mirrors cleanName in netlify/functions/auth.js — always stored
// trimmed and length-capped so a client can't bloat the item blob with junk.
function cleanName(name) {
  return String(name || '').trim().slice(0, 80)
}

function cleanContact(contact) {
  return String(contact || '').trim().slice(0, 240)
}

// dueOn is an optional ISO date string — either a bare 'YYYY-MM-DD' (from
// <input type="date">) or a full ISO timestamp. Anything that isn't a string
// in that shape is dropped rather than stored (see src/utils/lending.js).
function validDueOn(dueOn) {
  return typeof dueOn === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dueOn)
}

function validateAction(body) {
  const { action, collection, itemId } = body
  if (action !== 'lend' && action !== 'return') return json(400, { error: 'Unknown action.' })
  if (!collection) return json(400, { error: 'Missing collection.' })
  if (!COLLECTIONS[collection]) return json(400, { error: 'Unknown collection.' })
  if (!itemId) return json(400, { error: 'Missing itemId.' })
  if (action === 'lend') {
    // A borrower name must be a non-empty string — truthy junk (numbers,
    // objects) used to slip through the old truthiness check and get stored
    // raw on the item blob. Same contract message for missing and invalid.
    const name = body.borrower?.name
    if (typeof name !== 'string' || !name.trim()) return json(400, { error: 'Missing borrower name.' })
  }
  return null
}

// Plan + feature gate. Both 403 cases share the exact contract message and a
// machine-readable `code: 'FEATURE_OFF'` (parity with PLAN_LIMIT / RATE_LIMIT /
// DEMO_READONLY) so the client can branch on it instead of string-matching the
// error. Lending is derived (ADR-0003 §2.3, S2): any paid plan (premium/
// lifetime/unlimited) includes it, the admin/owner role is always entitled, and
// the admin can still grant `features.lending` to a free member.
// `effectiveFeatures` resolves all three — no special-casing the owner.
function featureGate(user, collection) {
  if (!user.collections?.[collection]) return json(403, { error: FEATURE_OFF_MSG, code: 'FEATURE_OFF' })
  if (!effectiveFeatures(user).lending) return json(403, { error: FEATURE_OFF_MSG, code: 'FEATURE_OFF' })
  return null
}

// SEC-7.1 (#338) non-enumeration: lending/returning targets an item the caller
// must own. An item id not in the caller's own store is a uniform 403
// FORBIDDEN — never a distinguishable 404 that would reveal whether the id
// exists in another tenant's store.
async function getItemOr404(store, itemId) {
  const item = await store.get(`item:${itemId}`, { type: 'json' })
  if (!item) return { error: forbidden() }
  return { item }
}

async function handleLend(store, user, itemId, body) {
  const { item, error } = await getItemOr404(store, itemId)
  if (error) return error
  if (item.lending) return json(409, { error: 'Item is already on loan.' })
  const contact = cleanContact(body.borrower.contact)
  const dueOn = validDueOn(body.dueOn) ? body.dueOn : undefined
  const loan = {
    borrower: {
      name: cleanName(body.borrower.name),
      ...(contact ? { contact } : {}),
    },
    lentOn: new Date().toISOString(),
    ...(dueOn ? { dueOn } : {}),
  }
  const updated = { ...item, lending: loan }
  await store.setJSON(`item:${itemId}`, updated)
  // SEC-7.1 (#338): the item DTO runs through the shared filter (own:true —
  // the caller owns the item they lend).
  return json(200, { item: filterFor(user, 'item', updated, { own: true }) })
}

async function handleReturn(store, user, itemId) {
  const { item, error } = await getItemOr404(store, itemId)
  if (error) return error
  if (!item.lending) return json(409, { error: 'Item is not on loan.' })
  const loanRecord = { ...item.lending, returnedOn: new Date().toISOString() }
  const updated = { ...item }
  delete updated.lending
  updated.lendingHistory = [loanRecord, ...(item.lendingHistory || [])].slice(0, HISTORY_CAP)
  await store.setJSON(`item:${itemId}`, updated)
  // SEC-7.1 (#338): the item DTO runs through the shared filter (own:true).
  return json(200, { item: filterFor(user, 'item', updated, { own: true }) })
}
