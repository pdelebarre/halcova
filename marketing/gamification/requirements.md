# Alcove Arcade — elaborated requirements

Working spec for gamifying the app. Creative rationale → [`concept.md`](concept.md).
Copy → [`copy-bank.md`](copy-bank.md).

This document elaborates the requirement **"gamify the app so members discover
what they like, what to buy next, what they remember, and what they learned from
their collection."** Every mechanic is grounded in data the app already stores;
anything needing a new data source or API is marked `[VALIDATE]`.

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

1. **Everything derives from existing item data** (Phase 1): `title` (via
   `splitArtistTitle`), `year`, `label`, `formatType`, `genre`, `style`,
   `country`, `dateAdded`, `notes`, `barcode`, `discogsId`/`googleBooksId`, plus
   `findRelated` output and the lending records.
2. **One shared engine**, parameterized by catalog (records "crate" / books
   "shelf") exactly like `CollectionView` — new copy lives in each catalog's
   `.copy`, never hardcoded in components.
3. **All new copy is i18n-ready**: en, en-GB, fr, nl, pt-BR, de, es, it. Humor
   lines get `[VALIDATE]` per language (see §10).
4. **Offline-safe**: the quiz, persona, badges, streaks, and stats compute
   client-side; no new lookup needed to play.
5. **Defensive rendering**: there is **no error boundary** — any uncaught render
   error blanks the screen. New data paths (e.g. a record with missing
   `year`/`genre`) must be guarded (`?.` / defaults) before rendering.
6. **No leaks**: share cards and any exported artifact contain only headline +
   aggregated stats. Never the full collection, never `RU-…` codes, never the
   admin key.
7. **No cheating incentives**: XP is cosmetic; streaks forgive one missed day
   (`streakGrace = 1`) so real life doesn't punish people.

---

## 3. Feature: Collection Persona (G-1)

**User story.** *As a member, I want a funny, shareable summary of what my
collection says about me, so I can laugh, brag, and see my taste.*

### 3.1 Mechanics
- **Inputs** (all optional, each guarded): genre/style counts, decade histogram
  from `year`, format mix from `formatType`, artist frequency via
  `splitArtistTitle`, duplicate/pressing counts, `dateAdded` burst detection,
  notes coverage.
- **Scoring**: a weighted rule set maps the profile to **one archetype** (from
  `copy-bank.md` §1) + 2–3 headline stats + one verdict line.
- **Computed client-side** in a pure function (`src/utils/persona.js` style, unit
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

**User story.** *As a member, I want a 60-second daily game built from my own
collection, so I can rediscover what I own and remember why I bought it.*

### 4.1 Mechanics
- **Deals 3–5 questions/day** from the member's own items (seeded by day so the
  set is stable within a day).
- **Question types** (all offline, all from local items):
  - `guessYear` — cover + two years (one correct).
  - `nameThatArtist` — cover + three artists (decoys are other artists you own).
  - `newestOrOldest` — two items, "which did you add first?" (uses `dateAdded`).
  - `stillYours` — a cover, "do you still own this?" (yes/no; correct answer is
    always "yes" — the gag is that you doubted yourself).
  - `sortShelf` — order three items by `year` (skip if < 3 with years).
- **Scoring**: 10 XP per correct; a perfect day earns the "Quiz Whiz" bonus;
  daily **streak** increments on completion (any score) and resets if a full day
  is skipped, with a 1-day grace.
