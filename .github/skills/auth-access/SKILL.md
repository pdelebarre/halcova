---
name: auth-access
description: "Runout's passwordless access-code auth and admin panel: request → approve → RU-XXXX-XXXX-XXXX access code, the admin key (RUNOUT_ADMIN_KEY), per-collection plans (Records and/or Books), disabling/deleting members, the localStorage.runout.session lifecycle, offline session handling, and the security rules (never leak codes or the admin key). Triggers: 'auth', 'access code', 'sign in', 'request access', 'admin panel', 'approve', 'member', 'plan', 'permissions', 'disable', 'delete user', 'RUNOUT_ADMIN_KEY', 'session', 'login', 'logout'."
---
# Auth & Access Codes

Runout has **no passwords**. Access is granted by the site owner (the admin)
through an admin panel; members sign in with a code. This skill covers the
whole auth subsystem.

## When to Use
- Change how people request access, sign in, or get signed out.
- Change the admin panel flow: approve/reject requests, grant collection
  plans, disable or delete members.
- Debug sign-in/session problems, or touch anything that sends/validates an
  access code or the admin key.
- Add auth to a new endpoint (every function request must be authorized).

## Files
| File | Role |
|------|------|
| `netlify/functions/auth.js` | Public: `request`, `login`, `me`, `logout` |
| `netlify/functions/admin.js` | Owner-only: `approve`, `reject`, `updateUser`, `deleteUser`, list |
| `netlify/functions/_shared/auth.js` | `ADMIN_KEY` (fail-closed), `OWNER_ID`, `bearer`, `publicUser`, `generateAccessCode` |
| `netlify/functions/_shared/sessions.js` | Server-managed session tokens: create/validate/revoke (SEC-EPIC-1) |
| `netlify/functions/_shared/session-auth.js` | `resolveSession` / `requireAdmin` — Bearer session → identity / admin gate |
| `netlify/functions/_shared/users.js` | Identity blob store CRUD + `storeNameFor` + `deleteUserCollections` |
| `src/api/auth.js` | Client for the auth + admin functions |
| `src/hooks/useAuth.js` | Session state, login/logout/refresh, startup revalidation |
| `src/utils/session.js` | Persist/read `localStorage.runout.session` (token only, never the code) |
| `src/AuthScreen.jsx`, `src/AdminPanel.jsx` | Sign-in UI + admin UI |

## The Flow
1. **Request**: a visitor calls `requestAccess({ name, email })`. A pending
   `request:<id>` is created (deduped by email while pending).
2. **Approve**: the admin (admin session as Bearer) approves, choosing which
   collections to grant (`{ records, books }`). `generateAccessCode()` mints a
   `RU-XXXX-XXXX-XXXX` code (no I/O/0/1 characters) and a member
   `user:<id>` record is saved; the request is marked `approved`.
