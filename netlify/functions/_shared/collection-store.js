// Shared collection-store helpers for the Runout functions. Not deployed as a
// function itself (underscore-prefixed folder under netlify/functions) — each
// function that imports it gets it bundled by esbuild.
//
// Used by netlify/functions/collection.js today, and by the future `lending`
// function. `authorize` is the single place that resolves a request to the
// owner (admin key) or a member (access code) and returns their identity, so
// any per-account capability (e.g. the owner's `features: { lending: true }`)
// belongs here.

import { ADMIN_KEY, DEMO_USER, OWNER_ID, bearer, isDemoCode } from './auth'
import { findUserByCode } from './users'

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

// Every request must carry the caller's access code. The owner uses the admin
// key; members use the code the admin generated when approving their request.
export async function authorize(req) {
  const code = bearer(req)
  if (!code) return { error: json(401, { error: 'Sign in with your access code.' }) }

  let user
  if (code === ADMIN_KEY) {
    user = {
      id: OWNER_ID,
      role: 'admin',
      status: 'active',
      collections: { records: true, books: true },
      // The owner has every feature flag on by default (W3) — lending AND
      // games — mirroring profileForCode() in netlify/functions/auth.js.
      features: { lending: true, games: true },
    }
  } else if (isDemoCode(code)) {
    // The demo code is a constant identity, NOT a stored user — resolve it
    // before the member lookup so no user record ever needs to exist. The
    // demo profile passes the `status === 'active'` check below.
    user = DEMO_USER
  } else {
    user = await findUserByCode(code)
  }
  if (!user) return { error: json(401, { error: "That access code isn't recognized." }) }
  if (user.status !== 'active') return { error: json(403, { error: 'This account is disabled.' }) }
  return { user }
}
