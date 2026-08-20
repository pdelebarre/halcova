# ADR-0020: Generic collection domain model

- **Status:** Proposed — pending specialist review (Data, Offline, Security)
- **Date:** 2026-08-20
- **Related epic:** #313
- **Related issues:** #314 (this model), #315 (type registry/capabilities), #316 (Books & Records migration), #317 (metadata provider adapter layer), #318 (ownership lifecycle/completion), #160/#161 (M3 sync, OCC & conflict matrix)
- **Builds on:** ADR-0003 (generic collection domain), ADR-0002 (scaling / Phase 1 PostgreSQL target model), ADR-0010 (API contract & validation), ADR-0014 (data migration & backward compatibility), ADR-0019 (platform foundation & offline-first), ADR-0017 (lookup resilience & provider fallbacks), ADR-0004 (security & privacy by design), ADR-0011 (offline-first & sync)
- **Design gate:** this PR contains **no implementation code**. It is the frozen target domain model that #315/#316/#317 are implemented from.

## Context

ADR-0003 (Accepted) established the generic domain — `CollectionType`, `Collection`,
`CanonicalItem`, `CollectionItem` — plus the guardrail that no new core domain entity
is introduced per collection kind and that type-specific attributes are
schema-validated and never contain authoritative ownership. This ADR **operationalizes**
ADR-0003 into the full, frozen target model required by #314 so that Records and Books
share the platform without special-case domain entities, and so that #315 (registry),
#316 (migration) and #317 (adapters) can be implemented directly from it.

The current legacy representation (`db/migrations/001_init.sql`) is a single `items`
table with `owner_id`, `kind IN ('records','books')` and a `data jsonb` blob that mixes
catalogue identity (title, provider ids, cover, year) with owned-instance state (notes,
wishlist, lending, lendingHistory, pageCount). This conflation is what the generic model
resolves: catalogue identity must be shared and deduplicated, while owned-instance state
is private and per-user.

## Decision

Adopt the following frozen target model. Names below are logical; physical SQL table
names are those already listed in ADR-0002 Phase 1 (`collection_types`, `collections`,
`canonical_items`, `collection_items`, `collection_type_fields`).

### 1. Entities and responsibilities

| Entity | Responsibility | Shared or owned | Tenant scope |
| --- | --- | --- | --- |
| `CollectionType` | Registry definition of a kind: display metadata, field schema, capabilities, provider mappings. | Global registry | Read: all; Write: service/vetted |
| `Collection` | A user's collection of one type. Owns the owned-instance rows and the collection-level policy. | Owned by a user/tenant | `owner_id` |
| `CanonicalItem` | Catalogue identity + reusable, authoritative metadata for one distinct work/object, provider-derived or locally-created. | Shared across users | Global (read-mostly) |
| `CollectionItem` | A user's owned/wanted copy that links a `Collection` to a `CanonicalItem` and carries private instance state. | Owned by a user/tenant | `owner_id` |

This four-entity model is **closed**: no new core domain entity may be added per
collection kind (ADR-0003 guardrail). A future kind (Games, coins, cards, instruments)
is expressed purely as a new `CollectionType` row with a field schema and capability set,
not as a new table or a new top-level domain object.

### 2. `CollectionType`

A registry record describing a kind. Defined in #315, referenced here so the model is
complete.

- `id` — stable slug (e.g. `records`, `books`) that is the API-facing `collectionType`.
  Immutable once referenced.
- `schema_version` — the registry schema version this row conforms to (see §7).
- `field_schema` — the validated, versioned definition of extensible attributes for the
  kind (see §6). Stored as `collection_type_fields` rows (ADR-0002), not free text.
- `capabilities` — the set of capability flags available to this kind (lookup providers,
  barcode, OCR cover, lending, wishlist, valuation, etc.).
- `provider_mappings` — ordered provider list for catalogue lookup, resolved
  server-side per ADR-0017 (primary → fallback → negative cache → circuit breaker).
- `is_public` / classification defaults for the kind (see §9).

Constraints: `collection_type_id` is unique and immutable. Removing or renumbering an
existing `CollectionType.id` is prohibited; it is soft-deprecated only.

### 3. `Collection`

The user-scoped container.

- `id` — `uuid` (server-assigned).
- `owner_id` — server-authoritative tenant/owner id (see §10). Never client-supplied.
- `collection_type_id` — FK to `CollectionType.id`.
- `display_name`, `theme`, `sort_order` — owned presentation preferences.
- `created_at`, `updated_at`, `version` — lifecycle/versioning (see §8).

Uniqueness: exactly one `Collection` per `(owner_id, collection_type_id)`. A user has at
most one collection per kind; creating a second is an upsert/error, never a silent
duplicate.

