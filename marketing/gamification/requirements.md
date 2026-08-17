# Halcova Arcade — elaborated requirements

Working spec for gamifying the app. Creative rationale → [`concept.md`](concept.md).
Copy → [`copy-bank.md`](copy-bank.md).

This document elaborates the requirement **"gamify the app so members discover
what they like, what to buy next, what they remember, and what they learned from
their collection."** Every mechanic is grounded in the **contents** of the
collection (what the member owns and the stories inside it) or in a real, sourced
lore entry — never in the act of cataloging. Anything needing a new data source
or API is marked `[VALIDATE]`.

**Branch:** `feat/gamification` · **Target kind:** shared flow (records + books),
parameterized per catalog like the rest of the app.

---

## 1. Scope & goals

| ID | Goal | Pillar | Success signal |
| --- | --- | --- | --- |
| G-1 | Discover what you like | Persona + Shelf Stories | ≥ 40% of active members generate a persona in week 1 |
| G-2 | Discover what to buy next | Crate Digger Quests | ≥ 20% of quest completions followed by a scan-add within 7 days |
| G-3 | Discover what you remember | Crate Quiz | D7 retention lift vs non-players; avg quiz streak ≥ 5 days |
| G-4 | Discover what you learned | Shelf Stories | ≥ 25% of members open a "Shelf Story" per week |
| G-5 | Become a daily habit | Streaks + progression | ≥ 30% of weekly actives return 3+ days/week |

Non-goals (this iteration): global leaderboards, real-money rewards, paid
content, competitive rankings. All of those are anti-patterns for this private,
cozy-collector product.

---

## 2. Design rules

1. **Contents-first.** Every mechanic plays the *contents* of the collection —
   the artists/authors, albums/books, labels, eras, and stories you own. No
   mechanic asks about the act of cataloging: `dateAdded`-trivia, add-streaks,
   and impulse-buy framing are out.
2. **Three honest tiers — computed / sourced / never invented.** (a) **Computed**
   — pure functions of stored item data (`title` via `splitArtistTitle`, `year`,
   `label`, `formatType`, `genre`, `style`, `country`, `notes`, `barcode`,
   `pageCount`, `discogsId`/`googleBooksId`, plus the Phase-A content fields);
   (b) **Sourced** — curated lore from the precached Halcova Library, attributed
   on screen ("From the Halcova Library"); (c) **Never invented** — a mechanic
   that can't be computed or sourced degrades (skips / falls back) instead of
   guessing.
3. **One shared engine**, parameterized by catalog (records "crate" / books
   "shelf") exactly like `CollectionView` — new copy lives in each catalog's
   `.copy`, never hardcoded in components. Enrichment extends the stored item; it
   never forks the flow per kind (§5bis).
4. **All new copy is i18n-ready**: en, en-GB, fr, nl, pt-BR, de, es, it. Humor
   lines get `[VALIDATE]` per language (see §10).
5. **Offline-safe**: the quiz, persona, badges, streaks, and stats compute
   client-side; content comes from the precached enrichment + lore bank — no
   runtime lookup needed to play (the collection-list offline cache is
   `[VALIDATE]` §11.10).
6. **Defensive rendering**: there is **no error boundary** — any uncaught render
   error blanks the screen. New data paths (e.g. a record with missing
   `year`/`genre`, an un-enriched `tracklist`, a `null` lore entry) must be
   guarded (`?.` / defaults) before rendering.
7. **No leaks**: share cards and any exported artifact contain only headline +
   aggregated stats. Never the full collection, never `RU-…` codes, never the
   admin key.
8. **No cheating incentives**: XP is cosmetic; streaks forgive one missed day
   (`streakGrace = 1`) so real life doesn't punish people.

---

## 3. Feature: Collection Persona (G-1)

**User story.** *As a member, I want a funny, shareable summary of what my
collection says about me, so I can laugh, brag, and see my taste.*

