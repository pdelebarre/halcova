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
import { COLLECTIONS, authorize, json } from './_shared/collection-store'
import { effectiveFeatures } from './_shared/entitlements'
import { storeNameFor } from './_shared/users'
import { safeError } from './_shared/security'

const FEATURE_OFF_MSG = "Lending isn't enabled for your account."
const HISTORY_CAP = 10

export default async function lending(req) {
  const { user, error } = await authorize(req)
  if (error) return error

  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const body = await readBody(req)
  if (body.error) return body.error

  const invalid = validateAction(body)
  if (invalid) return invalid

  const denied = featureGate(user, body.collection)
  if (denied) return denied

  const store = getStore(storeNameFor(user.id, body.collection))
  try {
    return body.action === 'lend'
      ? await handleLend(store, body.itemId, body)
      : await handleReturn(store, body.itemId)
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}

async function readBody(req) {
  try {
    // A JSON `null` body is valid JSON but not a request body — default to {}
    // so validateAction rejects it with a 400 instead of a TypeError that
    // would escape the handler's try/catch as a 500.
    return (await req.json()) ?? {}
  } catch {
    return { error: json(400, { error: 'Invalid JSON body.' }) }
  }
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

async function getItemOr404(store, itemId) {
  const item = await store.get(`item:${itemId}`, { type: 'json' })
  if (!item) return { error: json(404, { error: 'Item not found.' }) }
  return { item }
}

async function handleLend(store, itemId, body) {
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
  return json(200, { item: updated })
}

async function handleReturn(store, itemId) {
  const { item, error } = await getItemOr404(store, itemId)
  if (error) return error
  if (!item.lending) return json(409, { error: 'Item is not on loan.' })
  const loanRecord = { ...item.lending, returnedOn: new Date().toISOString() }
  const updated = { ...item }
  delete updated.lending
  updated.lendingHistory = [loanRecord, ...(item.lendingHistory || [])].slice(0, HISTORY_CAP)
  await store.setJSON(`item:${itemId}`, updated)
  return json(200, { item: updated })
}
