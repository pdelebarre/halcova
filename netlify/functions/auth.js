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
import { ADMIN_KEY, DEMO_USER, OWNER_ID, bearer, generateAccessCode, isDemoCode, publicUser } from './_shared/auth'
import { normalizeCode } from './_shared/codes'
import { clientIp, rateLimitGuard } from './_shared/rate-limit'
import { consumeMagicLink, isMagicLinkConfigured, issueMagicLink, magicLinkSecret, verifyMagicLinkToken } from './_shared/magic-link'
import { isDevEmailMode, isMailConfigured, sendMagicLink } from './_shared/mailer'
import { enforce } from './_shared/policy'
import { createSession, deleteAllForUser, revokeAllForUser, revokeSession } from './_shared/sessions'
import {
  findPendingRequestByEmail,
  findUserByCode,
  findUserByEmail,
  saveRequest,
  saveUser,
  deleteUserCollections,
  removeUserRecord,
} from './_shared/users'
import { json, readJsonBody, safeError } from './_shared/security'
import { logAudit, emailHash } from './_shared/audit'
import { anomalyScope, recordAnomaly } from './_shared/anomaly'
import { deleteMemberReviews, deleteMemberFeedback } from './admin'

// NOTE — CSRF (SEC-3.5, #198): sessions are NOT cookie-based. SEC-EPIC-1
// (#176) uses a Bearer session token held in localStorage and sent as an
// `Authorization` header on every state-changing call. There is no ambient
// cookie credential, so classic cookie-CSRF does not apply — a cross-site form
// POST cannot attach the Bearer header (it isn't auto-sent), and the token is
// never readable by a third-party origin. Every function requires the Bearer
// token (401 otherwise), which is the CSRF defense for a header-based token
// flow. This is asserted by a negative test in auth-endpoint.test.js.

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
// SEC-1.7 (#182): verify is the real brute-force surface for magic links — a
// wrong guess costs the verify round-trip, so per-IP throttling here bounds
// the cost of hammering tokens (the HMAC + randomUUID jti makes a practical
// brute force infeasible; this is defense in depth, like the login limiter).
export const MAGIC_LINK_VERIFY_IP_LIMIT = Number(process.env.RUNOUT_AUTH_MAGICLINK_VERIFY_IP_RATE_LIMIT) || 20
// SEC-7.4 (#341): logout is a cheap, unrate-limited primitive today — a runaway
// client could spam it to churn session records. Per-token bounds one session
// being logged out repeatedly; logoutAll is per-IP (below) so one stolen token
// can't revoke every session in a flood.
const LOGOUT_LIMIT = Number(process.env.RUNOUT_AUTH_LOGOUT_RATE_LIMIT) || 60
const LOGOUT_ALL_IP_LIMIT = Number(process.env.RUNOUT_AUTH_LOGOUT_ALL_IP_RATE_LIMIT) || 60

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
  // request store (the admin panel lists them all). SEC-7.4.x (#383): routed
  // through rateLimitGuard so a 429 emits `rate_limit.served` + the exhaust
  // burst signal (user-keyed scope, anonymous).
  const rl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'auth:request',
    limit: REQUEST_LIMIT,
    identity: String(email).trim().toLowerCase(),
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  if (rl) return rl

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
  // SEC-7.4.x (#383): routed through rateLimitGuard so each 429 emits
  // `rate_limit.served` + the exhaust burst signal. The per-IP limiter keys
  // on the client IP, so its burstScope is an anonymous anomalyScope hash —
  // the raw IP never becomes a burst scope.
  const ip = clientIp(req)
  if (ip) {
    const byIp = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'auth:login:ip',
      limit: LOGIN_IP_LIMIT,
      identity: ip,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope: anomalyScope('rlx:auth:login:ip', ip),
    })
    if (byIp) return byIp
  }
  if (!isDemoCode(code)) {
    const byCode = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'auth:login:code',
      limit: LOGIN_CODE_LIMIT,
      identity: normalizeCode(code),
      anomalyStore: getStore(RATE_LIMITS_STORE),
    })
    if (byCode) return byCode
  }

  const user = await profileForCode(code)
  if (!user) {
    // SEC-6.4 (#218): an unknown-code login attempt is a security-relevant
    // signal (brute force / typo) — audit it, never the code itself.
    logAudit('auth.login_failed', { reason: 'unknown_code' })
    // SEC-6.6 (#220): a burst of failed logins from one IP is an early-warning
    // anomaly signal (in addition to the per-IP rate limit).
    if (ip) {
      // NIT M5: the burst-counter key (transient) may use the raw IP, but the
      // audit `scope` carries only a truncated hash — never the raw address.
      await recordAnomaly(getStore(RATE_LIMITS_STORE), `anom:auth:login:${ip}`, { threshold: 10, signal: 'auth_failure_burst', scope: anomalyScope('anom:auth:login', ip) })
    }
    return json(401, { error: "That access code isn't recognized. Check it and try again." })
  }
  if (user.status !== 'active') {
    logAudit('auth.login_failed', { reason: 'disabled', userId: user.id })
    return json(403, { error: 'This account is disabled. Ask the admin to re-enable it.' })
  }
  // The access code is an EXCHANGE credential only (SEC-EPIC-1, #176): a
  // successful login mints a fresh, opaque, expiring SESSION token — never the
  // code — which the client persists and sends on every later call. The raw
  // token is returned exactly once here and only its hash is stored server-side.
  const { token } = await createSession({ userId: user.id, role: user.role })
  logAudit('auth.login_success', { userId: user.id, role: user.role })
  return json(200, { user: publicUser(user), session: token })
}