### 3.1 Mechanics
- **Inputs** (all optional, each guarded): genre/style counts, decade histogram
  from `year`, format mix from `formatType`, artist frequency via
  `splitArtistTitle`, duplicate/pressing counts, notes coverage.
  **De-meta'd:** the `dateAdded`-burst stats (busiest day, busiest month, "added
  N in a day") are removed — the persona reads the contents you own, not your
  cataloging behavior.
- **Scoring**: a weighted rule set maps the profile to **one archetype** (from
  `copy-bank.md` §1) + 2–3 headline stats + one verdict line.
- **Computed client-side** in a pure function (`src/utils/persona.js`, unit
  tested), like `src/utils/match.js`.
- **Recomputes** whenever the collection changes; the archetype can change as
  taste shifts (a reason to come back).
- **Share card**: rendered locally (SVG/canvas) — dark `#16130F` + gold,
  archetype name, stats, tagline. Export as image; no external service.

### 3.2 Edge cases
- Empty collection → no persona; show the "add a record first" empty state instead.
- Single genre / single year → archetype still resolves (fallbacks defined).
- Missing `genre` arrays (manual adds) → derive from format/year only.
- Books with no `category` → use author + year only.
- Records with no `year` → exclude from decade stats, don't crash.

### 3.3 Acceptance criteria
- [ ] Persona renders from any real collection without throwing (guard missing fields).
- [ ] Persona changes when the collection meaningfully changes.
- [ ] Share card contains only headline + 3 stats (verify no full-collection leak).
- [ ] All copy via catalog `.copy` / i18n keys.

---

## 4. Feature: The Crate Quiz (G-3)

**User story.** *As a member, I want a 60-second daily game built from the
contents of my own collection, so I can rediscover what I own and remember why I
love it.*

### 4.1 Mechanics
- **Deals 3–5 questions/day** from the member's own items (seeded by day so the
  set is stable within a day).
