---
name: netlify-collection
description: "Work on Runout's collection backend: the Netlify function netlify/functions/collection.js, Netlify Blobs storage (index + item:<id> keys, per-user stores via storeNameFor), auth on every request (Bearer access code / admin key), the client src/api/collection.js, and the optimistic-update hook src/hooks/useCollection.js. Also local dev via netlify dev. Triggers: 'Netlify', 'blobs', 'collection API', 'function', 'storage', 'useCollection', 'optimistic update', 'permissions', 'store'."
---
# Netlify Collection Backend

Runout stores collections server-side in Netlify Blobs, served by a single
Netlify function. There is no database to provision.

## When to Use
- Change the CRUD API, add a field, or add a blob store for a new kind.
- Debug why collection data isn't saving, loading, or is mixed between users.
- Add auth/permission handling to a collection endpoint.

## Architecture
- **Function**: `netlify/functions/collection.js`. A `COLLECTIONS` whitelist
  (`records`, `books`) rejects unknown kinds; `?collection=` picks the kind.
- **Auth first**: every request runs `authorize(req)` before anything else —
  it reads `Authorization: Bearer <sessionToken>` and resolves it via
  `resolveSession` (`_shared/session-auth.js`) to the owner / demo / member
  (SEC-EPIC-1, #176 — the access code is exchange-only at login). 401 on
  missing/unknown/expired/revoked token, 403 on a disabled account or a
  collection the user's plan doesn't include.
- **Per-user stores**: the store name comes from `storeNameFor(user.id,
  collection)` in `netlify/functions/_shared/users.js` — the owner keeps the
  legacy stores (`runout-collection` / `runout-library`); each member gets an
  isolated `collection-<userId>-<kind>` store.
- **Keys**: a single `index` key holds the ordered id list; each item lives at
  `item:<id>` as JSON. `GET` reads the index, then fetches each item in order.
- **Methods**: `GET` (list), `POST` (add; server assigns UUID + `dateAdded`),
  `PUT` (patch by `?id=`), `DELETE` (remove from index + blob). Unknown methods
  → 405; errors → 500 with `{ error }`.
- **Client**: `src/api/collection.js` talks to
  `/.netlify/functions/collection?collection=<kind>` with
  `Authorization: Bearer <code>` (from `getAccessCode()` in
  `src/utils/session.js`) and surfaces `body.error` when present.
- **Hook**: `src/hooks/useCollection.js` wraps it with optimistic updates —
  `update`/`remove` roll back on failure; `add` only mutates after the server
  returns. Exposes `status` (`loading | ready | error`) and `error`.

## Local Development
- `netlify dev` runs the function + frontend together (usually :8888).
  `vite.config.js` proxies `/.netlify/functions` → `:8888` when you use
  `npm run dev` alone.
- `netlify.toml`: build command `npm run build`, publish `dist`, functions dir
  `netlify/functions`, esbuild bundler.
- You need a session to call the API: sign in with the admin key or a member
  access code (see the `auth-access` skill).

## Procedure — New Store or Endpoint
1. Add the new kind to `COLLECTIONS` in `collection.js` and a store mapping in
   `storeNameFor` in `netlify/functions/_shared/users.js` (keep member stores
   isolated per kind).
2. Keep the auth check — add/verify the method *after* `authorize(req)` and the
   per-user `store` lookup; return `json(status, body)`.
3. Mirror it in `src/api/collection.js`; keep error messages parseable.
4. If list semantics change, check `useCollection`'s optimistic
   `add`/`update`/`remove` rollback paths.
5. Test both identities: the owner (admin key, legacy stores) and a member
   (access code, isolated store).

## Gotchas
- Deploy with `netlify deploy --build` — drag-and-drop of `dist` skips
  `netlify/functions`, so the collection API won't work in production.
- Blob stores are scoped per site/environment and not shared across Netlify
  sites.
- Don't rename blob keys without a migration path — existing collections would
  appear empty.
- Never log access codes or the admin key; use `publicUser` before sending a
  user to the client.

## Security requirements (checklist)

Verify before merging a collection-backend change:

- [ ] **Auth on every request** — `authorize(req)` runs before any work on
      every method; no endpoint path bypasses it.
- [ ] **Authorization** — plan enforcement (403) and disabled-member handling
      are covered by negative tests, not just happy-path tests.
- [ ] **Store isolation** — `storeNameFor` keeps member stores isolated per
      kind; no cross-account read/write path (IDOR).
- [ ] **Cache scope** — the collection API is never client-cached (no service
      worker runtime rule) and server caching is limited to the intended
      Netlify Blobs behavior.
- [ ] **Logout cleanup** — signed-out sessions cannot read cached or local
      collection data; revalidation clears stale sessions.
- [ ] **Secrets** — no access codes / admin keys logged or returned; use
      `publicUser`.
