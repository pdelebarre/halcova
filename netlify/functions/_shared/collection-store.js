// Shared collection-store helpers for the Runout functions. Not deployed as a
// function itself (underscore-prefixed folder under netlify/functions) — each
// function that imports it gets it bundled by esbuild.
//
// Used by netlify/functions/collection.js today, and by the future `lending`
// function. `authorize` is the single place that resolves a request to the
// owner (admin key) or a member (access code) and returns their identity, so
// any per-account capability (e.g. the owner's `features: { lending: true }`)
// belongs here.

import { resolveSession } from './session-auth'

// Only these collection kinds exist; anything else is rejected.
export const COLLECTIONS = { records: true, books: true }
export const INDEX_KEY = 'index'

export const json = (statusCode, body, headers = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
})

export async function readIndex(store) {
  const data = await store.get(INDEX_KEY, { type: 'json' })
  return data || []
}

export async function writeIndex(store, ids) {
  await store.setJSON(INDEX_KEY, ids)
}

// Every request must carry a LIVE server-managed session token (SEC-EPIC-1,
// #176) — the access code is no longer a bearer credential, it is only an
// exchange credential used at login. `resolveSession` (in session-auth.js)
// validates the token server-side and resolves it to the owner / demo / a
// member identity (including the owner's constant feature flags and the
// demo-read-only role).
export async function authorize(req) {
  return resolveSession(req)
}
