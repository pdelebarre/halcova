// policy.js — centralized object- and property-level authorization
// (SEC-7.1, #338). One predicate-table layer every function endpoint routes
// its authorization through, replacing scattered inline ownership/admin/demo
// checks.
//
// Layering (kept deliberately thin — the policy table states WHAT an action
// is allowed to do, the function still owns input validation, rate limiting
// and plan gates):
//   - The PRINCIPAL is derived ONLY from the authenticated session
//     (resolveSession / requireAdmin). A browser-supplied owner/tenant/id is
//     never used as authority — the store / repo rows are owner-scoped by the
//     resolved session's user.id, exactly as before.
//   - The POLICY table maps an action → rule. Each rule carries at most:
//       owner: 'self'    -> the action operates on the principal's OWN scope
//                            (e.g. an item in the caller's per-user store).
//       owner: 'target'  -> the action targets a specific object the caller
//                            may or may not own. enforce() needs `ownsTarget`
//                            to decide. A non-owner gets the same FORBIDDEN
//                            whether the target exists or not (non-enumerating,
//                            SEC-7.1) — callers pass a cached `target` lookup.
//       requires: 'admin'  -> the resolved principal's role must be 'admin'.
//       deny: ['demo']     -> a denied role (e.g. the read-only demo identity)
//                             is rejected with the rule's `denyCode`.
//       allowOverride: ['admin'] -> ownership is bypassed for these roles.
//       login/payment/billing walls are handled by the caller (they pre-date
//       this table); their shape is normalized through the shared
//       nonEnumerating responder below.
//
// Non-enumeration (SEC-7.1): object-by-id authorization failures use ONE
// stable `FORBIDDEN` response regardless of whether the target "doesn't exist"
// or "exists but isn't yours". 401 is always an authentication failure, 403 is
// always an authorization failure. The functions deliberately stop returning a
// distinguishable 404 for cross-tenant object-by-id access.

import { resolveSession, requireAdmin } from './session-auth'
import { json } from './security'

// The shared non-enumerating 403. `error`/`code` are fixed so a client can
// never distinguish "resource doesn't exist" from "exists but isn't yours".
export const FORBIDDEN = { error: 'Not authorized.', code: 'FORBIDDEN' }
export function forbidden(headers) {
  return json(403, FORBIDDEN, headers)
}

// The shared 401 on an unauthenticated/invalid session.
export const UNAUTHORIZED = { error: 'Not signed in.', code: 'NOT_SIGNED_IN' }
export function unauthorized(headers) {
  return json(401, UNAUTHORIZED, headers)
}