async function handleMe(req) {
  const token = bearer(req)
  if (!token) return json(401, { error: 'Not signed in.' })

  // Session-validation is called on app load; a runaway client can't spam it.
  // SEC-7.4.x (#383): routed through rateLimitGuard for abuse signals.
  const rl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'auth:me',
    limit: ME_LIMIT,
    identity: token,
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  if (rl) return rl

  // The Bearer is now a session token, not an access code — a live session
  // resolves to the user (disabled accounts are rejected here too, SEC-1.9).
  // SEC-7.1 (#338): the identity action is routed through the shared policy
  // layer (`auth:me`, principal scoped to the session's own user).
  const resolved = await enforce(req, 'auth:me')
  if (resolved.error) {
    // SEC-6.4 (#218): an invalid/expired/revoked session at revalidation.
    logAudit('auth.session_invalid', {})
    return resolved.error
  }
  return json(200, { user: publicUser(resolved.user), session: token })
}

// Server-side logout (SEC-1.9, #184): revoke the session token so it is dead
// server-side even if a copy was cached elsewhere. Revoking an already-dead
// token is a no-op success.
async function handleLogout(req) {
  const token = bearer(req)
  if (!token) return json(400, { error: 'Not signed in.' })
  // SEC-7.4 (#341): per-token logout limiter — bounds a runaway client's logout
  // churn against a single session token. SEC-7.4.x (#383): routed through
  // rateLimitGuard for abuse signals.
  const rl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'auth:logout',
    limit: LOGOUT_LIMIT,
    identity: token,
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  if (rl) return rl
  await revokeSession(token)
  logAudit('auth.logout', {})
  return json(200, { ok: true })
}

