// Shared auth helpers for the Runout functions. Not deployed as a function
// itself (underscore-prefixed folder under netlify/functions) — each function
// that imports it gets it bundled by esbuild.

import { randomBytes } from 'node:crypto'

// The site owner signs in with this key. Set RUNOUT_ADMIN_KEY in your Netlify
// environment (or .env for `netlify dev`). A well-known dev fallback keeps
// local development usable; ALWAYS set a real, long random value in
// production.
export const ADMIN_KEY = process.env.RUNOUT_ADMIN_KEY || 'runout-dev-admin-key'

// The owner's identity is a constant. Their collections stay in the original
// blob stores (runout-collection / runout-library) so nothing needs migrating.
export const OWNER_ID = 'owner'

// The public demo space rides the auth model as a CONSTANT identity, exactly
// like the owner — no user record is created. RUNOUT_DEMO_CODE is deliberately
// NOT secret: it ships in the client so the "Try the free demo" button can
// sign visitors in. It is safe only because the demo store is read-only
// (collection.js rejects demo writes with DEMO_READONLY).
export const DEMO_CODE = process.env.RUNOUT_DEMO_CODE || 'RUNOUT-DEMO-0000'

export function isDemoCode(code) {
  return typeof code === 'string' && code.toUpperCase() === DEMO_CODE.toUpperCase()
}

// The demo visitor's profile. Same special-case pattern as the owner constant;
// `features: {}` deliberately — the demo space has no lending.
export const DEMO_USER = {
  id: 'demo',
  role: 'demo',
  name: 'Demo',
  email: '',
  collections: { records: true, books: true },
  features: {},
  status: 'active',
}

// Pull the Bearer token out of an Authorization header, if present.
export function bearer(req) {
  const header = req.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

// Strip sensitive fields (the access code AND its sha256 hash) before sending
// a user to the client. Everything else — including the per-account `features`
// flag map — passes through untouched, so the client can read
// session.user.features.lending. The client only ever needs the plaintext code
// it was issued, which it already holds in localStorage.runout.session.
export function publicUser(user) {
  if (!user) return null
  const { code: _code, code_hash: _hash, ...rest } = user
  return rest
}

// Human-friendly access codes: RU-XXXX-XXXX-XXXX, no ambiguous characters.
export function generateAccessCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1
  const bytes = randomBytes(12)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += alphabet[bytes[i] % alphabet.length]
  return `RU-${str.slice(0, 4)}-${str.slice(4, 8)}-${str.slice(8, 12)}`
}
