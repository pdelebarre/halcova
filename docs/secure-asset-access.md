# Secure Images, Documents & Signed Asset Access — design & readiness (SEC-7.3, #340)

- **Epic:** M1 security-foundation (#337)
- **Scope:** readiness / pattern-establishment for private-asset access
  (`authorization-before-signed-access`). There is **no user upload feature, no
  signed-URL mechanism, and no photo/document DTO today** — this ticket lays the
  seam, the policy, and the threat model the file-heavy feature will build on.
- **Tracked:** GitHub #340. Whole Stack Architect design is binding; this doc
  records the implemented surface + the deferred policy for the #340 exit gate.

This document is the canonical reference for how Runout will secure user
uploaded images/documents. It records **what is implemented now** (the
readiness seam, reversible) and **what is deferred** (the file-heavy feature +
the upload/pipeline policy), so the two are never conflated.

---

## 1. Asset threat model (implemented controls + deferred policy)

Private assets are user-controlled binaries. Even though nothing is uploaded
yet, the threat model drives the seam below, so the architecture is correct
before bytes exist.

| # | Threat | Control (implemented) | Control (deferred — see §5) |
|---|--------|-----------------------|------------------------------|
| T1 | **BOLA / IDOR** — a member addresses another member's asset id | Per-user store namespace (`assets-<userId>`) derived from the session; `asset:sign`/`asset:delete` owner-self + non-enumerating 403 | — |
| T2 | **Cross-tenant addressing** — forged client owner/tenant/asset id | Store/principal always from the session user.id; `ownerId === user.id` defense-in-depth on the envelope | — |
| T3 | **Signed-URL forgery / replay** | Stateless HMAC `ASSET_SIGN_SECRET` (fail-closed, CWE-287/346); constant-time compare (CWE-347); scope-bound to `{assetId, tenantId, action, expiresAt}` | — |
| T4 | **Signed-URL longevity** | Bounded TTL (10-min default, 15-min hard cap); expires at/after bound | Per-object revocation on demand is explicitly **not** retroactive (see §4) |
| T5 | **Oversized / wrong-type upload** | — (no upload endpoint) | Server-side size cap (`RUNOUT_ASSET_MAX_BYTES`, 5 MiB) + content-type allowlist + magic-byte/sha256 integrity |
| T6 | **Malware / it's-a-hideout** | — | AV scanning, image re-encode / EXIF strip, moderation pipeline (deferred to file-heavy feature) |
| T7 | **Client-cached private bytes** | Signed URLs are returned on demand only; the PWA SW has **no** runtime rule for asset URLs (ADR-0016 rule 10 — confirmed no-op today) | — |
| T8 | **Abuse / quota** (per-identity+IP) | — | Register `asset:sign`/`asset:upload` quotas in the #337 abuse table (see §6) |

Threat-model posture: the security boundary is **"authorize-before-signed-
access"** — a signed URL is minted only *after* the caller is authorized to the
specific asset, using the caller's own resolved identity (never a body-supplied
owner). Private asset references (C6/private-assets class) never reach a
non-owner DTO, and signed URLs are never embedded in collection DTOs.

---

## 2. Storage topology (implemented)

Private assets live in **per-user private Blobs stores**, mirroring the
collection stores (`storeNameFor` in `_shared/users.js`):

```
assets-<userId>            # private per-tenant asset namespace (per user)
  └─ asset:<uuid>          # one envelope blob per asset
```

- **Namespace:** `assetStoreName(userId)` → `assets-<userId>`
  (`_shared/asset-store.js`). Keyed **only** on the resolved session user.id —
  never a client-supplied owner id.
- **Envelope:** the asset blob is a JSON envelope
  `{ assetId, ownerId, mimeType, size, createdAt, … }`. The **raw bytes / upload
  payload are deferred** (§5) — today the seam works on the envelope and raw
  byte primitives (`setAsset` accepts raw bytes) so the future pipeline can add
  integrity without a migration.
- **Vendor-agnostic seam:** `_shared/asset-store.js` exposes a minimal
  `list / get / set / delete / getStore` interface over Blobs. A future SaaS
  object store (S3/GCS/R2) can be swapped in **without any function-logic
  change** — the endpoint talks only to the seam.