- **Wrong-answer teaching**: on a miss, show the real answer + the item's
  `dateAdded` and `notes` ("You added this in March 2024. Your notes say
  'impulse buy at a flea market.'").

### 4.2 Edge cases
- **Fewer than 3 items** → quiz locked with a "scan a few more first" message.
- Items missing `coverImage` or `year` → those items are excluded from the
  question pools that need them (never crash).
- Quiz timing uses the user's local day; streak "day" boundary flagged
  `[VALIDATE]` for server-vs-local time (items carry ISO `dateAdded`).
- Offline: quiz is fully client-side — works with no connection.

### 4.3 Acceptance criteria
- [ ] Quiz never proposes a question with insufficient data.
- [ ] Streak increments/resets correctly across days (incl. 1-day grace).
- [ ] Misses always reveal the answer + item story.
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

## 6. Feature: Shelf Stories (G-1 + G-4)

**User story.** *As a member, I want surprising, true facts about my collection
and what it teaches me, so I feel smarter about my own taste.*

### 6.1 Mechanics
- **Collection facts** (deterministic, data-grounded): span of years,
  total pages (books, sum of `pageCount`), series detection (books, shared
  author+title prefix), decade bias, country mix (records).
- **Era lessons**: for the dominant decade, a short "here's what was happening
  then + 3–5 similar records you'd love" — the recommendations derive from
  `genre`/`style` + `year` similarity to your own items.
- **Artist constellations** (books): author frequency → "3 authors wrote 40% of
  your shelf — here are 3 more in the same lane" (from `category` overlap).
- **One-Timer alert**: single item by a well-known artist/author → both a fact
  and a quest seed.
- Each story is one card in a swipeable feed; every story can have a "turn this
  into a quest" action (feeds §5).

### 6.2 Edge cases
- `pageCount` missing on most books → total pages shown only when ≥ 5 items have it.
- No `genre`/`style` → era lessons use year-similarity only.
- Small collections → show only the facts tier.

### 6.3 Acceptance criteria
- [ ] Every fact is provably derived from stored data (no hardcoded numbers).
- [ ] Recommendations never claim a data source we don't have (`[VALIDATE]`).

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
  share card. Full list in `copy-bank.md` §3.
- **Streaks** — daily-quiz streak (primary) + optional scan streak (N days with
  an add). 1-day grace.

### 7.2 Edge cases
- XP must be idempotent on re-render (derive from event log / item timestamps,
  never increment in render).
- Badges based on "10 added in a day" need an event log; if none exists
  `[VALIDATE]` whether `dateAdded` alone is enough (client can bucket by day).

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

---

## 11. Claims needing product validation `[VALIDATE]`

1. **Discogs artist-discography endpoint** availability + rate limits for
   "Finish the discography" quests — Netlify Backend to confirm proxy path +
   cache behavior (reuse the `discogs-cache` Blob store).
2. **Event log**: is there one for badge/XP derivation, or do we derive purely
   from item data + `dateAdded`? Determines "Impulse Buyer" badge feasibility.
3. **Streak day boundary** — server vs local time for daily reset.
4. **Lending feature stability** — confirm lending records are queryable
   client-side for lending quests before Phase 2.
5. **Share-card renderer** — no new deps; font self-hosting if needed.
6. **Humor per locale** — native-speaker pass on all copy lines.
7. **"Your notes say…"** in quiz misses requires notes to be present; confirm
   notes are loaded in the client collection model (they are saved per item —
   verify they're part of the item objects returned by `collection.js`).

---

## 12. Dev handoff (what the implementing agent needs)

- **Phase 1 scope** (no backend, no API, offline-safe): Persona, Quiz, Shelf
  Stories, XP/levels/badges/streaks, share cards. New pure modules under
  `src/utils/` (e.g. `persona.js`, `quiz.js`, `stats.js`, `quests.js`) mirroring
  `match.js`, with unit tests per the testing conventions.
- **Copy keys**: extend the catalog `.copy` objects in `src/catalog.js` and the
  i18n locale files (`src/i18n/locales/*.js`) — the Marketing Manager supplies
  `copy-bank.md`; the developer wires the keys.
- **Guards**: every new data path is `?.`-guarded (no error boundary — a missing
  `genre`/`year` must never blank the screen).
- **Files/dirs**: new components under `src/components/` (e.g.
  `GamificationPanel`), styles via the existing CSS-token system
  (`src/index.css` dark `#16130F` + gold), PWA: no new precache needed for
  Phase 1 unless a font is added.
- **Testing**: pure-logic tests in `src/utils/*.test.js`; component tests per the
  `__tests__/` conventions; no new API mocks needed for Phase 1.