3. **Sign in** (SEC-EPIC-1, #176): `login(code)` exchanges the code for a
   server-managed **session token** and persists `{ user, session }` to
   `localStorage.runout.session` — the access code is an exchange credential
   only and is **never** stored client-side (#177). The admin key (and the
   demo code) also sign in as a session.
4. **Authorized calls**: every function call sends
   `Authorization: Bearer <sessionToken>`; functions resolve it via
   `resolveSession()` (validates the session server-side → owner / demo /
   member). The access code → user lookup lives ONLY in the login exchange.
5. **Revalidation**: `useAuth` calls `me()` on startup. A 401/403 clears the
   session; a network failure (offline) keeps the cached session so the shell
   still works. `logout()` revokes the token server-side.

## Roles & Plans
- **Owner** (`OWNER_ID = 'owner'`): signs in with `ADMIN_KEY`; owns all
  collections; uses the legacy blob stores. The owner has **every feature flag
  on by default**: `features: { lending: true, games: true }` (set in
  `profileForCode` in `netlify/functions/auth.js` and `authorize()` in
  `netlify/functions/_shared/collection-store.js`).
- **Member**: `user:{ id, name, email, code, collections: {records, books},
  features: {lending, games}, role: 'member', status: 'active'|'disabled' }`.
  Their collection access is the per-collection plan. Since Scaling Phase 1
  (ADR-0002), Postgres stores only `code_hash` (sha256 of the normalized
  code); the admin "re-reveal a lost code" is now **rotate** (POST `rotate`
  mints a NEW code and returns the new plaintext exactly once). The legacy
  Blobs identity store keeps plaintext during read-through so the cutover is
  reversible (see `docs/technical.md` and `db/README.md`).
- **Demo visitor** (`DEMO_USER` in `_shared/auth.js`): a constant identity with
  `features: {}` — deliberately no feature flags, so demo visitors get no
  lending and no games.
- **Plan enforcement**: `collection.js` returns 403 when a member's
  `collections` doesn't include the requested kind.

## Per-account Features (capability flags)
`features` is a map of per-account capability entitlements the admin grants
per member — NOT a global/compile-time switch. Known flags live in
`KNOWN_FEATURES` in `netlify/functions/admin.js`:
- `lending` — the loan-out dashboard (W3).
- `games` — the gamification "Play" surface: Collection Persona, Progress
  (XP/levels/badges), Crate Quiz, and Shelf Stories (Phase 1 § Play,
  `marketing/gamification/rollout-plan.md`).

Who gets what:
- **Owner**: every flag on (`{ lending: true, games: true }`).
- **Demo visitor**: `{}` — nothing.
- **Member**: granted at **approve** time (the approve sheet has Lending + Games
  switches) and toggled per member from the row's Lending/Games switches
  (`updateUser`).

The client gates on the flag (e.g. `const gamesEnabled = !!user.features?.games`
in `src/App.jsx` → `gamificationEnabled` for `CollectionView`'s Play entry).
`publicUser` passes `features` through untouched, so
`session.user.features.games` is readable client-side.

> ⚠️ **Full-map rule**: the server's `sanitizeFeatures` REBUILDS the whole
> known map from whatever a client sends, so any `approve`/`updateUser` that
> carries `features` must send BOTH flags
> (`{ lending: …, games: … }`). Sending only one flag silently wipes the
> other. The AdminPanel toggles always send the full map (see
> `toggleFeature`/`toggleGames`); keep that invariant in any new callers.

## Security Rules (non-negotiable)
- NEVER log or return access codes, session tokens, or the admin key.
- Always send users to the client through `publicUser` (strips `code` AND
  `code_hash`).
- `RUNOUT_ADMIN_KEY` comes from the Netlify env (or `.env` for `netlify dev`).
  It **fails closed** in production (SEC-1.5, #180): a missing key yields an
  empty key (401/403), never the dev default `runout-dev-admin-key`.
- The access code is an exchange credential ONLY — it must never be persisted
  client-side or accepted as a Bearer. Sessions are revocable/expiring.
- Admin endpoints authorize by the session's `role` (SEC-1.6, #181), never by
  re-checking a bearer string against `ADMIN_KEY`.
- The owner account cannot be edited or deleted via the admin API.
- Deleting a member removes their request, user record, their sessions, AND
  their collection stores (`deleteUserCollections`) — do this atomically,
  never half.
- Auth goes through the shared `bearer()` + `resolveSession`/`requireAdmin`
  helpers — don't hand-parse headers or resolve codes outside login.
- New function endpoints must call `resolveSession`/`requireAdmin` before
  doing any work (see the `netlify-collection` skill).

## Identity Store Layout (`runout-identity` blob store)
```
user:<id>       -> { id, name, email, code, collections, role, status, createdAt }
request:<id>    -> { id, name, email, status: pending|approved|rejected, createdAt }
index:users     -> ordered list of user ids
index:requests  -> ordered list of request ids
```

## Common Tasks
- **Grant/revoke a collection**: `adminUpdateUser({ userId, collections })`.
- **Grant/revoke a feature flag** (lending / games):
  `adminUpdateUser({ userId, features: { lending: …, games: … } })` — always
  send the FULL map (see the full-map rule above). The admin panel's member
  row exposes Lending and Games switches that do this.
- **Disable a member**: `adminUpdateUser({ userId, status: 'disabled' })`
  (their code stops working AND their live sessions are revoked — `me`/`login`
  return 403).
- **Delete a member**: `adminDeleteUser({ userId })` — also wipes their stores.
- **Rotate a lost code**: `POST { action: 'rotate', userId }` to the admin
  function (admin key as Bearer) — it mints a NEW `RU-…` code, stores its
  hash, and returns the new plaintext once so you can hand it to the member.
  The old code stops working immediately. (Pre-Phase-1, this was "re-reveal"
  from plaintext — no longer possible with hashing.)
- **Change code format**: edit `generateAccessCode()` in `_shared/auth.js`
  (keep `RU-` prefix and the no-ambiguous-chars alphabet).

## Verification
- Use `netlify dev` (functions + frontend, usually :8888).
- Walk the full flow in the browser: request access → approve in the admin
  panel → sign in with the code → add an item → reload (persists) → logout.
- Test plan enforcement: a Records-only member must get 403 on the Books
  collection.
- Confirm no secrets in console/network logs.
