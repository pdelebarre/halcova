// Auth API: request access, sign in with an access code (member or admin) or a
// magic link, and validate / revoke a server-managed SESSION token.
//
// SEC-EPIC-1 (#176): the access code and the admin key are now EXCHANGE
// credentials ONLY — a successful login mints an opaque, expiring, revocable
// session token (never the code) that the client persists and sends as
// `Authorization: Bearer <sessionToken>` on every later call. The code → user
// lookup lives ONLY here at login; every other function validates the session
// token via resolveSession().

import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { ADMIN_KEY, DEMO_CODE, DEMO_USER, OWNER_ID, bearer, generateAccessCode, isDemoCode, publicUser } from './_shared/auth'
import { normalizeCode } from './_shared/codes'
import { createRateLimiter, clientIp } from './_shared/rate-limit'
import { consumeMagicLink, issueMagicLink, magicLinkSecret, verifyMagicLinkToken } from './_shared/magic-link'
import { isDevEmailMode, isMailConfigured, sendMagicLink } from './_shared/mailer'
import { resolveSession } from './_shared/session-auth'
import { createSession, revokeSession } from './_shared/sessions'
import {
  findPendingRequestByEmail,
  findUserByCode,
  findUserByEmail,
  saveRequest,
  saveUser,
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
// Self-serve magic link (ADR-0003 S1): per-IP bounds a flood of links from one
// source; per-email bounds one inbox being hammered.
const MAGIC_LINK_IP_LIMIT = Number(process.env.RUNOUT_AUTH_MAGICLINK_IP_RATE_LIMIT) || 10
const MAGIC_LINK_EMAIL_LIMIT = Number(process.env.RUNOUT_AUTH_MAGICLINK_RATE_LIMIT) || 5

// A light shape check before we email someone — enough to reject obvious
// garbage without a backtracking-prone regex.
function looksLikeEmail(email) {
  const value = String(email || '')
  if (value.length < 5 || value.includes(' ')) return false
  const at = value.indexOf('@')
  if (at <= 0 || at === value.length - 1) return false
  const domain = value.slice(at + 1)
  return domain.includes('.') && domain.length >= 3
}

// A friendly default display name for a self-serve signup (the local part of
// the email). The admin path still requires an explicit name; the self-serve
// path signs up with email alone (ADR-0003 S1).
function nameFromEmail(email) {
  const local = String(email || '').split('@')[0] || ''
  return local.trim().slice(0, 80)
}

// Where the magic link should point. RUNOUT_SITE_URL is authoritative in
// production (the SPA reads `?magic-link=` from window.location.search); in dev
// it falls back to the request origin/host so `netlify dev` works with no env.
function siteUrl(req) {
  const configured = process.env.RUNOUT_SITE_URL
  if (configured) return configured.trimEnd('/')
  const origin = req.headers.get('origin')
  if (origin) return origin
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'http://localhost:8888'
}

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
      // session.user.features.lending === true and
      // session.user.features.games === true for the owner too.
      features: { lending: true, games: true },
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
  // The access code is an EXCHANGE credential only (SEC-EPIC-1, #176): a
  // successful login mints a fresh, opaque, expiring SESSION token — never the
  // code — which the client persists and sends on every later call. The raw
  // token is returned exactly once here and only its hash is stored server-side.
  const { token } = await createSession({ userId: user.id, role: user.role })
  return json(200, { user: publicUser(user), session: token })
}

async function handleMe(req) {
  const token = bearer(req)
  if (!token) return json(401, { error: 'Not signed in.' })

  // Session-validation is called on app load; a runaway client can't spam it.
  const limiter = createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'auth:me', limit: ME_LIMIT })
  const rl = await limiter(token)
  if (rl.limited) {
    return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(rl.retryAfter) })
  }

  // The Bearer is now a session token, not an access code — a live session
  // resolves to the user (disabled accounts are rejected here too, SEC-1.9).
  const resolved = await resolveSession(req)
  if (resolved.error) return resolved.error
  return json(200, { user: publicUser(resolved.user), session: token })
}

// Server-side logout (SEC-1.9, #184): revoke the session token so it is dead
// server-side even if a copy was cached elsewhere. Revoking an already-dead
// token is a no-op success.
async function handleLogout(req) {
  const token = bearer(req)
  if (!token) return json(400, { error: 'Not signed in.' })
  await revokeSession(token)
  return json(200, { ok: true })
}

// ---- Self-serve signup via email magic link (ADR-0003, S1) ----------------
//
// No admin in the loop: the visitor proves they own the email by clicking the
// one-time link, and the RU- access code is auto-issued with generateAccessCode
// (the same bearer model as before — only the issuance is automatic). The
// access code is generated on the server, returned to the session owner exactly
// once, and NEVER logged.