// SEC-1.4 (#179) — "sign out all devices": revoke EVERY live session for the
// resolved user (the current one included), so a stolen token on any other
// device dies server-side immediately. Scope is the session's OWN user — a
// member can never revoke another member's sessions (resolveSession binds the
// request to the token's userId). The owner (userId 'owner') is revocable too:
// owner sessions are stored like any other, so revokeAllForUser('owner') kills
// them. Idempotent: revoking an already-dead set is a safe no-op.
async function handleLogoutAll(req) {
  // SEC-7.1 (#338): the identity action is routed through the shared policy
  // layer (`auth:logoutAll`, principal scoped to the session's own user).
  const resolved = await enforce(req, 'auth:logoutAll')
  if (resolved.error) return resolved.error
  // SEC-7.4 (#341): logoutAll revokes EVERY session — a costly, irreversible
  // action — so it is throttled per-IP to bound a flood from one source.
  // SEC-7.4.x (#383): routed through rateLimitGuard; per-IP limiter gets an
  // anonymous burstScope (the raw IP never becomes a burst scope).
  const ip = clientIp(req)
  if (ip) {
    const rl = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'auth:logoutAll:ip',
      limit: LOGOUT_ALL_IP_LIMIT,
      identity: ip,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope: anomalyScope('rlx:auth:logoutAll:ip', ip),
    })
    if (rl) return rl
  }
  await revokeAllForUser(resolved.user.id)
  logAudit('auth.logout_all', { userId: resolved.user.id })
  return json(200, { ok: true })
}

