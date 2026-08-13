// Auth API: request access, sign in with an access code (member or admin),
// and validate an existing session. No passwords — access is granted by the
// admin from the admin panel, and the admin key comes from RUNOUT_ADMIN_KEY.

import { randomUUID } from 'node:crypto'
import { ADMIN_KEY, DEMO_CODE, DEMO_USER, OWNER_ID, bearer, isDemoCode, publicUser } from './_shared/auth'
import {
  findPendingRequestByEmail,
  findUserByCode,
  saveRequest,
} from './_shared/users'

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json' },
})

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

async function handleLogin(body) {
  const code = String(body.code || '').trim()
  if (!code) return json(401, { error: 'Enter your access code.' })

  const user = await profileForCode(code)
  if (!user) return json(401, { error: "That access code isn't recognized. Check it and try again." })
  if (user.status !== 'active') return json(403, { error: 'This account is disabled. Ask the admin to re-enable it.' })
  return json(200, sessionPayload(user))
}

// The canonical code for a session: the admin key for the owner, the public
// demo code for the demo identity, or the member's stored (uppercase) code.
// Storing this client-side means every later API call authenticates no matter
// how the code was typed at sign-in.
function sessionPayload(user) {
  return {
    user: publicUser(user),
    code: user.role === 'admin' ? ADMIN_KEY : (user.role === 'demo' ? DEMO_CODE : user.code),
  }
}

async function handleMe(req) {
  const code = bearer(req)
  const user = await profileForCode(code)
  if (!user) return json(401, { error: 'Not signed in.' })
  if (user.status !== 'active') return json(403, { error: 'This account is disabled.' })
  return json(200, sessionPayload(user))
}

export default async (req) => {
  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      if (body.action === 'request') return handleRequest(body)
      if (body.action === 'login') return handleLogin(body)
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
