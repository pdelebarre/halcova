// asset.js — private asset access endpoint (SEC-7.3, #340). Readiness /
// pattern-establishment: there is NO upload or photo/doc feature yet — this
// endpoint establishes the authorization-before-signed-access seam that the
// file-heavy feature will build on, and it enforces the private-asset policy
// today.
//
// Actions (POST; Authorization: Bearer <sessionToken>):
//   sign   { action: 'sign', assetId }   -> 200 { url, expiresAt, mimeType }
//   list                                  -> 200 { assets: [{ assetId, mimeType, size, createdAt }] }
//   delete { action: 'delete', assetId }  -> 200 { ok: true }
//
// Security properties (SEC-7.3, #340):
//   - Every action routes through enforce() (policy.js): asset:sign /
//     asset:delete deny the read-only demo identity; asset:list is owner-self.
//   - The asset store is resolved from the SESSION user.id (asset-store.js
//     namespaces `assets-<userId>`), never a client-supplied owner id.
//   - Non-enumeration (SEC-7.1): signing an asset that is missing OR whose
//     ownerId !== user.id returns the SAME uniform 403 FORBIDDEN, so a client
//     can't distinguish "doesn't exist" from "not yours" (no cross-tenant
//     enumeration / BOLA).
//   - sign mints a bounded HMAC signed URL (10-min default TTL, 15-min hard
//     cap) via asset-sign.js; asset IDs (not signed URLs) are the only thing
//     that ever appears in DTOs.
//   - FAILS CLOSED (CWE-287/346): if ASSET_SIGN_SECRET is not configured, sign
//     refuses with 503 — never a default-open URL.
//   - Session revocation does NOT retroactively revoke an already-issued
//     10-minute URL — an accepted, bounded trade-off (the token is single-
//     object read-only and short-lived). Documented in docs/secure-asset-access.md.

import { getAssetStore } from './_shared/asset-store'
import { isAssetSignConfigured, issueAssetToken } from './_shared/asset-sign'
import { enforce, forbidden } from './_shared/policy'
import { json, readJsonBody, safeError } from './_shared/security'

// Asset blob keys are prefixed so they never collide with index/metadata keys
// in the same per-user store.
export const ASSET_KEY_PREFIX = 'asset:'

// Read + validate the JSON body (64 KB cap is plenty — an action object).
async function readBody(req) {
  const parsed = await readJsonBody(req)
  if (parsed.error) return parsed
  return parsed.value ?? {}
}

function validateAction(body) {
  const { action, assetId } = body
  if (action !== 'sign' && action !== 'list' && action !== 'delete') {
    return json(400, { error: 'Unknown action.' })
  }
  if (action === 'sign' || action === 'delete') {
    if (typeof assetId !== 'string' || !assetId.trim()) return json(400, { error: 'Missing assetId.' })
    // Asset ids are UUIDs assigned server-side; reject anything that isn't one
    // (tight shape, no injection into blob keys).
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(assetId)) {
      return json(400, { error: 'Invalid assetId.' })
    }
  }
  return null
}

// Uniform non-enumerating 403 for "asset missing or not yours".
function assetNotFound() {
  return forbidden()
}

export default async function asset(req) {
  try {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

    const body = await readBody(req)
    if (body.error) return body.error
    const invalid = validateAction(body)
    if (invalid) return invalid

    switch (body.action) {
      case 'sign': return await signAction(req, body)
      case 'list': return await listAction(req)
      case 'delete': return await deleteAction(req, body)
      default: return json(400, { error: 'Unknown action.' })
    }
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}

// asset:sign — demo denied, owner-self. The store namespace is derived from the
// SESSION user.id only; a foreign owner/tenant/asset id can never address
// another namespace.
async function signAction(req, body) {
  const auth = await enforce(req, 'asset:sign')
  if (auth.error) return auth.error
  const user = auth.user

  const found = await lookupOwn(user.id, body.assetId)
  if (!found) return assetNotFound()
  // Defense-in-depth owner check (ownerId === user.id). In the per-user store
  // this always holds, but it keeps the contract explicit and future-proof.
  if (found.ownerId !== user.id) return assetNotFound()

  return await mintSignedUrl(user, found)
}

// asset:list — return the caller's OWN assets only.
async function listAction(req) {
  const auth = await enforce(req, 'asset:list')
  if (auth.error) return auth.error
  const user = auth.user
  const assets = await listOwn(user.id)
  return json(200, { assets })
}

// asset:delete — delete only from the caller's own store; non-owner is the
// same non-enumerating FORBIDDEN as missing.
async function deleteAction(req, body) {
  const auth = await enforce(req, 'asset:delete')
  if (auth.error) return auth.error
  const user = auth.user
  const existing = await lookupOwn(user.id, body.assetId)
  if (!existing || existing.ownerId !== user.id) return assetNotFound()
  await deleteOwn(user.id, body.assetId)
  return json(200, { ok: true })
}

// --- store helpers (per-user private asset store) ---------------------------

// Read the envelope blob at `asset:<uuid>` from the caller's own store.
// Returns the envelope or null.
async function lookupOwn(userId, assetId) {
  const store = getAssetStore(userId)
  const envelope = await store.get(`${ASSET_KEY_PREFIX}${assetId}`, { type: 'json' })
  if (!envelope) return null
  return envelope
}

async function listOwn(userId) {
  const store = getAssetStore(userId)
  const listing = await store.list()
  const keys = listing.keys || []
  const assets = []
  for (const entry of keys) {
    if (!String(entry.key || '').startsWith(ASSET_KEY_PREFIX)) continue
    const envelope = await store.get(entry.key, { type: 'json' })
    if (!envelope) continue
    assets.push({
      assetId: envelope.assetId || entry.key.slice(ASSET_KEY_PREFIX.length),
      mimeType: envelope.mimeType || null,
      size: envelope.size ?? null,
      createdAt: envelope.createdAt || null,
    })
  }
  return assets
}

async function deleteOwn(userId, assetId) {
  const store = getAssetStore(userId)
  await store.delete(`${ASSET_KEY_PREFIX}${assetId}`)
}

async function mintSignedUrl(user, envelope) {
  // FAILS CLOSED (CWE-287/346, #184): no ASSET_SIGN_SECRET -> refuse, never a
  // default-open (forgeable) signed URL.
  if (!isAssetSignConfigured()) {
    return json(503, { error: 'Asset signing is not configured.', code: 'SIGNING_UNAVAILABLE' })
  }
  const secret = process.env.ASSET_SIGN_SECRET
  const { signed, expiresAt } = issueAssetToken({
    assetId: envelope.assetId,
    tenantId: user.id,
    secret,
  })
  // Asset IDs (not raw signed URLs) are the only thing ever in DTOs; the
  // signed URL token is returned exactly once, on demand, from this dedicated
  // action. The future serving/object-store layer validates it with
  // verifyAssetToken() (single-object read-only, bounded TTL).
  return json(200, {
    url: signed,
    expiresAt,
    mimeType: envelope.mimeType || null,
  })
}