- **Store isolation:** the endpoint (`asset.js`) obtains the store from the
  session user.id and only ever reads/writes that namespace. Deleting a member
  should also clear their `assets-<userId>` store (extend `deleteUserCollections`
  when the upload feature lands).

---

## 3. Signed-URL contract (implemented)

`_shared/asset-sign.js` implements a **stateless HMAC signed-URL helper** that
mirrors `magic-link.js`:

```
signed = base64url(payload) "." base64url(HMAC-SHA256(ASSET_SIGN_SECRET, payload))
payload = { aid: assetId, tid: tenantId, a: 'read', x: expiresAtMs }
```

Properties:

- **Fail-closed** (CWE-287/346): when `ASSET_SIGN_SECRET` (Netlify env) is
  unset, `isAssetSignConfigured()` is false and issuance/verification refuse —
  never a default-open empty-key HMAC. The `asset:sign` action returns
  `503 SIGNING_UNAVAILABLE` in that state.
- **Bounded expiry:** `ASSET_SIGN_TTL_MS` = 10 min default
  (`ASSET_SIGN_TTL_MINUTES`), hard-capped at 15 min
  (`ASSET_SIGN_HARD_CAP_MS`). A token whose bound is reached or passed
  (`now >= expiresAt`) is `TOKEN_EXPIRED`.
- **Constant-time verify** (`timingSafeEqual`) + canonical-base64url rejection
  (CWE-347), mirroring `magic-link.js`.
- **Scope binding:** verification binds to `{ assetId, tenantId, action,
  expiresAt }`; changing any breaks the HMAC. `action` is exactly `read` —
  single-object, read-only semantics.
- **Content policy constants:** `RUNOUT_ASSET_MAX_BYTES` (5 MiB default),
  `ACCEPTED_ASSET_TYPES` (`image/jpeg`, `image/png`, `image/webp`,
  `application/pdf`).

### Endpoint (`netlify/functions/asset.js`)

All actions are POST, `Authorization: Bearer <sessionToken>`:

| Action | Policy | Behaviour |
|--------|--------|-----------|
| `sign` `{ action:'sign', assetId }` | `asset:sign` (owner-self, deny demo) | resolve store from SESSION user.id → look up `asset:<uuid>` in **my** store → missing **or** `ownerId !== user.id` → uniform `403 FORBIDDEN` → 200 `{ url, expiresAt, mimeType }` |
| `list` | `asset:list` (owner-self) | 200 `{ assets: [{ assetId, mimeType, size, createdAt }] }` — caller's own only |
| `delete` | `asset:delete` (owner-self, deny demo) | delete **only** from my store; non-owner → same `403 FORBIDDEN` |

- **Non-enumeration (SEC-7.1):** "asset doesn't exist" and "asset exists but
  isn't yours" return the **same** `403 FORBIDDEN`, so a client can't enumerate.
- **DTO rule:** asset **ids** may appear in the owner's item DTO; **signed URLs
  only ever come from `asset:sign`** — never embedded in collection DTOs.
- **Auth:** every action resolves the session via `enforce()` (`policy.js`)
  before any store work — no unsigned path.

---

## 4. Signed-read revocation nuance (documented — accepted control)

**Session revocation does NOT retroactively revoke an already-issued 10-minute
signed URL.** This is an accepted trade-off:

- The URL is single-object, read-only, and bounded to ≤15 minutes.
- Revolving the *session* stops *new* URL issuance immediately (the principal
  no longer resolves), but a URL already handed out keeps its bounded window
  (the serving layer needs no session to validate the HMAC — that is the point
  of stateless signing).
- **Mitigations in force:** bounded TTL, single-object read-only scope,
  fail-closed secret. If a future feature needs instant revocation, the serving
  layer can add a per-asset "revokedAt" check or rotate `ASSET_SIGN_SECRET`
  (invalidates all outstanding URLs) — both deferred.

---

## 5. Deferred upload & content policy (documented, NOT implemented)

