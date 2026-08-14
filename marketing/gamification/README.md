# marketing/gamification — "Halcova Arcade"

Gamification suite for the app (working brand: **Halcova**). Turns a private
catalog into a daily habit loop that helps members discover **what they like**,
**what to buy next**, **what they remember**, and **what they learned** from
their collection.

**Status:** concept + requirements elaboration, ready for product validation and
a dev estimate. The PM-owned phased rollout plan is in `rollout-plan.md`. Work
lives on the `feat/gamification` branch.

## Authoritative files (use these)

| File | What it is |
| --- | --- |
| `concept.md` | **The creative concept** — insight, the four discovery pillars, core loop, six game ideas, phasing, anti-patterns |
| `requirements.md` | **Elaborated requirements** — goals/KPIs, design rules, per-feature mechanics, edge cases, acceptance criteria, funnel events, `[VALIDATE]` list, dev handoff |
| `copy-bank.md` | **Copy bank** — umbrella taglines, persona archetypes, quiz copy, quests, badges, levels, share cards, translation notes |
| `rollout-plan.md` | **Phased rollout plan** — PM-owned: phase slicing (0, 1.1–1.4, 2, 3), owners, gates, and open decisions |

## The pitch in one line

> Catalog once. Play forever.

## The four pillars (→ the user's four goals)

| Goal | Pillar | Feature |
| --- | --- | --- |
| What do I **like**? | Persona | A funny, shareable "what your crate says about you" archetype from your data |
| What do I **remember**? | Crate Quiz | A 60-second daily memory game built only from your own items (offline-safe) |
| What should I **buy next**? | Quests | "Crate Digger" quests: finish a discography, fill a decade gap, same-artist blind spots, lending quests |
| What did I **learn**? | Shelf Stories | Collection facts, era lessons, artist constellations — each can become a quest |
| (glue) | Progression + share | XP, funny levels/badges, daily streaks, dark-`#16130F`+gold share cards |

## Phasing

- **Phase 1 — Know & Play:** Persona, Quiz, Shelf Stories, XP/levels/badges/
  streaks, share cards. **Zero backend, zero API, offline-safe** — all derived
  client-side from data the app already stores.
- **Phase 2 — Next & Dig:** Quests + quest progress/rewards (Discogs
  discography via the existing proxy — `[VALIDATE]`).
- **Phase 3 — Social & Seasonal:** opt-in friend challenges, seasonal events
  (Record Store Day quests, Summer Reading Bingo).

## Open items `[VALIDATE]`

1. Discogs artist-discography endpoint + rate limits (quests).
2. Event log vs deriving badges/XP from item data + `dateAdded` ("Impulse Buyer"
   badge feasibility).
3. Streak "day" boundary (server vs local time).
4. Lending-feature data queryable client-side (lending quests) — confirm stable.
5. Share-card renderer (SVG/canvas) — no new deps, self-hosted font if needed.
6. Native-speaker humor check for all copy in fr, nl, pt-BR, de, es, it.
7. Are `notes` part of the item objects returned by `collection.js` (quiz
   "your notes say…" reveal)?

## What this does NOT do

- No app code edits from here (Marketing Manager scope) — copy ships via the
  catalog `.copy` / i18n keys; a Front End Developer implements per
  `requirements.md` §12.
- No leaderboards, no pay-to-win, no fake urgency, no leaked codes or internals.