// Self-serve account deletion (right-to-erasure, SEC-7.2.x #381). A member
// deletes their OWN account — the same cascade as admin handleDeleteUser
// (reviews, feedback, collection stores, Postgres items, user record, all live
// sessions), gated by re-authentication (the member must supply their access
// code as a confirmation step). Demo identity is denied (constant, read-only).
// The owner account cannot be deleted here (admin.js handleDeleteUser also
// rejects OWNER_ID).
//
// Security properties:
//   - owner: 'self' — the session resolves to the requesting user; a member
//     can never delete another member's account (non-enumerating 403).
//   - Re-auth gate: the access code in the body must match the resolved user.
//     A stolen session token alone cannot destroy the account.
//   - Demo is denied by the policy layer (deny: ['demo']).
//   - The cascade is idempotent (a second call on a deleted user resolves to
//     a 401 because the sessions are gone).
//   - Audit event carries emailHash (no PII).
async function handleDeleteAccount(body, req) {
  // SEC-7.1 (#338): the identity action is routed through the shared policy
  // layer (`auth:deleteAccount`, principal scoped to the session's own user).
  const resolved = await enforce(req, 'auth:deleteAccount')
  if (resolved.error) return resolved.error

  const user = resolved.user

  // The owner account cannot be deleted through the self-serve path (the admin
  // handleDeleteUser also rejects OWNER_ID). This is a defense-in-depth check
  // on top of the policy layer — the owner's session role is 'admin', and
  // auth:deleteAccount does not require 'admin', so the owner would never reach
  // here via the auth endpoint. But guard it anyway.
  if (user.id === OWNER_ID) {
    return json(403, { error: 'Not authorized.', code: 'FORBIDDEN' })
  }

  // Re-auth gate (SEC-7.2.x): the member must supply their access code as a
  // confirmation step. This prevents an account-takeover from silently
  // destroying another member's account and prevents accidental mass deletion.
  const code = String(body.code || '').trim()
  if (!code) {
    return json(400, { error: 'Re-authentication required. Provide your access code.', code: 'REAUTH_REQUIRED' })
  }

  // Verify the code against the resolved user. We look up the user by code
  // and check that the returned user id matches the session user id — this
  // is non-enumerating (a wrong code gets the same 403 as a wrong user).
  const codeUser = await findUserByCode(code.toUpperCase())
  if (!codeUser || codeUser.id !== user.id) {
    logAudit('auth.delete_account_failed', { reason: 'reauth_failed', userId: user.id, emailHash: emailHash(user.email) })
    return json(403, { error: 'Re-authentication failed. Check your access code and try again.', code: 'REAUTH_FAILED' })
  }

  // Run the same cascade as admin handleDeleteUser: reviews, feedback,
  // collection stores, user record, then sessions. The cascade is idempotent
  // — a second call on a deleted user resolves to a 401 (sessions are gone).
  await deleteMemberReviews(user.id)
  await deleteMemberFeedback(user.id)
  await deleteUserCollections(user.id)
  await removeUserRecord(user.id)
  await deleteAllForUser(user.id)

  logAudit('user.self_delete', { userId: user.id, emailHash: emailHash(user.email) })
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
  // bounds a single inbox being hammered. SEC-7.4.x (#383): routed through
  // rateLimitGuard; per-IP limiter gets an anonymous burstScope.
  const ip = clientIp(req)
  if (ip) {
    const byIp = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'auth:magiclink:ip',
      limit: MAGIC_LINK_IP_LIMIT,
      identity: ip,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope: anomalyScope('rlx:auth:magiclink:ip', ip),
    })
    if (byIp) return byIp
  }
  const byEmail = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'auth:magiclink:email',
    limit: MAGIC_LINK_EMAIL_LIMIT,
    identity: normEmail,
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  if (byEmail) return byEmail

  // M3 (S8, #54): FAIL CLOSED. In production the mail key is REQUIRED — check
  // BEFORE issuing a token or recording a request, so a misconfigured prod can
  // never mint a sign-in link (which would let an attacker rotate a member's
  // code for any email). Dev keeps the no-op mailer + devLink echo below.
  if (!isDevEmailMode()) {
    if (!isMailConfigured()) {
      return json(503, { error: "Sign-in email isn't configured yet — try again shortly.", code: 'MAIL_NOT_CONFIGURED' })
    }
    // CWE-287 (#184): the signing secret is required too. With no secret (prod
    // missing both RUNOUT_MAGIC_LINK_SECRET and RUNOUT_ADMIN_KEY) no token can
    // ever be valid, so refuse before minting/emailing a dead, forgeable link.
    if (!isMagicLinkConfigured()) {
      return json(503, { error: "Sign-in links aren't configured yet — try again shortly.", code: 'MAGIC_LINK_NOT_CONFIGURED' })
    }
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

async function handleVerifyMagicLink(body, req) {
  // SEC-1.7 (#182): rate-limit the VERIFY path (previously unthrottled) before
  // any token parsing — the real brute-force surface for magic links. Per-IP
  // bounds one source hammering tokens; a legitimate click is 1-2 requests.
  // SEC-7.4.x (#383): routed through rateLimitGuard; per-IP limiter gets an
  // anonymous burstScope.
  const ip = clientIp(req)
  if (ip) {
    const byIp = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'auth:magiclink:verify:ip',
      limit: MAGIC_LINK_VERIFY_IP_LIMIT,
      identity: ip,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope: anomalyScope('rlx:auth:magiclink:verify:ip', ip),
    })
    if (byIp) return byIp
  }

  // CWE-287/346 (#184): FAIL CLOSED when no magic-link secret is configured
  // (e.g. a prod deploy missing both RUNOUT_MAGIC_LINK_SECRET and
  // RUNOUT_ADMIN_KEY — ADMIN_KEY is '' there). Refuse BEFORE any token parsing
  // or verification, so a token forged with an empty HMAC key can never rotate
  // a member's code or mint a session. Mirrors the M3 gate in
  // requestMagicLink / mailer.js.
  if (!isMagicLinkConfigured()) {
    return json(503, { error: "Sign-in links aren't configured yet — try again shortly.", code: 'MAGIC_LINK_NOT_CONFIGURED' })
  }

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
      // SEC-3.2 (#195): cap the JSON body before parsing so a runaway client
      // can't buffer/bloat a function with an oversized action payload. A
      // body over the cap → 413; malformed JSON → 400. The auth actions are
      // tiny, so the default 64 KB cap is more than enough.
      const { value: body, error } = await readJsonBody(req)
      if (error) return error
      if (body.action === 'request') return handleRequest(body)
      if (body.action === 'login') return handleLogin(body, req)
      if (body.action === 'requestMagicLink') return handleRequestMagicLink(body, req)
      if (body.action === 'verifyMagicLink') return handleVerifyMagicLink(body, req)
      if (body.action === 'logout') return handleLogout(req)
      if (body.action === 'logoutAll') return handleLogoutAll(req)
      if (body.action === 'deleteAccount') return handleDeleteAccount(body, req)
      return json(400, { error: 'Unknown action.' })
    }

    if (req.method === 'GET') {
      return handleMe(req)
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}
