// asset-store.js — thin seam over a Blobs-compatible private per-tenant asset
// store (SEC-7.3, #340). Readiness/pattern-establishment: there is NO upload
// endpoint or user photo/doc feature yet — this is the storage abstraction the
// future file-heavy feature will build on, plus per-user asset namespaces we
// can start using today.
//
// Design:
//   - per-tenant namespace: assetStoreName(userId) => `assets-<userId>` —
//     mirrors storeNameFor() in users.js (per-user isolation). The namespace
//     is NEVER keyed by a client-supplied owner id; it is derived from the
//     resolved session's user.id only (see asset.js).
//   - minimal store-agnostic interface: list / get / set / delete / getStore.
//     The implementation is Blobs-backed today, but the surface is deliberately
//     vendor-agnostic so a future SaaS object store (S3/GCS/R2) can swap in
//     underneath without any function-logic change.
//   - the store works on raw bytes (Uint8Array) so image re-encode / magic-byte
//     integrity checks (deferred upload policy) can be layered on later; it
//     does NOT assume JSON.

import { getStore } from '@netlify/blobs'

// NAMESPACE_PREFIX is exported for tests / diagnostics only. The per-user
// namespace mirrors the collection-store naming so the owner keeps no legacy
// asset store and every member is isolated. Keying is always on the SESSION
// user.id, never a request-supplied owner.
export const ASSET_STORE_PREFIX = 'assets-'

// Per-user private asset store name. `userId` must come from the resolved
// session (resolveSession), never from the client.
export function assetStoreName(userId) {
  return `${ASSET_STORE_PREFIX}${userId}`
}

// Get (or lazily create) the Blobs store for a user's private assets.
export function getAssetStore(userId) {
  return getStore(assetStoreName(userId))
}

// List the keys in a user's asset store. Returns an array of `{ key }`
// entries (Blobs shape). Vendor-agnostic: callers only see keys + a stable
// array shape, so a future object store can return the same.
export async function listAssets(userId) {
  const store = getAssetStore(userId)
  const listing = await store.list()
  return listing.keys || []
}

// Get raw bytes for an asset key (or null when absent). Returns a
// `{ data, key }`-ready value so callers can branch on existence.
export async function getAsset(userId, key) {
  const store = getAssetStore(userId)
  const data = await store.get(key, { type: 'arrayBuffer' })
  if (data === null || data === undefined) return null
  return new Uint8Array(data)
}

// Store raw bytes under a key in a user's asset store. (Upload-size/type
// enforcement + integrity checks are the DEFERRED upload-policy surface — see
// docs/secure-asset-access.md; this seam only persists what it is given.)
export async function setAsset(userId, key, value, { contentType } = {}) {
  const store = getAssetStore(userId)
  if (contentType) {
    await store.set(key, value, { type: contentType })
  } else {
    await store.set(key, value)
  }
}

// Delete a single asset by key from a user's store.
export async function deleteAsset(userId, key) {
  const store = getAssetStore(userId)
  await store.delete(key)
}
