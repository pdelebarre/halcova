# Subtasks — Epic: "Found it here" — geolocated wishlist sightings

Paste each section below into its own GitHub issue. Link every issue to the
epic (`marketing/epic-wishlist-sightings.md`) and add the suggested labels.
Work on branch `feat/wishlist-sightings` (off `main`, never `main`) — see the
`feature-branching` skill.

Suggested labels: `enhancement` (the epic itself), `backend`, `frontend`,
`i18n`, `tests`, `security`, `marketing`.

---

## P0 — Product & privacy decisions + ADR

**Labels:** `enhancement` · **Owner:** Project Manager + Whole Stack Architect +
Security Auditor · **Branch:** `feat/wishlist-sightings`

**Body**

Resolve the open decisions in epic §3/§5/§10 before implementation starts
(mirror Gamification Phase 0, epic #43). Record a short ADR under `docs/adr/`
(0004-wishlist-sightings.md).

1. **Grid-cell size** for community obfuscation (recommend ≈0.5–1 km) — pick,
   document the rounding function (cell = deterministic function of lat/lng).
2. **Reverse-geocoding vs user-typed place name** — MVP default: member types
   the shop name (zero external geocoders, best privacy). Decide whether any
   geocoder is used at all.
3. **Map display provider** — Leaflet + OSM tiles (self-hosted, no key, but
   runtime cost) vs Mapbox key vs external link (`maps.google.com/?q=lat,lng`)
   only. Pick the v1 option.
4. **Community matching level** — release-level (`discogsId`) vs
   pressing-level (`barcode`) for "someone found this here".
5. **Gating** — `features.sightings` admin flag (the `lending`/`games` pattern)
   vs a plan perk (free vs paid community feature). Confirm demo is read-only.
6. **Scope of the "found near you" line** — wishlist only, or also on scans of
   owned items.
7. **Legal check** — consent copy (GDPR/CCPA) for capturing + sharing coarse
   location; confirm delete-cascade requirements.

**Exit:** ADR signed off; every decision tagged *decided* (with the chosen
option) so T1–T10 can proceed without re-litigating privacy.

---

## T1 — Sightings DB schema + Postgres repository — issue #101

**Labels:** `backend` · **Owner:** Netlify Backend · **Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

Add the first-class Postgres table for community sightings, mirroring the
`reviews` feature (migration `006_feedback.sql` pattern → `007_sightings.sql`).

1. `db/migrations/007_sightings.sql` — `sightings` table from epic §5: `id`,
   `kind` (`records`|`books`), `discogs_id`, `google_books_id`, `barcode`,
   `grid_cell` (NOT NULL), `contributor_hash` (opaque, one-way), `sighted_at`,
   `created_at`; indexes `(kind, discogs_id)`, `(kind, google_books_id)`,
   `(kind, barcode)`, `(kind, grid_cell, created_at)`; a UNIQUE guard so one
   contributor counts once per release per cell. Must run on real Postgres
   **and** pg-mem.
2. `netlify/functions/_shared/repositories/sightings-repo.js` —
   `addSighting`, `countNearby(kind, sourceId, gridCells)`, `listRecent`,
   `deleteSighting`, `deleteByContributor(contributorHash)` (delete-cascade).
   Allow-list kind; junk input → no-op, never 500. Server-assigned uuid.
3. Tests in `sightings-repo.test.js` against pg-mem with the real
   `007_sightings.sql` (mirror `reviews-repo.test.js`).

**Acceptance criteria**
- [ ] Migration applies cleanly via `npm run db:migrate` and on pg-mem.
- [ ] Repo methods covered by unit tests (`npm test` green).
- [ ] Only coarse grid cells + opaque contributor hashes are stored — never
      exact member coordinates or identity.

**DoD:** lint + test pass. Consult the `netlify-collection` and `testing` skills.

---

## T2 — Sightings Blobs fallback store + repository seam — issue #97

**Labels:** `backend` · **Owner:** Netlify Backend · **Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

Blobs fallback so community sightings work when `DATABASE_URL` is unset or
Postgres is down (mirror `reviews-blob.js` + `repository.js`).

1. `netlify/functions/_shared/sightings-blob.js` — shared store
   `runout-sightings`; layout `sg:<kind>:<sourceId>` → `{ counts: {
   <gridCell>: n }, updatedAt }` plus an enumeration key; `addSighting`,
   `countNearby`, `listRecent`, `deleteSighting`, `deleteByContributor`. Same
   allow-lists as T1. Note the documented lost-update race (Blobs has no
   transactions — ADR-0001); Postgres is the system of record.
2. `netlify/functions/_shared/repository.js` — expose `sightings` on the
   repository object (`postgres` → T1 repo, `blobs` → this store), matching
   `users`/`items`/`lookupCache`/`reviews`/`feedback`.
3. Tests in `sightings-blob.test.js` with the in-memory blobs-shaped store
   (mirror `reviews-blob.test.js`): add, count, deleteByContributor.

**Acceptance criteria**
- [ ] Blobs impl mirrors the T1 API surface so the function can switch paths.
- [ ] Seam wired with no changes to existing callers.
- [ ] Unit tests green.

**DoD:** lint + test pass. Consult the `netlify-collection` skill.

---

## T3 — Sightings function: POST / GET nearby / DELETE + admin moderation — issue #100

**Labels:** `backend`, `security` · **Owner:** Netlify Backend +
Security Auditor · **Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

New `netlify/functions/sightings.js` (mirror the conventions of `reviews.js`:
`json()`, `bearer()`, `authorize`, store-agnostic dispatcher, rate-limit).

| Method | Auth | Body / params | Returns |
| --- | --- | --- | --- |
| POST | Bearer code (member, `features.sightings`) | `{ kind, sourceId, barcode?, lat, lng, place? }` | `201 { gridCell }` |
| GET | Bearer code (member) | `?kind=&sourceId=&lat=&lng=` | `200 { nearby: [ { gridCell, count } ], total }` |
| DELETE | Bearer code (author) or admin key | `?id=` | `204` |
| GET | admin key | `?kind=&gridCell=` | admin moderation list |

Guards:
- **Obfuscate server-side**: `lat`/`lng` are rounded to the P0 grid cell
  *before* storage; only the cell (never precise coords) is returned to other
  members. Personal `place` names are **never** stored in the shared store.
- **Identity**: store only `contributor_hash` (one-way hash of a per-user
  salt); never the access code, user id, name, or email. `authorNameFor`-style
  display names are **not** used here — counts only.
- Rate-limit with `_shared/rate-limit.js` (e.g. 20/hr per user; 429 +
  `Retry-After`). Validate kind; junk input never 500s.
- Demo (`user.role === 'demo'`) → 403 `DEMO_READONLY` on POST/DELETE; demo may
  read nearby counts.
- Endpoint tests (mirror `admin.test.js`): member POST 201 + cell rounded,
  member GET counts only (no identity, no precise coords), author DELETE 204,
  non-author DELETE 403, admin moderation, 401/403, rate-limit 429, junk input
  never 500s.

**Acceptance criteria**
- [ ] Community reads return **counts per grid cell only** — verified no
      identity or precise coordinates leak (Security Auditor).
- [ ] All operations work against Blobs **and** Postgres backends.
- [ ] Rate-limit enforced; abuse cannot inflate counts.

**DoD:** lint + test pass. Consult the `netlify-collection` + `auth-access`
skills.

---

## T4 — Client API `src/api/sightings.js` — issue #99

**Labels:** `frontend` · **Owner:** Front End Developer ·
**Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

Client module mirroring `src/api/collection.js` / `src/api/reviews.js`:
`pinSighting({ kind, sourceId, barcode, lat, lng, place })`,
`getNearby({ kind, sourceId, lat, lng })`, `deleteSighting(id)`. Bearer header
from the session (`getAccessCode()`), error `code` passthrough
(`PLAN_LIMIT`-style), offline/non-200 handled gracefully (friendly error,
never throws uncaught).

Tests with mocked `fetch` (mirror `collection.test.js`): success shapes, 4xx/5xx
mapping, missing code → `NO_TOKEN`-style code, invalid JSON.

**Acceptance criteria**
- [ ] All functions call the right endpoint/method/headers.
- [ ] Errors carry a `code` and never throw uncaught.
- [ ] Tests green.

**DoD:** lint + test pass. Consult the `testing` skill.

---

## T5 — Pin where you saw it: capture on the wishlist-add path — issue #111

**Labels:** `frontend` · **Owner:** Front End Developer ·
**Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

From the scan-result "Add to wishlist" action (`ScanResult.jsx`
`onAddToWishlist` → `CollectionView.jsx` `handleAddToWishlist`), add an
**optional** "Pin where you saw it" step:

1. **New `src/components/SightingPinModal.jsx`** (+ CSS, bottom-sheet pattern):
   explains in plain copy what is stored and who can see it (consent), a
   **"Use my location"** button (browser `navigator.geolocation`,
   coarse/approximate by default), a **"Type the place name"** alternative
   (no geolocation needed — fully private), and a **"Skip"** that saves the
   wishlist item with no sighting.
2. On save: store `item.sighting = { lat?, lng?, place, at }` on the wishlist
   item (collection add already accepts extra fields) **and**, when the member
   consented to community sharing, fire `pinSighting` (T4). Community POST
   failures degrade gracefully (queued/ignored — the personal memory is kept).
3. **No dark-screen**: geolocation denied / timeout / offline → friendly
   fallback copy; every field optional-chained.
4. Add EN baseline `sightings.pin.*` keys to `src/i18n/locales/en.js` + catalog
   `.copy.sightings` (full copy pass in T8).
5. Component tests (Testing Library): pin with location, pin with typed place,
   skip, denied-permission fallback, community POST failure degrades.

**Acceptance criteria**
- [ ] A member can add to wishlist with a pinned sighting in < 3 taps, or with
      none at all.
- [ ] Consent copy shown before any geolocation use.
- [ ] No uncaught errors / dark screen on any pin path (incl. offline).
- [ ] Tests green; EN baseline keys in place for T8.

**DoD:** lint + test + build pass. Consult the `testing` + `ergonomics-review`
skills.

---

## T6 — "Where did I see this?" — sighting on wishlist rows + detail — issue #113

**Labels:** `frontend` · **Owner:** Front End Developer ·
**Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

Surface the personal sighting so the member can answer "where did I see this?":

1. **`src/components/WishlistSheet.jsx`** — wishlist rows with `item.sighting`
   show a small line: *"Seen at <place> on <date>"* (falls back to a nearby
   map link when there's no typed place). Defensive — a malformed `sighting`
   never crashes the row.
2. **Detail sheet** — the sighting block in `AlbumDetail.jsx` / `BookDetail.jsx`
   (behind `features.sightings`): place, date, **open on map** link
   (`maps.google.com/?q=lat,lng` or P0's chosen provider), and **Edit /
   Remove sighting** actions (update or clear `item.sighting`; if it was
   shared, `deleteSighting` on T4 so community counts drop too).
3. All copy via catalog `.copy.sightings` + i18n; guarded renders.
4. Tests: row shows sighting, no sighting → nothing, malformed sighting → no
   crash, edit/remove persists + removes community contribution.

**Acceptance criteria**
- [ ] A member who pinned a sighting can later see where/when they saw it.
- [ ] Removing the sighting also removes the community contribution.
- [ ] Tests green.

**DoD:** lint + test + build pass. Consult the `testing` skill.

---

## T7 — Community "N members found this near you" — issue #114

**Labels:** `frontend` · **Owner:** Front End Developer ·
**Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

Community value: on a wishlist item (or scan result, per P0 scope) with a
nearby release match, show *"N members found this near you"* — a **count only**,
computed client-side from `getNearby` (T4) using the member's own coarse
location.

1. Fetch nearby counts for the release (by `discogsId`/`googleBooksId`/`barcode`)
   when the member has granted coarse location, else hide the line (no prompt
   spam).
2. Tap → a small sheet listing the matching grid cells with counts (still no
   identity, no precise coords, no shop names) and a **"Found it too?"** action
   that opens the pin flow (T5).
3. Guarded renders everywhere; offline → hide gracefully.
4. Copy via `catalog.copy.sightings.nearby.*` + i18n.
5. Tests: shows count for a nearby match, hides when no match / no location,
   malformed response never crashes.

**Acceptance criteria**
- [ ] A member sees the anonymous nearby count for a release others have pinned.
- [ ] Zero identity or precise-location leakage in the UI.
- [ ] Tests green.

**DoD:** lint + test + build pass. Consult the `testing` + `ergonomics-review`
skills.

---

## T8 — Localize the sightings UI (7 locales) — issue #115

**Labels:** `i18n` · **Owner:** Front End Developer · **Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

Fill `sightings.*` in `src/i18n/locales/{fr,nl,pt-BR,de,es,it}.js` from the EN
baseline (T5) using the glossary in `marketing/localization-dictionary.md`.
Keys to cover: pin modal title/subtitle, consent + "what we store / who sees
it" wording, location / typed-place / skip buttons, "Seen at {place} on
{date}", open-on-map, edit/remove sighting, "N members found this near you",
"Found it too?", error + offline fallbacks, admin moderation labels.

Tone: wry, warm collector voice (`marketing/copy-kit-halcova.md`). All strings
`[VALIDATE]` with native testers before the branch ships (per
`marketing/localization-plan.md`). Glossary notes for privacy-consent phrasing
(e.g. "near you" is intentionally vague — keep it vague in every locale).

**Acceptance criteria**
- [ ] All 6 non-EN locales complete; EN fallback for anything missing.
- [ ] No hardcoded user-facing strings in the sightings components.
- [ ] Dictionaries validated by native speakers (can run in parallel with T10).

**DoD:** lint + test pass.

---

## T9 — Marketing: positioning, consent copy, launch beat + KPIs — issue #116

**Labels:** `marketing` · **Owner:** Marketing Manager ·
**Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

Package the feature for members and for launch.

1. **Copy bank** — `marketing/campaign-copy-bank.md`: "never forget where you
   saw that record/book" (personal memory) + "people like you found this near
   you" (community) angles; consent/privacy one-liners; the exact EN strings for
   the pin modal and nearby line (hand to Front End Developer; don't edit app
   code).
2. **Launch beat** — a social/newsletter moment (X · Instagram · WhatsApp ·
   newsletter) aligned with `campaign-viral-launch.md`, telling members how to
   pin a sighting and what "N members found this near you" means; entries in the
   copy bank.
3. **Tracking** — funnel events + KPI table from epic §8 (`sighting_pin`,
   `sighting_pin_view`, `sighting_nearby_seen`, `sighting_nearby_tap`),
   opt-in-only via `src/utils/track.js`; UTM params for the launch channel mix.
4. **Privacy messaging** — short "we only share a vague 'near you', never who
   or exactly where" explainer for the site/landing page and the app consent
   copy (feeds T5's consent copy).

**Acceptance criteria**
- [ ] Copy bank + launch beat drafted; EN sightings strings handed off.
- [ ] KPI/measurement plan documented in epic §8.
- [ ] No invented metrics or promises (no "instant alerts" or exact-location
      claims).

---

## T10 — QA + security/privacy review + DoD gates — issue #112

**Labels:** `tests`, `security` · **Owner:** Tester + Security Auditor ·
**Branch:** `feat/wishlist-sightings`

**Body**

Part of epic **#96 — "Found it here": geolocated wishlist sightings**.

End-to-end verification of the whole feature before merge.

1. Full flow on dev: member scans in a shop → adds to wishlist → pins a
   sighting (location and typed place) → sees "Seen at …" later → edits /
   removes it; second member viewing the same release sees the anonymous count.
   Repeat on the Blobs backend (no `DATABASE_URL`) and Postgres.
2. Edge cases: geolocation denied / timeout / offline; community POST failure;
   junk kind/sourceId/coords; rapid-fire PINs (rate-limit 429); member tries
   admin endpoints (403); demo POST → `DEMO_READONLY`.
3. **Privacy review**: verify the shared store holds only grid cells + opaque
   hashes — no precise coords, no identity, no shop names; member-delete
   cascade removes personal + community sightings (Blobs + Postgres).
4. Confirm consent copy shows before any geolocation use; no dark-screen /
   uncaught-error regression anywhere in the flow.
5. Gates: `npm run lint`, `npm test`, `npm run build` all green.

**Acceptance criteria**
- [ ] Every checklist item passes on both backends.
- [ ] Zero identity / precise-location leakage (Security Auditor sign-off).
- [ ] No dark-screen regression.

DoD: see epic §11.
