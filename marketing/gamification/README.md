# marketing/gamification — "Halcova Arcade"

Gamification suite for the app (working brand: **Halcova**). Turns a private
catalog into a daily habit loop that helps members discover **what they like**,
**what to buy next**, **what they remember**, and **what they learned** from
their collection.

**Status:** concept + requirements elaboration, ready for product validation and
a dev estimate. The PM-owned phased rollout plan is in `rollout-plan.md`. Work
lives on the `feat/gamification` branch. **2026-08-17:** the suite pivoted
**contents-first** — the games play what you own (artists, stories, history),
never *when* you added it; the content source is the precached **Halcova Library**
(lore layer) on top of Phase-A blob enrichment.

## Authoritative files (use these)

| File | What it is |
| --- | --- |
| `concept.md` | **The creative concept** — insight, the four discovery pillars, core loop, the game catalog (contents-first), phasing, anti-patterns |
| `requirements.md` | **Elaborated requirements** — goals/KPIs, design rules, per-feature mechanics, edge cases, acceptance criteria, funnel events, `[VALIDATE]` list, dev handoff |
| `copy-bank.md` | **Copy bank** — umbrella taglines, persona archetypes, quiz copy, quests, badges, levels, share cards, translation notes |
| `lore-layer-plan.md` | **The Halcova Library** — content & curation strategy: taxonomy (T1–T8), sourcing/fact-checking, truthfulness & legal rules, localization, launch coverage, pack structure, ownership |
| `lore/` | **Lore pack workspace** — `README.md` + per-pack dirs (`pack.json`, `sources.md`, `localization-notes.md`, `validation-log.md`); starts with the `foundations/` pack |
| `rollout-plan.md` | **Phased rollout plan** — PM-owned: phase slicing (0, 1.1–1.4, 2, 3), owners, gates, and open decisions |

## The pitch in one line

> Catalog once. Play forever.

## The four pillars (→ the user's four goals)

| Goal | Pillar | Feature |
| --- | --- | --- |
| What do I **like**? | Persona | A funny, shareable "what your shelf says about you" archetype from the *contents* you own — genres, eras, artists, authors |
| What do I **remember**? | Crate Quiz | A 60-second daily game about the *things you own* — artist, year, label, tracklist, and the story behind them (offline-safe) |
| What should I **buy next**? | Quests | "Crate Digger" quests: finish a discography, fill a decade gap, same-artist blind spots, lending quests |
| What did I **learn**? | Shelf Stories | Facts + lore tiers: collection facts, era lessons, artist constellations, and sourced anecdotes from the Halcova Library — each can become a quest |
| (glue) | Progression + share | XP, funny levels/badges, daily streaks, dark-`#16130F`+gold share cards |

## Phasing

- **Phase 1 — Know & Play:** Persona, Quiz, Shelf Stories, XP/levels/badges/
  streaks, share cards. **Zero runtime API, offline-safe** — content comes from
  two offline sources: **Phase A** blob enrichment of the stored item (stable
  artist/volume ids, tracklist, series, synopsis) and **Phase B** the precached
  Halcova Library (`src/content/lore/*.js` + pure `lookupLore()`); computed
  metadata facts are the always-present fallback.
- **Phase 2 — Next & Dig:** Quests + quest progress/rewards (Discogs
  discography via the existing proxy — `[VALIDATE]`).
- **Phase 3 — Social & Seasonal:** opt-in friend challenges, seasonal events
  (Record Store Day quests, Summer Reading Bingo).

## Open items `[VALIDATE]`

1. Discogs artist-discography endpoint + rate limits (quests).
2. **RESOLVED (contents-first pivot):** the Impulse Buyer badge / event log —
   the badge is cut, so no `dateAdded` bucketing is needed; XP/badges derive
   idempotently from item state + the client gameplay ledger.
3. Streak "day" boundary (server vs local time).
4. Lending-feature data queryable client-side (lending quests) — confirm stable.
5. Share-card renderer (SVG/canvas) — no new deps, self-hosted font if needed.
6. Native-speaker humor check for all copy in fr, nl, pt-BR, de, es, it.
7. Are `notes` part of the item objects returned by `collection.js` (quiz
   "your notes say…" reveal — shown only when present, paired with a lore fact).
8. Lore match keys for `lookupLore(item)` (records: `masterId`/`discogsId`/
   artist id or name; books: `googleBooksId`/author; + label/decade for cards).
9. PWA precache budget for the Halcova Library (code-split, ≤ current envelope).
10. Collection-list offline caching gap (the games need the collection offline).
11. Security gate on the schema/allowlist change for the Phase-A fields.

## What this does NOT do

- No app code edits from here (Marketing Manager scope) — copy ships via the
  catalog `.copy` / i18n keys; a Front End Developer implements per
  `requirements.md` §12.
- No leaderboards, no pay-to-win, no fake urgency, no leaked codes or internals.