### 4. `CanonicalItem`

Catalogue identity plus reusable, authoritative metadata.

- `id` — `uuid`, server-assigned, immutable.
- `collection_type_id` — FK to `CollectionType.id`.
- `provider_ids` — a keyed map of provider identifiers that uniquely fingerprint the
  work, e.g. `{ discogsId, mbid }` for records, `{ googleBooksId, openLibraryId, isbn }`
  for books. Provider-payload validation happens in the adapter (ADR-0013/0017) before
  these are written.
- `content_fingerprint` — a stable hash over the canonical core fields, used to dedupe
  locally-created / non-provider items that have no provider id.
- `canonical_attributes` — validated extensible canonical metadata (e.g. genre, style,
  country, label, format, pageCount, description). Schema-validated per the kind's field
  schema (see §6).
- `media` — public cover/asset references (e.g. cover URLs), public and cacheable per
  ADR-0019 §5/§10.
- `source` — provenance marker (`discogs`, `musicbrainz`, `googleBooks`, `openlibrary`,
  `local`, `import`) plus `enrichedAt` (ADR-0017).
- `version`, `created_at`, `updated_at`.

Ownership: a `CanonicalItem` is **not owned** by any user. It is global and
read-mostly; only service identity (provider enrichment, dedup, moderation) may write
it. This is the deduplication layer ADR-0003 calls for.

Uniqueness: at most one `CanonicalItem` per `(collection_type_id, provider_id)` for each
present provider id, enforced via partial unique indexes; and at most one per
`(collection_type_id, content_fingerprint)` when no provider id exists. Merging
duplicates is a service/vetted operation with provenance preserved; the merge must never
rewrite a `CollectionItem` reference (references are by `CanonicalItem.id`).

### 5. `CollectionItem`

The user's owned/wanted copy. This is the only row that may hold authoritative ownership
and private instance state (ADR-0003 guardrail).

- `id` — `uuid`, server-assigned, immutable.
- `collection_id` — FK to `Collection` (which already carries `owner_id`).
- `canonical_item_id` — nullable FK to `CanonicalItem.id`. Nullable to support draft /
  partially-identified items (deferred enrichment, ADR-0017).
- `status` — lifecycle state: `draft` | `active` | `tombstoned` (see §7).
- `owned_attributes` — validated extensible private instance attributes (e.g. notes,
  grading, custom fields). Schema-validated per the kind's field schema; **never**
  authoritative ownership (ownership is `collection.owner_id`).
- `flags` — owned, non-authoritative feature state: `wishlist`, `lending` (+ history),
  `rating`, etc. These are owned-instance data, not catalogue metadata.
- `version` — optimistic-concurrency token (see §8).
- `created_at`, `updated_at`, `tombstoned_at`, `purge_at`.

