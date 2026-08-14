# Gamification — Phase 0 audit (issue #46)

Durable, signed-off deliverable for the gamification epic (#43), produced on
**2026-08-14** from the audit tracked in issue #46. It satisfies the epic's
Phase 0 exit criteria — *data-availability matrix documented; every mechanic
tagged feasible / degraded / deferred* — and de-risks the suite before any UI
work. It is the companion to `marketing/gamification/concept.md`,
`requirements.md`, `copy-bank.md`, and `rollout-plan.md` (Phase 0 in §3).

**Branch:** `feat/gamification-phase0` · **Owner:** Front End Developer
**Status:** signed off (audit + Front End Architect verdicts)
**Basis:** 2026-08-14 audit on issue #46, verified against the code at
`dd00b7d` (main's tip, the base of this branch).

---

## 1. Purpose & scope

**Phase 0 is audit-only and read-only.** It ships no user-facing feature and no
code — it turns the unverified data-model assumptions flagged in
`rollout-plan.md` §2 (F-1…F-3) into a signed-off data-availability matrix, and
resolves every `[VALIDATE]` item that can be resolved without writing a
feature. The goal is to know, *before any implementation*, which mechanics are
feasible client-side, which are degraded for one kind, and which must be
deferred to Phase 2.

Scope:

- Confirm the exact item shape returned by the collection API and held in the
  client collection model — which of `formatType`, `style`, `country`,
  `pageCount`, `notes`, `dateAdded` actually exist per kind (§2).
- Resolve the `[VALIDATE]` items that gate Phase 1 decisions (§3).
- Record the analytics decision for the `gamif_*` funnel (§4).
- Tag every mechanic from `requirements.md` as feasible / degraded / deferred
  (§5).
- Record what this changes (or leaves unchanged) for Phase 1 and the
  rollout-plan open decisions (§6, §7).

Out of scope: any implementation, any new store or API, any UI, and any
commitment of code. Phase 0 ships **zero code** — the first gamification code
commit is the `track()` module, which ships as the **first commit of Phase 1**
(§4), not in Phase 0.

---

## 2. Data-availability matrix

The documented item shape
(`.github/copilot-instructions.md`; `docs/technical.md` §4) **guarantees** only:

> `title`, `year`, `label`, `genre`, `coverImage`, `barcode`,
> `discogsId` / `googleBooksId`

Every other field below was the subject of the audit. All rows were verified by
reading the normalizers (`src/api/discogs.js`, `src/api/books.js`), the catalog
(`src/catalog.js`), the add path (`src/CollectionView.jsx`), and the collection
server (`netlify/functions/collection.js`, `netlify/functions/lending.js`) at
commit `dd00b7d`. **This is a code-level audit — it was not re-verified against
a live deployment or a production dataset.**

| Field | Records | Books | Source (verified) |
| --- | --- | --- | --- |
| `formatType` | ✅ `LP/EP/CD/7"/12"/Cassette/Other` | ⚠️ always `''` | `parseFormatType` (`src/api/discogs.js`); `toBookItem` sets `formatType: ''` (`src/api/books.js`) |
| `style` | ✅ array (`r.style \|\| []`) | ⚠️ always `[]` | `src/api/discogs.js`; `src/api/books.js` |
| `country` | ✅ string (`r.country \|\| ''`) | ⚠️ always `''` | `src/api/discogs.js`; `src/api/books.js` |
| `pageCount` | ❌ absent (never emitted by the record normalizer) | ⚠️ often `''` until the book detail is fetched (`v.pageCount \|\| ''`; `getBookDetail` fills it from `volumeInfo.pageCount`) | `src/api/discogs.js`; `src/api/books.js` |
| `notes` | ✅ `''` at add, then user-edited via PUT (server merges `{...existing, ...patch}`) | ✅ same | `src/CollectionView.jsx` (adds `notes: ''`); `netlify/functions/collection.js` (PUT) |
| `dateAdded` | ✅ ISO string, server-injected on POST (`dateAdded: body.dateAdded \|\| new Date().toISOString()`) | ✅ same | `netlify/functions/collection.js` (POST) |

Guaranteed core (present on both kinds): `title` (as `"Artist - Author -
Title"`), `year`, `label`, `genre` (records: genres; books: categories array),
`coverImage`, `barcode` (records: cleaned barcode; books: ISBN),
`discogsId` / `googleBooksId`.

**Read of the matrix.** The fields the mechanics want are split by kind exactly
as F-1 predicted:

- **Both kinds:** `year`, `genre`, `dateAdded`, `notes`, and the guaranteed
  core are available — the Persona, Quiz, facts-tier Shelf Stories, XP/badges/
  streaks, and the notes reveal all have their data.
- **Records-only:** `formatType`, `style`, `country` — the format mix, Style/
  Sophisticate, and Country mechanics have no books-side data (books fall back
  to `genre` / `year` / category).
- **Books-only:** `pageCount` (and then often only after a detail fetch) —
  page-count mechanics have no records-side data.
- **Neither:** there is no event log, and no artist-releases endpoint (see §3).

---

## 3. `[VALIDATE]` resolutions

Resolved from the 2026-08-14 audit plus the Front End Architect decision. Each
maps to the numbered `[VALIDATE]` items in `requirements.md` §11.

### #1 — Discogs artist discography (Finish-the-discography quest)
**❌ No artist-releases endpoint exists.** The Discogs lookup proxy
(`netlify/functions/discogs.js`) supports exactly three actions —
`searchBarcode`, `searchText`, and `release` — with no artist/releases path.
**Blocks** the "Finish the discography" quest. → **Deferred to Phase 2**: it
needs a new proxy action (`/artists/{id}/releases`) plus the existing shared
Blob-cache behavior and a rate-limit check (Discogs is rate-limited; reuse the
`discogs-cache` store as `requirements.md` §11.1 requires). Netlify Backend
owns confirming the endpoint before Phase 2 (§7).

### #2 — Event log
**❌ There is no event log.** No gameplay ledger exists anywhere in
`src/**` or the functions (verified: nothing writes one). Resolution:
- **"Impulse Buyer" (10 added in a day)** is derivable **client-side** by
  day-bucketing existing items on `dateAdded` — no event log needed.
- **XP/levels/badges/streaks derive idempotently** from current item state +
  timestamps (never incremented in render), which `requirements.md` §7.2
  already requires. No separate gameplay ledger is needed in Phase 1.
- A client-side gameplay state (e.g. streak days) is derived from item
  timestamps the same way — not a new backend store.

### #3 — Streak day boundary
**Resolved: local device time.** The daily-reset boundary uses the device's
local day, matching the existing `toLocalDate` convention in
`src/utils/lending.js` (parses a bare `YYYY-MM-DD` as *local* midnight and
never throws — safe for the no-error-boundary app). Server time is revisited
**only if** multi-device drift actually appears in Phase 1/2.

### #4 — Lending queryability
**✅ Lending records are queryable client-side.** Lending state lives **on the
item blob** (`netlify/functions/lending.js`): `item.lending`
(`{ borrower, lentOn, dueOn? }`) and `item.lendingHistory`
(`[{ borrower, lentOn, returnedOn, dueOn? }]`, **bounded to max 10**). There is
**no aggregate endpoint** — `GET /collection` returns full items, so a client
can derive "currently out" / "ever lent" per member from the item list alone.
- **Correction (Front End Architect):** per-member lending quests ("Lend a
  record and get it back", "Bring the overdue book home") are **FEASIBLE
  client-side** from the embedded `lending` / `lendingHistory` fields. Only
  **cross-user** views (seeing *another* member's loans, or an admin-wide
  overdue board) would need backend work — and cross-user is an **explicit
  product non-goal** (no leaderboards, private collections). So lending quests
  are unblocked for Phase 2 client-side; this softens the F-1 "lending" risk.

### #5 — Share-card renderer
**No new dependency.** Cards render locally with SVG/canvas (no external
service), consistent with `requirements.md` §8. If a font is used for the gold
wordmark it must be self-hosted and precached by the PWA (per the
`pwa-offline` conventions) — a Phase-1 implementation note, not a blocker.

### #6 — Humor per locale
**Pending — Marketing Manager native-speaker pass.** All archetype verdicts,
quiz feedback lines, badge names/lines, quest names, and fun-fact templates
carry `[VALIDATE]` per locale in `copy-bank.md` §2–§9. This doc does not
change that; it is tracked as an in-flight handoff (§7). Not a Phase-0
code blocker — locale ship gates on it in the rollout plan.

### #7 — "Your notes say…" reveal
**✅ Notes are present on items.** `notes` is initialized `''` at add
(`src/CollectionView.jsx`) and user-edited via PUT, and items are returned
whole by `GET /collection` (they are the stored blobs). The quiz-miss reveal
("You added this in March 2024. Your notes say …") is **feasible**.

---

## 4. Measurement & analytics decision

**Front End Architect decision — instrument now, minimal first-party,
default-OFF `src/utils/track.js`.**

- **No third-party SDK**, no external analytics endpoint.
- **No tracking by default** — the module is opt-in; unless a user turns it
  on, it is inert.
- **First-party, minimal** — a tiny client-side queue held in `localStorage`
  (capped), flushed only if/when the opt-in is active.
- **`sanitize()`** drops secret-like keys (access codes `RU-…`, the admin key,
  token fields) before anything is queued — nothing secret ever leaves the
  client.
- **Never throws** — every call is wrapped so a tracking failure can never
  dark-screen the app (no error boundary).
- **`docs/technical.md` §13 ("No tracking, no third-party analytics") stays
  literally true** — this is a first-party, default-off instrument, not
  analytics-as-default. A short note will be added to that doc when the module
  ships.

**Shipping order:** the module ships as **the first commit of Phase 1** (before
release 1.1), so every gamification release can emit events from day one.
**Phase 0 ships no code** — this document only records the decision.

**Event list** (matches `requirements.md` §9, plus the add-path event needed
for the G-2 funnel join):

| Event | Payload (fields) | Trigger |
| --- | --- | --- |
| `gamif_persona_generated` | persona archetype | Persona viewed / exported |
| `gamif_quiz_answered` | question type, correct? | Quiz answer submitted |
| `gamif_quiz_streak` | streak length | Day streak increments |
| `gamif_quest_started` / `gamif_quest_completed` | quest id, kind | Quest lifecycle |
| `gamif_story_opened` | story type | Shelf Story card viewed |
| `gamif_badge_unlocked` | badge id | Badge unlock |
| `gamif_level_up` | level, kind | Level up |
| `gamif_share_exported` | card type | Card exported |
| `gamif_item_added` | `kind` (records\|books), `source` (scan\|manual) | On the **add path** (both scan and manual adds) |

`gamif_item_added` is the join key for the G-2 funnel ("quest completed →
scan-add within 7 days") — the quest-completion event must be joinable to
subsequent adds, so the add path emits this event with its `kind` and `source`.

---

## 5. Mechanic feasibility table

Every mechanic from `requirements.md` §§3–8, tagged with the Front End
Architect verdict. Data source = where the mechanic's inputs come from
(verified in §2).

### ✅ FEASIBLE — client-side, offline, both kinds

| Mechanic | Goal | Data source |
| --- | --- | --- |
| Collection Persona (G-1) | G-1 | `year`, `genre`, `formatType`*, `dateAdded`, `notes`, `splitArtistTitle`/`findRelated` — all client-side, pure function |
| Crate Quiz + streaks (G-3) | G-3 | Items themselves (covers, `year`, `dateAdded`, `notes`); seeded by local day; streak = local device time (§3 #3) |
| Shelf Stories — facts tier (G-1/G-4) | G-1, G-4 | `year` span, decade bias, `genre`, `dateAdded`, `notes` |
| XP / levels / badges / streaks (G-5) | G-5 | Derived idempotently from item state + timestamps (§3 #2); `dateAdded` for Impulse Buyer |
| Share cards | social | Local SVG/canvas, no new deps (§3 #5); privacy rule per `copy-bank.md` §7 |
| Quests — Decade Gap, Variant Shelf, Same-artist blind spots, Catalog hygiene, Genre tourist | G-2 | `year` histogram, duplicate detection (`findRelated`), `splitArtistTitle`, `notes`, `genre` — all client-side |
| Quests — per-member lending | G-2 | Embedded `item.lending` / `item.lendingHistory` (§3 #4) — no backend |

\* Persona uses `formatType` when present and degrades gracefully to
year/genre-only when not (records-only field) — the degraded rule in §5-DEGRADED
applies to *format-driven* mechanics, not to the persona's optional inputs.

### ⚠️ DEGRADED — kind-specific fallbacks

| Mechanic | Degradation | Fallback |
| --- | --- | --- |
| Format mix (persona stat, format quests) / Variant Hoarder badge | `formatType` is **records-only** | Books: skip format inputs; use genre/category instead |
| Style / Sophisticate (archetype + badge) | `style` is **records-only** (books always `[]`) | Fall back to `genre`/category when `style` is empty |
| Country mix (persona stat, Genre Tourist countries) | `country` is **records-only** | Books: omit country stat |
| Page Counter / total-pages (Shelf Stories, persona) | `pageCount` is **books-only** and often `''` until a detail fetch | Show total pages **only when ≥ 5 items have it** (already the `requirements.md` §6.2 rule); records: omit |
| Book genre / era lessons (Shelf Stories) | Books have no `genre` — `genre` is the categories array | Author + `year` + category fallbacks per `requirements.md` §6.1 |

### ⛔ DEFERRED — Phase 2 gate

| Mechanic | Why deferred | Gate |
| --- | --- | --- |
| Finish-the-discography quest | No Discogs artist-releases endpoint (§3 #1) | Phase 2: new proxy action + cache + rate-limit validation (Netlify Backend) |
| Anything cross-user / leaderboards | Explicit product non-goal (no leaderboards, private collections) | Product decision gate (Phase 3, `rollout-plan.md` §3) |

**Net tag:** Phase 1 ("Know & Play" — Persona, Quiz, Shelf Stories facts,
XP/badges/streaks, share cards) is fully **feasible client-side** with the
degraded fallbacks above — confirming `concept.md` §5's "zero-backend,
zero-API, offline-safe" claim. The only Phase-2-blocked quest is
Finish-the-discography; lending quests are unblocked (§3 #4).

---

## 6. Phase-1 implications

What this audit changes or confirms for Phase 1 (`rollout-plan.md` §3):

1. **Streak = local device time.** The Crate Quiz streak (1.3) uses the local
   day boundary (§3 #3), matching `toLocalDate` — no server-time logic in
   Phase 1.
2. **Notes are present** — the quiz-miss reveal ("Your notes say …") and the
   Notes/ Sleeve Sleuth mechanics are feasible from day one (§3 #7).
3. **`track()` ships first.** The `src/utils/track.js` module is the first
   commit of Phase 1, before release 1.1 (§4), so every slice can emit
   `gamif_*` events.
4. **Events slice-by-slice.** Each release emits only the events it owns
   (1.1: `gamif_persona_generated`, `gamif_share_exported`, `gamif_item_added`;
   1.2: `gamif_badge_unlocked`, `gamif_level_up`; 1.3: `gamif_quiz_answered`,
   `gamif_quiz_streak`; 1.4: `gamif_story_opened`, `gamif_quest_*` for quest
   seeds from stories).
5. **Persona/format mechanics carry fallbacks.** Any record-only input
   (`formatType`, `style`, `country`) falls back to kind-neutral fields in the
   persona and stats modules (§5-DEGRADED) — a missing field must never blank
   the dark screen.
6. **XP derivation is idempotent.** No event log, so XP/levels/badges derive
   from item state + `dateAdded` (§3 #2); a client-side play-state keyed per
   user lives in `localStorage`, not a new backend store.

**Open decisions from `rollout-plan.md` §5 — status after this audit:**

| # | Decision | Status |
| --- | --- | --- |
| 5.1 | Pilot release — 1.1 Persona or 1.3 Quiz first? | **Unchanged** — still open, product choice. This audit does not pick a pilot. |
| 5.2 | Analytics — is there an existing hook, or scope a minimal one? | **Resolved by this audit** — no existing hook; scope the minimal default-OFF `src/utils/track.js` (§4). |
| 5.3 | Streak day boundary — local vs server time | **Resolved by this audit** — local device time for Phase 1 (§3 #3). |

Only 5.2 and 5.3 are settled here; 5.1 remains a product decision and the
rollout-plan's §5 language should be updated to reflect these two resolutions
(owned by the Project Manager when the plan next changes).

---

## 7. Owner map & handoff

Phase-0 owners per the `rollout-plan.md` §6 owner map, with this audit's
outcomes:

| Work (from rollout-plan §6) | Owner | Phase-0 outcome |
| --- | --- | --- |
| Data-model audit (`[VALIDATE]` #1/#4) | Netlify Backend | Done via code audit — #1 deferred (no endpoint), #4 confirmed client-side (§3) |
| Client model audit | Front End Developer | Done — §2 matrix, verified at `dd00b7d` |
| Event log / streak-boundary decision | Whole Stack Architect | Done — no event log; streak = local time (§3 #2, #3) |
| Analytics hook design | Front End Architect | Done — default-OFF `track.js`, ships as first Phase-1 commit (§4) |
| Humor localization pass (#6) | Marketing Manager | **In-flight** — native-speaker pass on `copy-bank.md` (fr, nl, pt-BR, de, es, it); this doc references the `[VALIDATE]` flags there and does not block Phase 0/1.1 |

**Handoffs still open after Phase 0:**

- **Marketing Manager** — the humor pass on `copy-bank.md` (§3 #6) is
  in-flight; nothing in this audit changes the `[VALIDATE]` copy inventory.
- **Netlify Backend** — before Phase 2, confirm the Discogs
  `/artists/{id}/releases` endpoint + rate-limit/cache behavior for the
  Finish-the-discography quest (§3 #1). Until confirmed, that quest stays
  deferred.
- **Project Manager** — fold the §6 resolutions (5.2, 5.3) into the next
  `rollout-plan.md` revision.

**Exit criteria met:** data-availability matrix documented (§2) · every
mechanic tagged feasible / degraded / deferred (§5). Phase 0 ships no code.
