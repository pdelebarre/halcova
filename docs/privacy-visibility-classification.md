# Privacy, Visibility & Data Classification Model

> **Epic:** M1 security-foundation (#337) — **Issue:** #339 (SEC-7.2)
> **Owner:** Netlify Backend agent (server-side / PWA layer)
> **Status:** Implemented (documentation + explicit per-role DTO allowlists)

This document defines Runout's privacy and visibility model: the visibility-state
enum, the data-classification matrix, the per-resource **per-role DTO allowlists**
(the single source of truth for what leaves the server), the server-side
enforcement points, and the **data retention / purge** table.

It is the **documentation deliverable** of #339. It deliberately does **not**
implement self-serve export, self-serve deletion, or retention TTLs — those are
scoped to follow-up tickets (see [Deferred work](#deferred-self-serve-export-and-deletion)).

---

## 1. Enforcement invariant (must be preserved)

> **Authorization decisions** (can a principal read/write object X?) live in
> `netlify/functions/_shared/policy.js` **rules only**.
>
> **What fields appear in a DTO** live in the allowlist registry
> `netlify/functions/_shared/visibility.js` + `filter.js`, and in the
> handler-controlled surfaces that route through them.
>
> A rule change never bypasses the filter; a filter change never bypasses the
> rule. **Both layers are required for any shared/public surface.**

This invariant is stated in code at the top of `visibility.js` and `filter.js`
so it cannot drift.

---

## 2. Visibility-state model

`VISIBILITY` enum (defined in `visibility.js`):

| Value       | Reachable today | Effective resolution (`resolveVisibility`) |
|-------------|-----------------|--------------------------------------------|
| `PRIVATE`   | Yes             | `private`                                   |
| `OWNER`     | Yes             | `owner`                                     |
| `FOLLOWERS` | **Reserved**    | **`private` (fails closed)**                |
| `GROUP`     | **Reserved**    | **`private` (fails closed)**                |
| `PUBLIC`    | Yes (to authenticated) | `public`                            |

- The client **never** supplies its own visibility. Effective visibility is
  computed **server-side only**, via `resolveVisibility`.
- `FOLLOWERS` / `GROUP` are reserved enum values from a future social
  milestone. They **fail closed** to `private` until that milestone ships — a
  reserved value can never widen an object's exposure.

---

## 3. Data classification matrix (ADR-0004 / ADR-0007)

Default-private for all sensitive ownership info.

| Class | Data | Default reach |
|-------|------|---------------|
| **C1** | Public catalog metadata: `title, year, label, genre, style, country, formatType, coverImage, barcode, discogsId, googleBooksId, artists, tracklist, released, authorsList, subtitle, series, mainCategory, snippet, catno, formatRaw, isbn, pageCount, description` | May reach public surfaces |
| **C2** | Ownership: `id, dateAdded, wishlist` | Owner / admin |
| **C3** | `price` | PRIVATE (strip non-owner) |
| **C4** | `location` | PRIVATE (strip) |
| **C5** | `serial` | PRIVATE (strip) |
| **C6** | `receipts` | PRIVATE (strip) |
| **C7** | `notes` (owner+admin) / `adminNote` (admin-only, also unwritable) | Non-public |
| **C8** | `lending` / `lendingHistory` incl. `borrower.contact` | Owner/admin; `borrower.contact` stripped |
| **C9** | Review `rating, body, authorName` | Public to authenticated |
| **C10** | Feedback | Author + admin only |
| **C11** | Account identity (`name, email`) | Private self+admin; email never in shared surfaces |
| **C12** | Credentials (`code`, `code_hash`, tokens, admin key, Stripe ids) | **NEVER exported** |
| **C13** | Telemetry / audit | Internal, redacted |
| **C14** | Demo curated data | Demo identity only, read-only |

---

## 4. Per-resource public-DTO allowlists

The per-role allowlist registry lives in `visibility.js`; `filter.js` routes
objects through it (`filterFor` / `filterMany`). For each resource the DTO must
route through an explicit allowlist.

### 4.1 `item` (records / books)

| Principal | DTO fields |
|-----------|-----------|
| Owner / admin / self (`own: true`) | Full item object |
| Non-owner (`own: false`) | C1 + `id` + `dateAdded, wishlist`, plus `lending` / `lendingHistory` with `borrower.contact` stripped |

Elevated from a "strip known private set" to a **documented per-role
allowlist** (`ITEM_PUBLIC_FIELDS` + `ITEM_NON_OWNER_RETAINED`). In practice the
collection store is per-user, so every real item DTO is owner-owned
(`own: true`); the non-owner path is a **defense-in-depth** guarantee.

### 4.2 `review`

| Principal | DTO fields |
|-----------|-----------|
| Author (`own: true`) / admin | `rating, body, authorName, kind, sourceId, createdAt, updatedAt` + `authorId` |
| Non-author | Same **minus `authorId`** (stripped) |

`status` is never in the public list (the list returns only `published` rows);
it only appears via `mine` (the caller's own entry, `own: true`). Public
allowlist: `REVIEW_PUBLIC_FIELDS` (C9).

### 4.3 `lending`

The lending response is always an **owned** item (owner/admin only, per the
lending policy). There is **no public lending DTO**; lending reuses the `item`
filter (so `borrower.contact` is stripped on any non-owner shaping).

### 4.4 `feedback`

| Principal / surface | DTO fields |
|---------------------|-----------|
| Author-facing POST response (`filterFor(user, 'feedback', item)`) | C10 fields, **never** `adminNote` |
| Admin inbox / triage (`admin: true`) | C10 fields **including** `adminNote` |

`adminNote` is admin-only (C7) and is enforced by the allowlist — it never
appears in the author-facing submission response. **New in #339:** `feedback`
was added to the filter registry.

### 4.5 `user` (`publicUser`)

`code`, `code_hash`, and the three Stripe billing ids (`stripeCustomerId`,
`stripeSubscriptionId`, `stripeCheckoutSessionId`) — class C12 — are **never**
in a durable user DTO. The transient code minted on `approve` / `rotate` is a
controlled one-time out-of-band delivery and is intentionally **not** part of a
durable DTO.

### 4.6 `admin` views

Admin surfaces are **admin-only, never public**; embedded user objects still
pass through `publicUser`.

### 4.7 `demo`

Demo is curated, read-only data (C14); it has **no private fields** and is
treated as `own: true`-visible metadata.

---

## 5. Server-side enforcement points

| Surface | Authorization (policy.js) | Field shaping (visibility/filter.js) |
|---------|---------------------------|--------------------------------------|
| Collection items | `collection:item:*` (owner `self`, demo denied writes) | `filterFor(..., 'item', i, { own: true })` in `collection.js` / `collection-postgres.js` |
| Lending | `lending:item:*` (owner `self`) | `filterFor(..., 'item', updated, { own: true })` in `lending.js` |
| Reviews GET | `review:read` (any authenticated) | `filterMany(..., 'review', ...)` strips non-author `authorId` in `reviews.js` |
| Reviews POST/DELETE | `review:create` / `review:delete` (owner-or-admin) | Author's own review returned unchanged (`own` by construction) |
| Feedback POST | `feedback:create` (deny demo) | `filterFor(..., 'feedback', item)` strips `adminNote` (author view) |
| Feedback inbox/triage | `feedback:moderate` (admin) | `filterFor(..., 'feedback', item, { admin: true })` keeps `adminNote` |
| Any user DTO | session / admin resolution | `publicUser` (C12 strip) |

---

## 6. Retention / purge table

> **#339 scoping:** this table **documents** retention/purge ownership. It does
> **not** implement TTLs or automated purge. Every row below is owned by a
> follow-up cleanup/retention milestone.

| Store / table | Data class | Retention / purge owner |
|---------------|------------|-------------------------|
| **Netlify Blobs** — `runout-collection` / `runout-library` (owner legacy), `collection-<userId>-<kind>` (members) | C1–C8, C14 | Deleted on `deleteUserCollections` (admin delete-user cascade); otherwise retained until member deletion |
| **Postgres** — `items` (ADR-0002 Phase 1) | C1–C8 | Purged on member delete-user cascade (parity with Blobs); otherwise retained |
| **Netlify Blobs** — `runout-identity` (`user:*`, `request:*`) | C11–C12 (hashed) | Request rows: ephemeral until decided; user rows purged on delete-user cascade |
| **Postgres** — identity (`code_hash`, sessions) | C11–C12 | Purged on delete-user cascade |
| **Lookup / list / cover caches** (`lookup-cache`, `list-cache`, cover cache) | C1 (public) | TTL / size-bounded; no private data cached |
| **Sessions** (`runout-sessions` / Postgres sessions) | C11–C12 (token) | Revoked on logout / disable / delete; short-lived, revalidated on load |
| **Magic links** | C11 | 30-minute expiry; one-time use |
| **Audit logs** | C13 | Internal, retention by ops/security policy |
| **Feedback** (`feedback` Postgres table / `runout-feedback` Blobs) | C10, C7 (adminNote) | Purged on delete-user cascade (`deleteByAuthor`); triaged status retained |
| **Reviews** (`reviews` table / `runout-reviews` Blobs) | C9 | Purged on delete-user cascade (`deleteMemberReviews`); no TTL |

---

## 7. Deferred self-serve export and deletion

The acceptance criterion for #339 is that export/delete/retention behaviour is
**documented**. Self-serve features are **not** implemented in this issue.

### Follow-up ticket 1 — Self-serve member data export (GDPR-style)

- **Scope:** a member can download their own data (their collection items,
  reviews, feedback, profile) in a portable format.
- **Shape:** `owner: 'self'` scope only; a **signed, short-lived** download
  URL/object (no long-lived public URLs).
- **Needs review before implementation:** API Contract Reviewer + Data
  Architect + Security Auditor.

### Follow-up ticket 2 — Self-serve account deletion

- **Scope:** a member can delete their own account.
- **Shape:** the same cascade as the admin `handleDeleteUser` (remove user row,
  sessions, collection stores, reviews, feedback), gated by a **re-auth**
  challenge.
- **Needs review before implementation:** API Contract Reviewer + Data
  Architect + Security Auditor.

---

## 8. Tests (SEC-7.2 negative suite)

Server-side negative coverage lives in:

- `netlify/functions/_shared/policy.test.js` — filter/allowlist unit negatives
  (**N3** full C3–C8 strip incl. `lendingHistory[].borrower.contact`, **N4**
  non-author review `authorId`, **N7** feedback author vs admin view, **N9**
  user credentials never exported) + visibility-state registry.
- `netlify/functions/_shared/feedback.test.js` — **N7** author POST response
  never carries `adminNote` (handler level).
- `netlify/functions/_shared/tenant-isolation.test.js` — **N1** cross-tenant
  item access 403, **N6** non-admin feedback inbox 403, **N11** demo write
  denied, plus the #338 private-field negatives.
- `netlify/functions/_shared/admin.test.js` — **N13** delete-user cascade
  (reviews, feedback, sessions, collections) verified unchanged and idempotent.