async function handleRequestMagicLink(body, req) {
  const email = cleanEmail(body.email)
  if (!email) return json(400, { error: 'Add your email so we can send you a sign-in link.' })
  if (!looksLikeEmail(email)) return json(400, { error: "That email doesn't look right. Check it and try again." })
  const normEmail = email.toLowerCase()

  // Anti-spam (T5): per-IP bounds a flood of links from one source; per-email
  // bounds a single inbox being hammered.
  const ip = clientIp(req)
  if (ip) {
    const byIp = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'auth:magiclink:ip', limit: MAGIC_LINK_IP_LIMIT })(ip)
    if (byIp.limited) {
      return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(byIp.retryAfter) })
    }
  }
  const byEmail = await createRateLimiter({ store: getStore(RATE_LIMITS_STORE), scope: 'auth:magiclink:email', limit: MAGIC_LINK_EMAIL_LIMIT })(normEmail)
  if (byEmail.limited) {
    return json(429, { error: 'Too many requests — try again shortly.', code: 'RATE_LIMIT' }, { 'Retry-After': String(byEmail.retryAfter) })
  }

  // M3 (S8, #54): FAIL CLOSED. In production the mail key is REQUIRED — check
  // BEFORE issuing a token or recording a request, so a misconfigured prod can
  // never mint a sign-in link (which would let an attacker rotate a member's
  // code for any email). Dev keeps the no-op mailer + devLink echo below.
  if (!isMailConfigured() && !isDevEmailMode()) {
    return json(503, { error: "Sign-in email isn't configured yet — try again shortly.", code: 'MAIL_NOT_CONFIGURED' })
  }

  // Reuse the existing pending `request:<id>` flow (ADR-0003 §2.2): the request
  // record is the stable identity the future payment webhook attaches
  // entitlements to. Deduped by email while pending.
  let request = await findPendingRequestByEmail(normEmail)
  if (!request) {
    request = {
      id: randomUUID(),
      name: nameFromEmail(normEmail),
      email: normEmail,
      status: 'pending',
      createdAt: new Date().toISOString(),
    }
    await saveRequest(request)
  }

  const { token, expiresAt } = issueMagicLink(normEmail)
  const link = `${siteUrl(req)}/?magic-link=${encodeURIComponent(token)}`
  const result = await sendMagicLink({ email: normEmail, link })

  // Dev-only: when the mailer is a no-op the link is echoed so a developer can
  // click through. In production the key is configured, so `result.sent` is
  // always true and no link ever reaches the client (never log it there).
  return json(200, {
    ok: true,
    expiresAt,
    ...(result.sent || !isDevEmailMode() ? {} : { devLink: link }),
  })
}

async function handleVerifyMagicLink(body) {
  const token = String(body.token || '').trim()
  if (!token) return json(400, { error: 'Missing magic link token.' })

  const verified = verifyMagicLinkToken(token, { secret: magicLinkSecret() })
  if (!verified.ok) {
    if (verified.code === 'LINK_EXPIRED') {
      return json(401, { error: 'That sign-in link has expired. Request a new one.', code: 'LINK_EXPIRED' })
    }
    return json(401, { error: "That sign-in link isn't valid. Request a new one.", code: 'LINK_INVALID' })
  }

  const consumed = await consumeMagicLink(token)
  if (!consumed) {
    return json(401, { error: 'That sign-in link was already used. Request a new one.', code: 'LINK_USED' })
  }

  const email = verified.email

  // A disabled member must never be re-enabled by clicking a link.
  const existingUser = await findUserByEmail(email)
  if (existingUser && existingUser.status !== 'active') {
    return json(403, { error: 'This account is disabled.' })
  }

  // Reuse the pending request (created by requestMagicLink); recreate it if it
  // was cleaned up so the admin panel keeps a trace of the signup.
  let request = await findPendingRequestByEmail(email)
  if (!request) {
    request = { id: randomUUID(), name: nameFromEmail(email), email, status: 'pending', createdAt: new Date().toISOString() }
    await saveRequest(request)
  }

  const code = generateAccessCode()
  let user
  if (existingUser) {
    // Magic-link sign-in for a returning member: rotate to a fresh code (the
    // link is the credential). Their plan/collections/status are preserved.
    user = { ...existingUser, code }
    await saveUser(user)
  } else {
    // Brand-new self-serve member: free tier, both collections, no lending.
    user = {
      id: randomUUID(),
      name: request.name || nameFromEmail(email),
      email,
      collections: { records: true, books: true },
      features: {},
      plan: 'free',
      code,
      role: 'member',
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    await saveUser(user)
  }

  await saveRequest({ ...request, status: 'approved', approvedAt: new Date().toISOString() })

  // The auto-issued access code is exchanged for a fresh session token exactly
  // like a manual login — the client never persists the code (SEC-1.1/1.2).
  const { token: sessionToken } = await createSession({ userId: user.id, role: user.role })
  return json(200, { user: publicUser(user), session: sessionToken })
}

export default async (req) => {
  try {
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      if (body.action === 'request') return handleRequest(body)
      if (body.action === 'login') return handleLogin(body, req)
      if (body.action === 'requestMagicLink') return handleRequestMagicLink(body, req)
      if (body.action === 'verifyMagicLink') return handleVerifyMagicLink(body)
      if (body.action === 'logout') return handleLogout(req)
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
