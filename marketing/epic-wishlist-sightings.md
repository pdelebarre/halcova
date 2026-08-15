# Epic — "Found it here": geolocated wishlist sightings

> Parent epic for the **wishlist sightings** feature (branch `feat/wishlist-sightings`,
> off `main`, never `main`). Subtask issue bodies in
> `marketing/epic-wishlist-sightings-subtasks.md`.
>
> Grounded in: `docs/functional.md`, `docs/technical.md`, `src/catalog.js`,
> `src/CollectionView.jsx`, `src/components/ScanResult.jsx`,
> `src/components/WishlistSheet.jsx`, the `reviews` feature (shared-data
> precedent), and ADR-0002/ADR-0003.

## 1. Why

The wishlist already exists and is framed around the shop: the catalog copy says
*"Your wishlist is empty — scan something in a shop and add it here."* Members
scan a barcode in a record shop, market, or bookshop, and add the item as an
**unowned want** (`wishlist: true`, kept separate from the owned crate/shelf).

Two real problems today:

1. **"Where did I see this?"** — a wishlist row has no location. A member who
   adds five things across three shops on a Saturday can't remember which shop
   had the mint copy of *Blue Train* a week later.
2. **No community value from scans** — the app is a private, per-user catalog.
   The act of *seeing* a wanted item in the wild (a genuinely useful local
   signal for other collectors) is discarded.

This epic adds **optional geolocation to a wishlist scan**: when a member adds
an item to their wishlist they can *pin where they saw it*. That pin:
- answers their own "where did I see this item?" question later, and
- (opt-in, privacy-safe) tells *other members nearby* that someone found this
  release there — a first, gentle community feature.

## 2. Scope

### In scope (v1)
- **Pin on wishlist add** — from the scan-result "Add to wishlist" path, an
  optional **"Pin where you saw it"** step: browser geolocation (coarse by
  default), an optional **shop/place name** the member types themselves, saved
  as `item.sighting` on their own wishlist row.
- **Personal memory** — wishlist rows + detail show *"Seen at <place> on
  <date>"* with a link to open the location on a map. Editable / removable.
- **Community sightings (opt-in)** — when a member pins a sighting, an
  **anonymized, coarse** contribution is written to a shared sightings store,
  keyed by release. Other members viewing the same release (in wishlist or a
  scan result) see *"N members found this near you"* — a **count only**, never
  who, never exact coordinates.
- **Auth + abuse protection** — every call authorized (Bearer code / admin
  key), rate-limited, member-delete cascades sightings.
- **Feature-gated** — `features.sightings` per user (admin-granted, owner on by
  default, off for demo writes) — the `lending`/`games` pattern.
- **Localized** — copy via `catalog.copy.sightings` + i18n across the 7 locales
  (EN/FR/NL/PT-BR/DE/ES/IT).