Uniqueness: `id` is unique. There is **no** hard DB uniqueness on
`(collection_id, canonical_item_id)`: the product allows a user to intentionally own a
second copy / "add anyway" (matches the scanner duplicate behavior in #363). Duplicate
detection is an **advisory** index + UX hint, not a blocking constraint.

### 6. Strongly typed core fields vs validated extensible attributes

Two distinct mechanisms, never blurred:

- **Strongly typed core fields** are the fixed, query-critical, authorization-sensitive
  columns above (`id`, `collection_type_id`, `owner_id`, `status`, `version`,
  `canonical_item_id`, timestamps, provider ids, content fingerprint). These live as
  typed columns so ownership, ordering, uniqueness and RLS are enforced by the database
  (ADR-0002). They are never buried in JSON.
- **Validated extensible attributes** (`canonical_attributes` on `CanonicalItem`,
  `owned_attributes` on `CollectionItem`) are `jsonb` whose shape is governed by the
  `CollectionType.field_schema` and enforced server-side per ADR-0010:
  - unknown/unsafe fields rejected;
  - bounded sizes for body, field, array and nested uploads;
  - attributes are validated before mapping into the domain;
  - imported/metadata/LLM output treated as untrusted (ADR-0010, ADR-0013);
  - extensible attributes are **never** used as authorization or ownership evidence.

The typed-vs-extensible split is what makes a new kind a configuration change rather
than a schema change: the typed surface stays closed, and only the `field_schema` grows.

### 7. Lifecycle, tombstones and deletion

- A `CollectionItem` is created in `draft` (may lack `canonical_item_id`) and moves to
  `active` once identified/confirmed (ADR-0017 deferred enrichment closes this gap).
- Deletion is **soft**: `status = tombstoned`, with `tombstoned_at` stamped. Tombstones
  preserve identity and version so offline mutations and M3 sync/OCC (#160/#161) can
  reconcile a delete against a concurrent edit without silent loss (ADR-0019 Decision 8,
  ADR-0016 rule 12: no offline mutation silently discarded).
- Tombstones are excluded from all normal reads/listing. `purge_at` schedules **hard**
  deletion only after a documented retention window and reconciliation (see §11).
- `Collection` deletion is likewise soft and tenant-scoped; it never deletes
  `CanonicalItem`.
- `CanonicalItem` is never hard-deleted while referenced; it may be tombstoned/merged by
  service identity only.

### 8. IDs, uniqueness, versioning and offline operation identity

- **IDs:** all core rows use server-assigned `uuid`. `CollectionType.id` uses a stable
  immutable slug. Provider ids live inside `CanonicalItem.provider_ids`.
- **Uniqueness:** enforced per §4 (canonical) and §5 (instance). No silent duplication
  of `Collection` per `(owner_id, collection_type_id)`.
- **Versioning:** every owned row (`Collection`, `CollectionItem`) carries a monotonic
  `version` (optimistic-concurrency token) for M3 OCC (#161). Server compares versions on
  update; a mismatch returns a conflict error rather than silently overwriting.
- **Offline operation identity:** every offline mutation carries a deterministic client
  operation id (`op_id`) recorded durably (ADR-0011/0019 Decision 7, ADR-0016). The
  server processes each `op_id` idempotently and re-authorizes it at sync time. `op_id`
  is not a domain identifier; it is sync plumbing.
- **Enrichment merge:** enrichment (`CanonicalItem`/adapter writes, ADR-0017) only fills
  missing fields and never clobbers a user's edit (ADR-0016 invariant, ADR-0019
  Decision 8).

### 9. Security and privacy classification

Classification is mapped to the model explicitly (ADR-0004: public representations are
explicit allowlists; private by default).

| Class | Example fields | Where | Handling |
| --- | --- | --- | --- |
| **Public** | `CanonicalItem` title, cover/media, provider ids, public description | `CanonicalItem` (not owned) | Explicit allowlist when serialized; may enter the service-worker cache **only** as public catalog metadata (ADR-0019 §5). |
| **Private** | `CollectionItem` `owned_attributes`, `flags` (notes, lending, wishlist, grading), `Collection` prefs, `owner_id`, `op_id` | owned rows | Never in generic SW cache; owner-scoped reads/writes only; signed-access for private assets (ADR-0019 §11). |
| **Sensitive** | audit identifiers, tenant/owner identity in logs/telemetry | derived | ADR-0019 §12 / ADR-0016 rule 14 carve-out: security audit trails may log `userId`; operational/analytics telemetry must not. |

- Authorization is object- and property-level, deriving ownership from authenticated
  context (ADR-0004, ADR-0010): `CanonicalItem` reads are allowlisted public metadata;
  `Collection`/`CollectionItem` reads/writes are `owner_id`-scoped.
- `owner_id` is server-derived; client-supplied owner/tenant ids are never authoritative
  (ADR-0010, ADR-0019 §6, M1 tenancy/RLS).
- Public representations are built from an explicit allowlist; sensitive owned fields
  are omitted unless the caller is the owner with appropriate scope.

### 10. Tenancy and RLS

- `Collection` and `CollectionItem` are fully tenant-scoped on `owner_id` (and via
  `Collection.owner_id` for `CollectionItem`), matching the existing RLS model
  (`db/rls/008_rls.sql`) — extend it to the new tables with
  `USING (owner_id = current_setting('app.tenant_id', true))` and the matching
  `WITH CHECK`. A missing tenant variable fails closed (no rows).
- `CanonicalItem` is global but read-mostly: SELECT is open to authenticated callers for
  the public allowlist; writes are restricted to service identity (SECURITY DEFINER /
  least-privilege role). It is never `owner_id`-scoped because it is not owned.
- `CollectionType` is global registry data, read-open, write-restricted.
- The existing owner-scoped indexes pattern (ADR-0002) is preserved: `(owner_id,
  collection_type_id)` on `Collection`, `(collection_id, status)` and advisory
  `(collection_id, canonical_item_id)` on `CollectionItem`, and partial unique indexes
  for canonical dedup (§4).
- Binding RLS requires the least-privilege role + `FORCE ROW LEVEL SECURITY` hardening
  tracked as an M3 prerequisite (#165 per M3 state).

### 11. Migration impact and rollback strategy (mandatory)

Migration follows ADR-0014 (additive, phased, idempotent) and ADR-0002 Phase 1. The
legacy `items` table and its API contract remain fully supported until reconciliation
and retirement approval.

**Phased plan (mapped to #316):**

1. **Seed registry:** create `CollectionType` rows for `records` and `books` with their
   field schemas, capabilities and provider mappings (#315). Idempotent.
2. **Backfill `Collection`:** create one `Collection` per existing distinct
   `(owner_id, kind)` from `items`. Idempotent upsert by `(owner_id, collection_type_id)`.
3. **Backfill `CanonicalItem`:** dedupe catalogue identity across the existing
   `items.data` by provider id / content fingerprint. Never loses provenance.
4. **Backfill `CollectionItem`:** map each legacy `items` row to
   `(collection_id, canonical_item_id?, owned_attributes, flags, status, version)`.
   Stable mapping from legacy id to new id is retained until retirement (ADR-0014).
5. **Dual/read-through compatibility:** legacy reads keep working; new-model writes
   propagate to both representations until parity is proven.
6. **Reconciliation (per ADR-0014):** for each migration stage, count source vs target;
   compare stable identifiers; compare ownership; compare collection membership; compare
   important user-visible fields; sample media references; verify duplicate-detection;
   run authorization/negative tests against migrated data.
7. **Retirement:** only after reconciliation proves no loss/duplication/ownership change
   is the legacy representation retired, with a documented backup/retention period.

**Reversibility / rollback (mandatory evidence):**

- Every migration is **additive and idempotent**; re-running is a no-op.
- **Rollback = reverse mapping, not irreversible delete.** Because the legacy `items`
  table and its envelope are preserved and each `CollectionItem` retains a stable mapping
  to its legacy id (ADR-0014), any migration stage can be rolled back by regenerating the
  legacy envelope from the new model. This is the primary rollback mechanism and requires
  the reconciliation evidence above.
- **Irreversibility boundary (explicit):** hard-deleting the legacy `items` table / its
  Blob stores, and hard-purging `CollectionItem` tombstones, are irreversible. They may
  only occur after (a) reconciliation PASS, (b) documented backup/retention, and
  (c) an approved retirement ADR/decision. No silent ownership change, data deletion or
  user-visible semantic change (ADR-0014).
- Migration never alters ownership, never deletes user data and never changes
  user-visible semantics (ADR-0014).

### 12. Consequences

**Positive:** Records and Books share one closed domain without special-case entities;
canonical metadata is deduplicated and reused; owned-instance data stays private and
tenant-scoped; new kinds are registry configuration; offline sync, OCC and conflict
handling (#160/#161) have the version/tombstone/op-id machinery they need; tenancy and
privacy classification are explicit at the model layer.

**Negative:** migration to the generic model is a controlled, phased effort with
temporary dual representation and mandatory reconciliation; extensible attributes add a
server-side schema-validation responsibility; `CanonicalItem` is a global, read-mostly
table requiring service-identity write control and careful RLS.

### 13. Rejected alternatives

- **Per-kind tables/entities (no `CanonicalItem`):** rejected by ADR-0003; multiplies
  code/API/UX and defeats the guardrail.
- **One fully untyped JSON document per item:** rejected by ADR-0003; ownership,
  uniqueness and core queries require typed, constrained invariants.
- **Merging canonical and owned state into a single `CollectionItem`:** rejected; this
  is exactly the legacy `items.data` conflation this model removes, and it would break
  canonical dedup and force owned-instance data to be public/shared.
- **Hard-unique `(collection_id, canonical_item_id)`:** rejected; would prevent
  intentional second copies / "add anyway" (#363).
- **CanonicalItem owned by the creating user:** rejected; it is catalogue identity that
  must be shared and service-controlled.

### 14. Security / privacy gate

This model maps privacy classification explicitly (§9), keeps owned-instance data
tenant-scoped (§10), derives ownership server-side (§10, ADR-0010/0019), and treats
extensible attributes and provider payloads as untrusted input (§6, ADR-0010/0013).
Approval requires independent Data Architect, Offline Architect and Security Auditor
review; no M3 implementation (#315/#316/#317) may proceed before this ADR is accepted.

### 15. Follow-up linkage (for implementers)

- **#315 (registry):** implement §2 `CollectionType` + `collection_type_fields` schema
  and the capability registry from §2/§6.
- **#316 (migration):** implement §11 phased, idempotent migration with reconciliation
  and reverse-mapping rollback.
- **#317 (adapters):** implement provider normalization into `CanonicalItem`
  `provider_ids` / `canonical_attributes` per §4 and ADR-0017, preserving the envelope.
- **#318 (ownership lifecycle):** implement §7 lifecycle/tombstone and §8 version/OCC.
- **#160/#161 (sync):** implement §8 op-id, idempotency, OCC and the complete conflict
  matrix on top of this model.