// The predicate table (action -> rule). Actions are grouped by surface. Only
// actions listed here are routed through enforce(); actions the caller keeps
// fully custom (payment pre-auth / webhook HMAC) still normalize their
// rejection shape via forbidden()/unauthorized().
export const POLICY = {
  // --- auth identity (principal scoped to the session's own user) ---------
  'auth:me': {},
  'auth:logout': { owner: 'self' },
  'auth:logoutAll': { owner: 'self' },
  'auth:deleteAccount': { owner: 'self', deny: ['demo'] },

  // --- admin (/admin, /seed-demo) ------------------------------------------
  'admin:*': { requires: 'admin' },
  'seed-demo:seed': { requires: 'admin' },

  // --- collection items (per-user store; owner is 'self' by construction) --
  'collection:item:read': { owner: 'self' },
  'collection:item:create': { owner: 'self', deny: ['demo'] },
  'collection:item:update': { owner: 'self', deny: ['demo'] },
  'collection:item:delete': { owner: 'self', deny: ['demo'] },

  // --- collection type registry (FEAT-6.2 #315) -----------------------------
  // READ-ONLY metadata for any authenticated caller. The registry is
  // server-authoritative (ADR-0020 §2 dec 6): the client can READ type
  // definitions (labels/icons/capabilities) but can never supply or override
  // one — there is no write action here and the function never accepts a type
  // definition in the request body.
  'collection:type:read': {},

  // --- lending (targeted at an item the caller must own) --------------------
  // The owner/admin CAN lend their own items (they have real collections).
  // Demo is read-only (also caught by the feature gate) — claimed here too.
  'lending:item:lend': { owner: 'self', deny: ['demo'] },
  'lending:item:return': { owner: 'self', deny: ['demo'] },

  // --- private assets (SEC-7.3 #340; per-user store, owner is 'self') --------
  // Demo is read-only: it has no private assets, and can never sign/delete.
  'asset:list': { owner: 'self' },
  'asset:sign': { owner: 'self', deny: ['demo'] },
  'asset:delete': { owner: 'self', deny: ['demo'] },

  // --- reviews (shared; DELETE is owner-or-admin) ---------------------------
  'review:read': {},
  'review:create': { deny: ['demo'] },
  'review:delete': { owner: 'target', allowOverride: ['admin'], deny: ['demo'] },

  // --- feedback (member submit vs admin inbox) ------------------------------
  'feedback:create': { deny: ['demo'] },
  'feedback:moderate': { requires: 'admin' },

  // --- lookups (any authenticated caller; demo stays ungated) ----------------
  'lookup:read': {},

  // --- payment / billing (kept custom; normalized shape) ---------------------
  'payment:checkout': { preAuth: true },
  'payment:status': { capability: true },
  'payment:portal': { owner: 'self' },
  'billing:webhook': { webhook: true },
}

// Collapse an existing session-auth Response into the stable 401/403 shape
// (the messages inside remain, but the status/code contract is normalized so
// object-by-id access can never enumerate). Used when a caller resolves the
// session itself and just needs the responder normalized.
export function normalizeReject(response) {
  if (!response) return response
  const status = response.status || 500
  if (status === 401) return json(401, { error: 'Not signed in.', code: 'NOT_SIGNED_IN' }, response.headers)
  if (status === 403) return forbidden(response.headers)
  return response
}

// The core authorize: resolve the session (or admin), then apply the rule.
//
//   enforce(req, 'collection:item:read')
//   enforce(req, 'admin:*')
//   enforce(req, 'review:delete', { ownsTarget: (user) => bool })  // target scope
//
// Returns { user, session, token, principal } on success or
// { error: <Response> } on failure. `principle`, `denyCode`, `denyMessage` may
// override the rule's default deny response (e.g. DEMO_READONLY / FEATURE_OFF).
export async function enforce(req, action, {
  ownsTarget,             // async (user) => boolean, required when rule.owner==='target'
  requiresAdmin = false,  // force requires:'admin' (for admin:* fallthrough)
  denyCode,
  denyMessage,
} = {}) {
  const rule = POLICY[action] || {}
  const admin = rule.requires === 'admin' || requiresAdmin || action.startsWith('admin:')

  // Resolve the session (or require admin) FIRST — the principal is always
  // derived from the authenticated session, never the request.
  let resolved
  if (admin) {
    resolved = await requireAdmin(req)
  } else {
    resolved = await resolveSession(req)
  }
  if (resolved.error) return { error: normalizeReject(resolved.error) }
  const user = resolved.user

  // deny list (e.g. the read-only demo identity).
  const denied = rule.deny || []
  if (denied.includes(user.role)) {
    return { error: json(403, { error: denyMessage || 'Not allowed.', code: denyCode || 'FORBIDDEN' }) }
  }

  // owner 'target' — the caller must own the target object (admin override).
  // The principal is passed to ownsTarget so the caller can compare the target's
  // owner against the session-derived user (never a browser-supplied id/role).
  if (rule.owner === 'target' && !(rule.allowOverride || []).includes(user.role)) {
    const owned = await ownsTarget(user)
    if (!owned) return { error: forbidden() }
  }

  return resolved
}