### Out of scope (v1 — follow-ups)
- Real-time "someone is here right now" or live maps of other users.
- Photos of the shop / shelf shots attached to a sighting.
- Notifications ("a member near you found <album>").
- Friend networks / identities behind sightings (privacy model doesn't assume
  them — see Gamification Phase 3 gate, epic #43).
- Reverse-geocoding to auto-name the shop **unless** P0 picks a privacy-safe
  provider (default recommendation: member types the place name).

## 3. Privacy & consent (the critical section)

Geolocation is personal data (GDPR/CCPA-relevant). Non-negotiables for this epic:

- **Opt-in per sighting, never on by default.** The browser permission prompt is
  required, and the in-app copy explains exactly what is stored and who can see
  it. A member can add to their wishlist with **no** location — the pin is
  always a separate, optional action.
- **Community visibility is coarse and anonymous.** Shared sightings store only
  a grid cell (≈0.5–1 km, `[VALIDATE]` size) — never precise coordinates of a
  member, never their name/code/email. UI shows counts ("3 members found this
  near you"), **never** "Philippe found this at <shop>".
- **Contributor identity** — store only an opaque, non-reversible contributor
  hash (or nothing beyond the count) in the shared store so a sighting can't be
  attributed. Personal detail (`item.sighting` with exact coords + place name)
  stays in the member's own per-user store and is never served to others.
- **Delete = delete.** Removing a wishlist item or deleting a member removes
  their personal sighting and their contribution to the shared counts (Blobs +
  Postgres cascades).
- **No third-party geocoding by default.** Sending coordinates to a geocoder is
  itself a privacy + dependency decision — P0 decides; the MVP default is
  user-typed place names, zero external location services.
- **Demo is read-only** for sightings writes (like every other write path).
- **Secrets**: never log/return access codes, the admin key, or exact member
  coordinates. Security Auditor signs off.

## 4. Architecture (mirrors `reviews` — the shared-data precedent)

`reviews` is the established pattern for a **shared, cross-user** store in this
codebase (shared `runout-reviews` blob / `reviews` Postgres table, `authorize`
from `_shared/collection-store.js`, rate-limited, Postgres = system of record
with Blobs fallback). Sightings reuse the same skeleton:

- **Personal sighting** — `item.sighting = { lat, lng, place?, at }` embedded on
  the member's own wishlist item (collection store). No server change for
  reads; the collection PUT patch already accepts arbitrary fields. This is the
  "where did I see this" memory, private to the member.
- **Community sightings** — a new shared store:
  - Blobs: `runout-sightings`, layout `sg:<kind>:<sourceId>` → `{ counts: { <gridCell>: n }, updatedAt }` plus an enumeration key — mirror `reviews-blob.js`.
  - Postgres: `sightings` table (migration), mirror `reviews-repo.js`.
  - New `netlify/functions/sightings.js` dispatcher mirroring `reviews.js`
    (DATABASE_URL ? postgres : blobs).
- **Matching** — sightings keyed by the release: `discogsId` (records) /
  `googleBooksId` (books) primarily, `barcode` fallback. See §5.
- **Auth** — `authorize` from `_shared/collection-store.js`; `features.sightings`
  gate (P0 decides flag vs plan-perk); rate-limiter from `_shared/rate-limit.js`
  (e.g. `RUNOUT_SIGHTINGS_RATE_LIMIT`).
- **Frontend** — new `src/api/sightings.js` client; capture sheet on the
  wishlist-add path; sighting display in `WishlistSheet.jsx` + the detail sheet;
  "found near you" line on wishlist rows / scan results. Copy in
  `catalog.copy.sightings` + i18n. All renders defensive (no error boundary).

## 5. Data model

Shared `sightings` (Postgres):

```
sightings (
  id uuid PK,
  kind text CHECK IN ('records','books'),
  discogs_id text NULL,          -- records
  google_books_id text NULL,     -- books
  barcode text NULL,             -- fallback matcher (normalized digits)
  grid_cell text NOT NULL,       -- obfuscated coarse location bucket
  contributor_hash text NOT NULL,-- opaque, one-way, never the user id directly
  sighted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
)
INDEX (kind, discogs_id), (kind, google_books_id), (kind, barcode),
INDEX (kind, grid_cell, created_at)
UNIQUE (kind, grid_cell, contributor_hash, discogs_id / google_books_id / barcode)  -- one sighting per person per release per cell
```

Personal `item.sighting` (existing item shape, additive):

```
sighting: { lat, lng, place: "Store name", at: <ISO> }   // exact coords stay per-user
```

Matching rule `[VALIDATE]`: **release-level** (`discogsId`) so "different
pressing of the same album" still counts as *someone found this album here*;
for books, `googleBooksId` (+ ISBN fallback). Confirm whether pressing-level
(barcode) should be distinguishable in the UI.

## 6. Offline / PWA

Shops are exactly where connectivity is flaky. Pin capture must work offline:
- The scan + add-to-wishlist already works offline against local state.
- A pinned sighting should queue and sync when back online (the community POST
  can fail gracefully; the personal `item.sighting` saves with the wishlist add).
- No dark-screen on geolocation timeout/denied/offline — friendly fallback copy
  ("You can add a place name instead").

## 7. i18n

EN baseline `sightings.*` in `src/i18n/locales/en.js` + `catalog.copy.sightings`,
then the 7 locales from `marketing/localization-dictionary.md` (glossary notes
for "found it here", "pin", "near you", consent wording). All strings
`[VALIDATE]` with native testers before ship.

## 8. Measurement (Marketing)

First-party, opt-in-only `track.js` events (`sighting_pin`,
`sighting_pin_view`, `sighting_nearby_seen`, `sighting_nearby_tap`,
`sighting_edit`, `sighting_remove`) — no third-party analytics. Funnel + KPIs:

| KPI | Definition | Why |
| --- | --- | --- |
| Pin rate | sightings pinned ÷ wishlist adds | Activation of the feature |
| Conversion lift | wishlist→owned conversion: pinned vs unpinned | Does remembering where drive purchases? (the product's "next buy" story) |
| Community hit rate | scans/wishlist views showing "N found near you" | Community value actually reached |
| Retention | 7/30-day retention: pinners vs non-pinners | Does it make the app a habit? |

## 9. Subtasks

P0 Decisions + ADR · T1 Schema + Postgres repo · T2 Blobs fallback + seam ·
T3 sightings function · T4 Client API · T5 Pin on wishlist add · T6 "Where did I
see this?" · T7 Community "found near you" · T8 i18n · T9 Marketing ·
T10 QA + security review + DoD. See `epic-wishlist-sightings-subtasks.md`.

## 10. Claims needing product validation

- [ ] Grid-cell size for community obfuscation (~0.5–1 km) — pick + document.
- [ ] Reverse-geocoding vs user-typed place name (MVP default: typed).
- [ ] Map display provider (Leaflet+OSM self-hosted vs Mapbox key vs external
      link only) — dependency decision.
- [ ] Release-level vs pressing-level community matching.
- [ ] `features.sightings` flag vs plan perk (paid vs free community feature).
- [ ] Whether "N members found this near you" appears on non-wishlist (owned)
      scans too.
- [ ] Legal review of geolocation consent copy (GDPR/CCPA) before launch copy.

## 11. Definition of done

`npm run lint` / `npm test` / `npm run build` green; `netlify dev` pass — a
member pins a sighting offline in a shop, sees it in their wishlist later
("Seen at …"), and a second member viewing the same release sees the anonymous
count; consent + delete-cascade verified; security review sign-off; nothing
pushed to `main`.
