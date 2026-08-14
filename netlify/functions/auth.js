// Auth API: request access, sign in with an access code (member or admin),
// and validate an existing session. No passwords — access is granted by the
// admin from the admin panel, and the admin key comes from RUNOUT_ADMIN_KEY.

import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ADMIN_KEY, DEMO_CODE, DEMO_USER, OWNER_ID, bearer, isDemoCode, publicUser } from './_shared/auth'
import { normalizeCode } from './_shared/codes'
import { createRateLimiter, clientIp } from './_shared/rate-limit'
import {
  findPendingRequestByEmail,
  findUserByCode,
  saveRequest,
} from './_shared/users'

const json = (statusCode, body, headers = {}) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json', ...headers },
})

const RATE_LIMITS_STORE = 'runout-rate-limits'
// Fixed-window limits (T5). Login is the auth brute-force surface: per-IP is
// the real defense (many codes from one source), per-code throttles a single
// account being hammered. The public demo code is shared by every demo visitor
// so it is NOT code-limited (per-IP still bounds it).
const LOGIN_IP_LIMIT = Number(process.env.RUNOUT_AUTH_LOGIN_IP_RATE_LIMIT) || 30
const LOGIN_CODE_LIMIT = Number(process.env.RUNOUT_AUTH_LOGIN_RATE_LIMIT) || 20
const REQUEST_LIMIT = Number(process.env.RUNOUT_AUTH_REQUEST_RATE_LIMIT) || 10
const ME_LIMIT = Number(process.env.RUNOUT_AUTH_ME_RATE_LIMIT) || 60

function cleanName(name) {
  return String(name || '').trim().slice(0, 80)
}

function cleanEmail(email) {
  return String(email || '').trim().slice(0, 120)
}

async function handleRequest(body) {
  const name = cleanName(body.name)
  const email = cleanEmail(body.email)
  if (!name) return json(400, { error: 'Add your name so the admin knows who you are.' })
  if (!email) return json(400, { error: 'Add an email so the admin can reach you.' })

  // Anti-spam (T5): a burst of signup requests from one email can't flood the
  // request store (the admin panel lists them all).
  const limiter = createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'auth:request', limit: REQUEST_LIMIT })
  const rl = await limiter(String(email).trim().toLowerCase())
  if (rl.limited) {
    return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
  }

  const existing = await findPendingRequestByEmail(email)
  if (existing) {
    return json(200, { ok: true, already: true, id: existing.id })
  }

  const request = {
    id: randomUUID(),
    name,
    email,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  await saveRequest(request)
  return json(201, { ok: true, id: request.id })
}

async function profileForCode(code) {
  if (!code) return null
  // The admin key matches exactly as configured (RUNOUT_ADMIN_KEY may contain
  // lowercase letters). Member codes are stored uppercase, so the lookup is
  // case-insensitive.
  if (code === ADMIN_KEY) {
    return {
      id: OWNER_ID,
      name: 'Admin',
      email: '',
      collections: { records: true, books: true },
      // The owner has every feature flag on by default (W3), mirroring
      // authorize() in _shared/collection-store.js — so the client can read
      // session.user.features.lending === true for the owner too.
      features: { lending: true },
      role: 'admin',
      status: 'active',
    }
  }
  // The demo code is a constant identity (like the owner) — resolve it before
  // the member lookup so no user record is needed (see _shared/auth.js).
  if (isDemoCode(code)) {
    return DEMO_USER
  }
  return findUserByCode(code.toUpperCase())
}

async function handleLogin(body, req) {
  const code = String(body.code || '').trim()
  if (!code) return json(401, { error: 'Enter your access code.' })

  // Brute-force / runaway protection (T5). Per-IP applies to every code
  // (including the public demo code); per-code throttles a single account.
  const ip = clientIp(req)
  if (ip) {
    const byIp = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'auth:login:ip', limit: LOGIN_IP_LIMIT })(ip)
    if (byIp.limited) {
      return json(429, { error: 'Too many attempts — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(byIp.retryAfter) })
    }
  }
  if (!isDemoCode(code)) {
    const byCode = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'auth:login:code', limit: LOGIN_CODE_LIMIT })(normalizeCode(code))
    if (byCode.limited) {
      return json(429, { error: 'Too many attempts — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(byCode.retryAfter) })
    }
  }

  const user = await profileForCode(code)
  if (!user) return json(401, { error: "That access code isn't recognized. Check it and try again." })
  if (user.status !== 'active') return json(403, { error: 'This account is disabled. Ask the admin to re-enable it.' })
  return json(200, sessionPayload(user, normalizeCode(code)))
}

// The canonical code for a session: the admin key for the owner, the public
// demo code for the demo identity, or the member's stored (uppercase) code.
// Storing this client-side means every later API call authenticates no matter
// how the code was typed at sign-in.
//
// `fallbackCode` covers the Postgres path: since Part B stores only the sha256
// hash, a Postgres-backed user has no plaintext `code` to return. The client
// already typed/holds the code, so we hand back the normalized (trim+uppercase)
// form of what it sent — byte-identical to the Blobs path for real codes.
function sessionPayload(user, fallbackCode) {
  const code = user.role === 'admin' ? ADMIN_KEY : (user.role === 'demo' ? DEMO_CODE : (user.code || fallbackCode))
  return {
    user: publicUser(user),
    code,
  }
}

async function handleMe(req) {
  const code = bearer(req)
  if (!code) return json(401, { error: 'Not signed in.' })

  // Session-validation is called on app load; a runaway client can't spam it.
  const limiter = createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'auth:me', limit: ME_LIMIT })
  const rl = await limiter(normalizeCode(code))
  if (rl.limited) {
    return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
  }

  const user = await profileForCode(code)
  if (!user) return json(401, { error: 'Not signed in.' })
  if (user.status !== 'active') return json(403, { error: 'This account is disabled.' })
  return json(200, sessionPayload(user, normalizeCode(code)))
}

export default async (req) => {
  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      if (body.action === 'request') return handleRequest(body)
      if (body.action === 'login') return handleLogin(body, req)
      return json(400, { error: 'Unknown action.' })
    }

    if (req.method === 'GET') {
      return handleMe(req)
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return json(500, { error: err.message || 'Internal error' })
  }
}