- **Question types** — the **metadata core** is always playable (pure
  `year`/`genre`/`label`/`cover`); the **content games** are dealt only when the
  Phase-A enrichment or the Phase-B lore bank has the material (§5bis):
  - `guessYear` — cover + two years (one correct).
  - `nameThatArtist` — cover + three artists (decoys are other artists you own).
  - `sortShelf` — order three items by `year` (skip if < 3 with years).
  - `stillYours` — *(optional warm-up)* a cover, "do you still own this?"
    (yes/no; correct answer is always "yes" — the gag is that you doubted
    yourself). The reveal is the point: the item's **lore reveal** (story from
    the Halcova Library, or a computed metadata fact when no lore entry exists) —
    never the add date.
  - `coverMemory` — name the album behind a cover, or match covers to titles.
    Needs: `coverImage` + `title` (via `splitArtistTitle`); decoys from items you
    own.
  - `spotImpostor` — 3–4 covers share a thread (artist/label/genre/era); one
    doesn't belong. Needs: `coverImage`, `title`, `genre`/`style`, `label`, and
    Phase-A `artists[]` (stable artist ids).
  - `labelPressMatch` — match a record to its label/pressing, or 2–3 pressings
    to their labels. Needs: `label`, `catno`, `formatRaw`, `formatType`,
    `coverImage`, `title`, `year`.
  - `numbersGame` — number facts about one item: track count (records), page
    count (books), release/publication year. Needs: Phase-A `tracklist`
    (records) / stored `pageCount` (books) / `released` (records) or `year`.
  - `genreOddOneOut` — "which of these is *not* a {genre} record?" Needs:
    `genre`, `style`, `coverImage`, `title`.
  - `trackDetective` (records only) — "which track is *not* on this album?" /
    "which album contains 'X'?" Needs: Phase-A `tracklist` (capped ~40) + `title`.
  - `blurbMatch` (books only) — match the book to its blurb/synopsis. Needs:
    Phase-A `snippet` (capped ~400) or the stored `description`, `title`,
    `coverImage`.
  - `loreFact` — "which fact about this artist/album is true?" Needs: a Phase-B
    lore entry keyed to the item (§5bis.2).
  - `yearContext` (Decade Lesson) — "what was happening in the year this came
    out?" Needs: `year`/`released` + a Phase-B era entry.
  - `connection` — "what links these two records?" (same label, same era, same
    story). Needs: `genre`/`style`/`label`/`year` + a Phase-B connection entry.
  - *Removed by the contents-first pivot:* `newestOrOldest` ("which did you add
    first?") — `dateAdded` trivia is dead.
- **Scoring**: 10 XP per correct; a perfect day earns the "Quiz Whiz" bonus;
  daily **streak** increments on completion (any score) and resets if a full day
  is skipped, with a 1-day grace.
- **Wrong-answer teaching**: on a miss, show the real answer + a **lore fact**
  from the Halcova Library (attributed; falling back to a computed metadata fact
  when no lore entry exists) + the item's `notes` **only when present**. The add
  date is never shown.

### 4.2 Edge cases
- **Fewer than 3 items** → quiz locked with a "scan a few more first" message.
- Items missing `coverImage` or `year` → those items are excluded from the
  question pools that need them (never crash).
- **Content games fall back**: a content game is skipped when its material is
  missing (no `tracklist` → no `trackDetective`; no lore match → no
  `loreFact`/`yearContext`/`connection`). The quiz degrades to the metadata core
  — it never invents content.
- Quiz timing uses the user's local day; streak "day" boundary flagged
  `[VALIDATE]` for server-vs-local time.
- Offline: quiz is fully client-side — the collection and the lore bank are
  local; no runtime lookup needed to play (collection-list offline caching is
  `[VALIDATE]` §11.10).

### 4.3 Acceptance criteria
- [ ] Quiz never proposes a question with insufficient data (incl. content games).
- [ ] Streak increments/resets correctly across days (incl. 1-day grace).
- [ ] Misses always reveal the answer + a lore fact (notes only when present;
      never the add date).
- [ ] Works offline and with a collection of 1–2 items (locked state).

---

## 5. Feature: Crate Digger Quests (G-2)

**User story.** *As a member, I want to be told exactly what to hunt next, so I
buy things I'll actually love — and have fun doing it.*

### 5.1 Mechanics (quest catalog, client-generated where possible)
| Quest | Source data | Data source |
| --- | --- | --- |
| Finish the discography | artist frequency vs Discogs artist releases | `[VALIDATE]` — Discogs artist endpoint via existing proxy |
| The Decade Gap | decade histogram; suggest under-represented decade | client-side |
| Same-artist blind spots | `findRelated`-style artist grouping | client-side |
| The Variant Shelf | 2+ pressings of same album (duplicate detection) | client-side |
| Lending quests | lending records (borrower, due date) | client-side + lending store |
| Catalog hygiene | items with empty `notes`; `dateAdded` older than N days | client-side |
| Genre tourist | genre coverage; suggest a missing genre | client-side |

- Each quest = `{ id, title, goal, progress, reward }`, auto-generated, up to 3
  active + 1 "featured" at a time.
- **Progress** updates live from collection changes; completion awards XP +
  badge + a toast.
- Quests are **seeded by randomness per day** so lists stay fresh, but always
  deterministic within a day.
- Tapping a quest deep-links to the relevant screen (scan, search, detail).

### 5.2 Edge cases
- Small collections → only client-side quests offered; discography quests need
  `[VALIDATE]` on rate limits (Discogs is rate-limited; use the existing proxy +
  shared Blob cache).
- A quest's target disappears (item removed) → quest retires gracefully.
- Lending quests only appear if the lending feature data is present.

### 5.3 Acceptance criteria
- [ ] Every quest maps to real, currently-stored data (no fabricated goals).
- [ ] Progress never counts an item twice after removal/re-add.
- [ ] Discography quests respect Discogs rate limits (`[VALIDATE]`).

---

## 5bis. Content layer & data enrichment

The content games (§4.1) and the lore tier (§6) draw their raw material from
**two offline-safe sources** plus the always-present deterministic metadata
facts. This is the data contract the whole suite depends on (Whole Stack
Architect's Phase A/B/C ordering).

### 5bis.1 Phase A — blob enrichment of the stored item

Persist stable, content-bearing fields **ON the item** so games read them
offline, with zero runtime API. Fields merge at the **detail view** (see the
quota note below) and are written through the existing collection API.

| Field | Records | Books | Code touchpoint |
| --- | --- | --- | --- |
| `artists[]` | ✅ capped ~8: `{ id, name, anv, role }` | — | Discogs release detail (`src/api/discogs.js getReleaseDetail`); persist via the collection PUT |
| `masterId` | ✅ release's master release id | — | Discogs release detail (`data.master_id`) |
| `tracklist` | ✅ capped ~40: `{ position, title, duration }` | — | Discogs release detail — already fetched for the detail sheet; persist it |
| `released` | ✅ release date string | — | Discogs release detail (`data.released`) |
| `authorsList[]` | — | ✅ capped ~8: `{ name, id? }` | Google Books `volumeInfo.authors` — currently flattened into `title` (`toBookItem` in `src/api/books.js`); keep the structured list |
| `subtitle` | — | ✅ string | Google Books `volumeInfo.subtitle` — currently discarded |
| `series` | — | ✅ string (series name from `seriesInfo`) | Google Books `volumeInfo.seriesInfo` — currently discarded |
| `mainCategory` | — | ✅ string | Google Books `volumeInfo.mainCategory` — currently discarded |
| `snippet` | — | ✅ capped ~400 chars (blurb) | Google Books `searchInfo.textSnippet` — currently discarded |

- **Merge at the detail view, not per add.** The release/volume detail is already
  fetched when the member opens the detail sheet (`AlbumDetail`'s existing
  `getReleaseDetail` fetch, `BookDetail`'s existing `getBookDetail` fetch).
  Merging the enrichment fields there (then PUT-ing them to the collection) means
  adding stays one network call and the Discogs quota is protected — no extra
  per-add lookups.
- **Schema/allowlist touchpoint:** the new fields must be added to the server
  item allowlist + validation (`netlify/functions/_shared/item-fields.js`) and
  the item-shape docs. This is a **security-gated change** (§11.11): the
  allowlist and type/length validation must be extended and negative-tested
  before shipping.
- **Shared-flow invariant:** enrichment **extends the stored item** — it never
  forks the flow per kind. The shared `CollectionView`, the normalizers' item
  shape, and the components stay untouched; the games read the enriched fields
  through the same flat item.

### 5bis.2 Phase B — the precached Halcova Library (curated lore)

- A curated, attributed lore bank shipped in the PWA: `src/content/lore/*.js`
  (per-kind or per-theme modules), consumed through a **pure** `lookupLore()`
  in `src/utils/lore.js` (mirrors `match.js`/`persona.js`: unit-tested, never
  throws, returns `null` on no match).
- **Match keys** (see §11.8): lore entries key on the stable identifiers the
  enrichment provides — records: `masterId` / `discogsId` / artist id or
  normalized artist name; books: `googleBooksId` / author name; plus label name
  and decade/era for the label and era cards. `lookupLore(item)` returns the
  matching entry or `null`.
- **Attribution:** every lore fact is displayed with its source ("From the
  Halcova Library") — this is what makes "sourced" honest (§2).
- **Precache budget:** `src/content/lore/*.js` is precached by `vite-plugin-pwa`
  (§11.9) — the budget must stay within the current precache envelope.

### 5bis.3 Phase C — the games, and the fallback tier rule

- The games (quiz content types, Shelf Stories lore tier) read **A + B + the
  deterministic metadata facts** (`year`, `genre`, `label`, `formatType`,
  `country`, `pageCount`, `coverImage`, `title`).
- **Fallback tier rule:** a game/card may use sourced material only when a
  matching entry exists. If a Phase-A field is missing (item not yet enriched) or
  a Phase-B entry doesn't match, the mechanic **degrades to the computed metadata
  facts or skips** — it never invents content. Example: no `tracklist` → no Track
  Detective; no lore entry → `loreFact`/`yearContext`/`connection` are skipped and
  the quiz falls back to the metadata core.

---

## 6. Feature: Shelf Stories (G-1 + G-4)

**User story.** *As a member, I want surprising, true stories about my collection
and what it teaches me, so I feel smarter about my own taste.*

### 6.1 Mechanics — two tiers
**Facts tier** (computed, deterministic — always shown):
- **Collection facts** — span of years, total pages (books, sum of `pageCount`),
  series detection (books, shared author+title prefix), decade bias, country mix
  (records).
- **Era lessons** — for the dominant decade, a short "here's what was happening
  then + 3–5 similar records you'd love" — the recommendations derive from
  `genre`/`style` + `year` similarity to your own items.
- **Artist constellations** (books) — author frequency → "3 authors wrote 40% of
  your shelf — here are 3 more in the same lane" (from `category` overlap).
- **One-Timer alert** — single item by a well-known artist/author → both a fact
  and a quest seed.

**Lore tier** (sourced from the Halcova Library — a card shows **only when a
matching lore entry exists**, otherwise it degrades to the facts tier):
- **Story cards** — an anecdote about an artist/author you own (Phase-B entry).
- **Era cards** — what the era of your dominant decade was about.
- **Label cards** — the history of a label/publisher you collect.
- **Genre-origin cards** — where a genre you collect came from.

Each story is one card in a swipeable feed; every story can have a "turn this
into a quest" action (feeds §5). Lore cards always carry the "From the Halcova
Library" attribution.

### 6.2 Edge cases
- `pageCount` missing on most books → total pages shown only when ≥ 5 items have it.
- No `genre`/`style` → era lessons use year-similarity only.
- Small collections → show only the facts tier.
- No matching lore entry for an item/artist/label/genre → the lore card is not
  rendered (degrade to the facts tier) — never invent a story.

### 6.3 Acceptance criteria
- [ ] Every fact is provably derived from stored data (no hardcoded numbers).
- [ ] Recommendations never claim a data source we don't have (`[VALIDATE]`).
- [ ] Lore cards appear only when `lookupLore(item)` matches and always carry the
      attribution.

---

## 7. Feature: Progression (G-5)

**User story.** *As a member, I want to see progress and earn funny titles, so I
keep coming back.*

### 7.1 Mechanics
- **XP ledger** (client-side, keyed per user+kind or combined): +10 scan-add,
  +5 manual add, +20 quest complete, +10 correct quiz answer, +5 write notes,
  +15 first lend, +10 return.
- **Levels** (records: Crate Sprout → … → Crate Deity; books: Page Turner → …
  → Shelf Sovereign) with thresholds in `copy-bank.md` §4.
- **Badges** — auto-checked against the collection + event log; unlock toast +
  share card. Full list in `copy-bank.md` §3. The Impulse Buyer badge ("10 added
  in a day") is **cut** by the contents-first pivot — it rewarded cataloging
  behavior, not contents.
- **Streaks** — the daily-quiz streak is the only streak (unaffected by the
  pivot — it tracks play, not add-dates). The optional scan streak ("N days with
  an add") is cut. 1-day grace.

### 7.2 Edge cases
- XP must be idempotent on re-render (derive from event log / item timestamps,
  never increment in render).
- No event-log/burst badge remains: the Impulse Buyer badge is cut, so no
  `dateAdded` bucketing is needed. Remaining badges derive from current item
  state + the client gameplay ledger (§4.1 / §11.2).

### 7.3 Acceptance criteria
- [ ] No XP granted twice for the same action (idempotent derivation).
- [ ] All badge thresholds reachable with real usage (no impossible badges).
- [ ] Streak survives a 1-day miss; resets after 2.

---

## 8. Feature: Share cards (social layer)

**User story.** *As a member, I want to share a beautiful card about my
collection without exposing everything.*

- Cards: persona, level-up, badge unlock, quiz score ("I scored 4/5 on my Crate
  Quiz").
- Rendered locally (SVG/canvas), dark `#16130F` + gold; export as image, share
  via the system share sheet.
- **Content allowed**: headline, archetype/title, 2–3 aggregate stats, tagline,
  brand mark, "request access" hint.
- **Content forbidden**: item lists, covers in bulk, barcodes/ISBNs, access
  codes, admin key, email/name of the owner.
- `[VALIDATE]`: confirm the canvas/SVG renderer needs no new dependency; if a
  font is needed for the gold wordmark, it must be self-hosted/precached.

---

## 9. Measurement & funnel

Instrument client-side events (no backend needed) — name them to match the
existing `UTM`/analytics conventions:

| Event | Trigger | KPI |
| --- | --- | --- |
| `gamif_persona_generated` | persona viewed/exported | G-1 activation |
| `gamif_quiz_answered` / `gamif_quiz_streak` | answer / day streak | G-3 retention |
| `gamif_quest_started` / `gamif_quest_completed` | quest lifecycle | G-2 |
| `gamif_story_opened` | shelf story card viewed | G-4 |
| `gamif_badge_unlocked` / `gamif_level_up` | unlock | G-5 |
| `gamif_share_exported` | card exported | virality |

Funnel to watch: **persona generated → quiz streak ≥ 3 → quest completed →
scan-add within 7 days**. Compare D1/D7/D30 retention for players vs non-players.

---

## 10. Localization & humor

- All copy via i18n keys (en, en-GB, fr, nl, pt-BR, de, es, it) + catalog `.copy`
  for kind-specific fallbacks, matching the existing localization architecture.
- **Humor rules**: jokes tease the *collection*, never the person; no
  cultural references that don't travel (e.g. avoid US-only shop/flea-market
  specifics in non-US locales); punchlines short.
- Every archetype verdict, quiz feedback line, and badge name gets a
  `[VALIDATE]` native-speaker check (reuse the `name-check` approach already
  used for the brand).
- **Lore attribution** ships with every sourced card ("From the Halcova
  Library") and gets the same native-speaker pass; lore copy is written to be
  locale-neutral (artist/label/era facts, not culture-specific jokes).

---

## 11. Claims needing product validation `[VALIDATE]`

1. **Discogs artist-discography endpoint** availability + rate limits for
   "Finish the discography" quests — Netlify Backend to confirm proxy path +
   cache behavior (reuse the `discogs-cache` Blob store).
2. **Event log / Impulse Buyer — RESOLVED (contents-first pivot).** There is no
   event log, and none is needed: the Impulse Buyer badge ("10 added in a day")
   is **cut** (it rewarded cataloging, not contents), so no `dateAdded` bucketing
   is required. XP/levels/badges/streaks derive idempotently from item state +
   the client gameplay ledger (§7.2).
3. **Streak day boundary** — server vs local time for daily reset.
4. **Lending feature stability** — confirm lending records are queryable
   client-side for lending quests before Phase 2.
5. **Share-card renderer** — no new deps; font self-hosting if needed.
6. **Humor per locale** — native-speaker pass on all copy lines (incl. the new
   lore cards' framing).
7. **"Notes reveal" in quiz misses** — confirm `notes` are part of the item
   objects returned by `collection.js`; the reveal shows them **only when
   present**, paired with a lore fact — never the add date.
8. **Lore match keys** — define the stable keys for `lookupLore(item)`
   (records: `masterId` / `discogsId` / artist id or normalized name; books:
   `googleBooksId` / author name; plus label name + decade for label/era cards)
   and confirm they cover the collections we can actually enrich; validate the
   degrade-to-facts behavior when no entry matches (§5bis.2).
9. **Precache budget** — the Halcova Library (`src/content/lore/*.js`) joins the
   PWA precache (currently 59 entries / ~17.3 MiB). Confirm the added JS stays
   within budget and is code-split so the shell isn't bloated.
10. **Collection-list offline caching gap** — the games are offline-safe *only if
    the collection itself is available offline*. Today `useCollection` fetches on
    mount with no offline cache; validate an offline cache strategy for the
    collection GET (IndexedDB mirror / workbox runtime caching) so the quiz and
    stories work with no connection.
11. **Security gate on the schema/allowlist change** — persisting the Phase-A
    fields (`artists[]`, `masterId`, `tracklist`, `released`, `authorsList[]`,
    `subtitle`, `series`, `mainCategory`, `snippet`) changes the server item
    allowlist + validation (`netlify/functions/_shared/item-fields.js`). Per the
    mandatory security gate: threat modeling + negative tests (oversized arrays,
    deep objects, non-string entries) + a Security Auditor review before
    shipping.

---

## 12. Dev handoff (what the implementing agent needs)

- **Phase 1 scope** (no runtime API, offline-safe): Persona, Quiz, Shelf Stories,
  XP/levels/badges/streaks, share cards — plus the **content layer** (Phase A
  enrichment + Phase B lore bank, §5bis). Pure modules under `src/utils/`
  mirroring `match.js`, with unit tests per the testing conventions:
  - `quiz.js` (exists — release 1.3): extend with the content question types
    (§4.1) + the lore reveal; **drop `newestOrOldest`** and the add-date reveal.
  - `lore.js` (**new**) — pure `lookupLore(item) → entry | null` over the
    precached `src/content/lore/*.js`.
  - `stats.js` (**new**) — shared content statistics/pools (track counts, page
    totals, artist-frequency helpers) used by the content games and stories.
  - Existing: `persona.js`, `progression.js`, `stories.js` (facts tier; add the
    lore tier).
- **Enrichment fields**: persist the Phase-A fields per kind at the detail view
  (`AlbumDetail`'s existing `getReleaseDetail` fetch; `BookDetail`'s existing
  `getBookDetail` fetch) — records: `artists[]` (≤8, `{id,name,anv,role}`),
  `masterId`, `tracklist` (≤40), `released`; books: `authorsList[]`, `subtitle`,
  `series`, `mainCategory`, `snippet` (≤400). Extend the server allowlist +
  validation in `netlify/functions/_shared/item-fields.js` (security-gated,
  §11.11) and surface the fields in the normalizers `src/api/discogs.js` /
  `src/api/books.js`.
- **Copy keys**: extend the catalog `.copy` objects in `src/catalog.js` and the
  i18n locale files (`src/i18n/locales/*.js`) — new lore-tier keys, content-game
  prompts, and the reveal templates. The `gamif.quiz.revealAdded` key is
  **re-scoped** (no add-date reveal) to the lore-fact + notes reveal. The
  Marketing Manager supplies `copy-bank.md`; the developer wires the keys.
- **Guards**: every new data path is `?.`-guarded (no error boundary — a missing
  `genre`/`year`/`tracklist`/lore entry must never blank the screen). Lore
  lookups return `null` and callers degrade, never throw.
- **Files/dirs**: new components under `src/components/` (e.g.
  `GamificationPanel`), styles via the existing CSS-token system
  (`src/index.css` dark `#16130F` + gold); lore bank under `src/content/lore/`
  (precached — watch the budget, §11.9). PWA: no new runtime fetch needed for
  Phase 1.
- **Testing**: pure-logic tests in `src/utils/*.test.js` (`lore.js`, `stats.js`,
  quiz content types); component tests per the `__tests__/` conventions; no new
  API mocks needed for Phase 1 (content is local).
