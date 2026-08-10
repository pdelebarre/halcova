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
| `netlify/functions/auth.js` | Public: `request`, `login`, `me` |
| `netlify/functions/admin.js` | Owner-only: `approve`, `reject`, `updateUser`, `deleteUser`, list |
| `netlify/functions/_shared/auth.js` | `ADMIN_KEY`, `OWNER_ID`, `bearer`, `publicUser`, `generateAccessCode` |
| `netlify/functions/_shared/users.js` | Identity blob store CRUD + `storeNameFor` + `deleteUserCollections` |
| `src/api/auth.js` | Client for the auth + admin functions |
| `src/hooks/useAuth.js` | Session state, login/logout/refresh, startup revalidation |
| `src/utils/session.js` | Persist/read `localStorage.runout.session` |
| `src/AuthScreen.jsx`, `src/AdminPanel.jsx` | Sign-in UI + admin UI |

## The Flow
1. **Request**: a visitor calls `requestAccess({ name, email })`. A pending
   `request:<id>` is created (deduped by email while pending).
2. **Approve**: the admin (admin key as Bearer) approves, choosing which
   collections to grant (`{ records, books }`). `generateAccessCode()` mints a
   `RU-XXXX-XXXX-XXXX` code (no I/O/0/1 characters) and a member
   `user:<id>` record is saved; the request is marked `approved`.
3. **Sign in**: `login(code)` exchanges the code for a session and persists
   `{ user, code }` to `localStorage.runout.session`. The admin key also signs
   in as the owner.
4. **Authorized calls**: every function call sends
   `Authorization: Bearer <code>`; functions resolve it via `bearer(req)` and
   `findUserByCode` (or match `ADMIN_KEY` for the owner).
5. **Revalidation**: `useAuth` calls `me()` on startup. A 401/403 clears the
   session; a network failure (offline) keeps the cached session so the shell
   still works.

## Roles & Plans
- **Owner** (`OWNER_ID = 'owner'`): signs in with `ADMIN_KEY`; owns all
  collections; uses the legacy blob stores.
- **Member**: `user:{ id, name, email, code, collections: {records, books},
  role: 'member', status: 'active'|'disabled' }`. Their collection access is
  the per-collection plan. Access codes are stored in plaintext so an admin can
  re-reveal a lost code — a documented trade-off (see `docs/technical.md`).
- **Plan enforcement**: `collection.js` returns 403 when a member's
  `collections` doesn't include the requested kind.

## Security Rules (non-negotiable)
- NEVER log or return access codes or the admin key.
- Always send users to the client through `publicUser` (strips `code`).
- `RUNOUT_ADMIN_KEY` comes from the Netlify env (or `.env` for `netlify dev`).
  The dev fallback `runout-dev-admin-key` must NEVER reach production.
- The owner account cannot be edited or deleted via the admin API.
- Deleting a member removes their request, user record, AND their collection
  stores (`deleteUserCollections`) — do this atomically, never half.
- Auth goes through the shared `bearer()` helper — don't hand-parse headers.
- New function endpoints must call `authorize`/validate the admin key before
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
- **Disable a member**: `adminUpdateUser({ userId, status: 'disabled' })`
  (their code stops working — `me`/`login` return 403).
- **Delete a member**: `adminDeleteUser({ userId })` — also wipes their stores.
- **Reveal a lost code**: read the member record from the identity store
  (codes are stored in plaintext by design).
- **Change code format**: edit `generateAccessCode()` in `_shared/auth.js`
  (keep `RU-` prefix and the no-ambiguous-chars alphabet).

## Verification
- Use `netlify dev` (functions + frontend, usually :8888).
- Walk the full flow in the browser: request access → approve in the admin
  panel → sign in with the code → add an item → reload (persists) → logout.
- Test plan enforcement: a Records-only member must get 403 on the Books
  collection.
- Confirm no secrets in console/network logs.