The **file-heavy feature** will implement, and this contract binds it:

1. **Upload endpoint** (`asset:upload`) — authorized, rate-limited, size- and
   type-enforced before anything touches the store.
2. **Server-side enforcement:** reject `> RUNOUT_ASSET_MAX_BYTES` (413) and any
   content type outside `ACCEPTED_ASSET_TYPES`.
3. **Integrity:** magic-byte sniffing and `sha256` of the stored bytes; the
   envelope carries `sha256` + `size` so the serving layer can verify.
4. **Pipeline:** AV scanning, image re-encode / EXIF strip, moderation —
   deferred to the file-heavy feature; the blob seam already accepts raw bytes
   so this stays a pure add-on.
5. **Serving layer:** the function that returns the bytes validates the signed
   URL with `verifyAssetToken()` (scope + expiry) before streaming — the
   readiness `asset:sign` returns the token so that layer has a single verifier.

> **IMPORTANT — do not implement §5 in #340.** It is recorded as the contract
> for the next ticket. The only code landed here is the reversible readiness
> seam (§2–§3) + policy/tests.

---

## 6. Abuse / quota registration (#337 abuse table)

Per-identity + IP quotas for the asset surface are recorded here for the #337
abuse table and will be **wired when the upload endpoint exists**:

- `asset:sign` — per identity (user id) + IP: bound minting so a runaway client
  can't churn signed URLs. Rate limit bucket under `runout-rate-limits`.
- `asset:upload` — per identity + IP with a **total-storage quota** (bytes +
  count) when the upload feature ships; delete frees quota.
- `asset:list` / `asset:delete` — low, per-user; list is owner-scoped read.

---

## 7. PWA / service-worker interaction (confirmed no-op)

ADR-0016 **rule 10**: private collection responses (and, by extension, signed
private assets) must **not** be stored in generic service-worker HTTP caches.

- Today there is **no runtime SW caching rule** for any asset/signed URL (none
  exist), so this is a **confirmed no-op** — the readiness seam adds no SW rule.
- When serving layer / upload lands, add an explicit **network-only** rule for
  the signed-asset route so signed URLs are never cached by the SW.

---

## 8. Implemented vs deferred — summary

### Implemented (this ticket, reversible)
- `netlify/functions/_shared/asset-store.js` — per-user private-asset Blobs
  seam (`assetStoreName`, `getAssetStore`, `list/get/set/delete`).
- `netlify/functions/_shared/asset-sign.js` — stateless HMAC signed-URL helper
  (fail-closed, bounded TTL, scope binding, CWE-347 canonical check).
- `netlify/functions/asset.js` — `sign` / `list` / `delete` endpoint.
- `_shared/policy.js` — `asset:list` / `asset:sign` / `asset:delete` actions.
- `_shared/visibility.js` + `_shared/filter.js` — `PRIVATE_ASSET_FIELDS`
  (`assets/receipts/attachments/photoRefs`) hardening; explicit non-owner
  strip guard.
- Negative tests: `asset-sign.test.js`, `asset.test.js`, `policy.test.js`
  (BOLA, cross-tenant, expiry/scope, fail-closed, demo deny, private-ref leak).
- This design doc.

### Deferred (documented contract only — next ticket)
- Upload endpoint + server-side size/type enforcement + magic-byte/sha256
  integrity.
- AV / re-encode / EXIF-strip / moderation pipeline.
- Signed-read revocation (instant per-asset revoke / secret rotation).
- `asset:sign`/`asset:upload` quota wiring + member asset-store cleanup on
  user delete.
- The serving layer that validates the token and streams bytes.

---

## 9. Exit-gate evidence checklist

- [x] Threat model + storage config review documented (this doc).
- [x] Policy actions added + negative tests green.
- [x] BOLA / cross-tenant / expiry / scope / fail-closed / demo / DTO-leak
      negatives pass.
- [x] `npm run lint`, `npm test`, `npm run build`, coverage (see the #340
      branch commit for exact numbers).
- [ ] Security Auditor review (blocking).
- [ ] API Contract Reviewer review.
- [ ] Tester sign-off.
