# Business Analysis — Theme per Collection Type

**Status:** Business analysis (decision input) · **Owner:** Marketing Manager
**Date:** 2026-08-15 · **Scope:** analysis only — no branch, no code changes.
**Question:** Should Runout/Halcova give **records** and **books** each their
own theme — while still feeling like **one** application?

Every business claim below is grounded in the real product (`src/catalog.js`,
`docs/functional.md`, `docs/technical.md`, `marketing/copy-kit-halcova.md`).
Anything that needs a product/design or external data check is marked
`[VALIDATE]`.

---

## 1. TL;DR — recommendation

**Yes, but as "one home, two rooms," not "two apps."** Adopt a **shared-DNA +
per-kind accent** model: keep the global skeleton (the dark `#16130F` shell,
Fraunces/Inter/mono typography, the barcode motif, the header/tabs, the shared
collection flow, and **runout gold as the universal brand accent**) identical
everywhere, and let each collection type dress its own **room** — ambient
background, accent-for-surfaces, empty-state art, card micro-details, and the
scanner reticle (EAN/UPC for records, ISBN for books).

This is the **Option B** middle path:

| Option | What it is | Cohesion | Differentiation | Cost/risk |
| --- | --- | --- | --- | --- |
| **A — Status quo** | One theme everywhere | ✅ max | ❌ none | $, none |
| **B — One home, two rooms** ⭐ | Shared DNA + per-kind accent | ✅ high | ✅ clear | $$, low–medium |
| **C — Two full themes** | Distinct look per kind | ⚠️ risks "two apps" | ✅✅ max | $$$, high |

The strategic rationale is short: **the product's whole pitch is "Two loves.
One halcova."** Per-kind theming done right *reifies that promise* — each love
gets its own room inside the same house. Done wrong, it breaks the "one cozy
place" promise that `copy-kit-halcova.md` §1 sells. So the constraint is not an
obstacle; it is the **design brief**.

---

## 2. Where we are today (grounded facts)

- **One shared flow** (`src/CollectionView.jsx`) drives both kinds; a `catalog`
  object (`recordsCatalog` / `booksCatalog`) already parameterizes components,
  labels, and copy per kind. The architecture is *already* built to give each
  kind its own personality — theming is the natural next layer of that
  parameterization.
- **Per-kind differences already exist** and users already perceive two
  "rooms":
  - Header tagline flips: *"your crate, cataloged"* ↔ *"your shelf, cataloged"`.
  - Empty states differ: `empty-disc` ↔ `empty-book`.
  - Cards differ (`AlbumCard`/`BookCard`), formats chips exist only for records.
  - Scanner is shared, but the barcode *format* is genuinely different:
    EAN-13/UPC on sleeves vs ISBN on covers.
  - Gamification share cards and copy (`crate` vs `shelf`) already vary per kind.
- **The visual identity is one deliberate theme**: body `#16130F` (sleeve
  black), `runout-gold #C9A227` accent, `label-red #B23A2E` alarm, kraft
  surfaces, Fraunces serif display. Notably, **the design tokens are named
  after vinyl** (`--sleeve-black`, `--vinyl-groove`, `--jacket-kraft`,
  `--label-red`, `--runout-gold`) — the *system* already leans records.
- `docs/design-redesign.md` previously set **"no color-theme change" as a
  non-goal** — this request is therefore a deliberate reversal of a prior
  decision and deserves an explicit ADR-style decision, not an incidental one.
- **Brand**: Halcova, "Two loves. One halcova." Localization in 7 languages
  (EN/FR/NL/PT-BR/DE/ES/IT). Dark + gold brand kit (`brief-halcova-icon.md`,
  `campaign-picsart-video-spec.md` §1).

---

## 3. The business opportunity — why per-kind theming

### 3.1 Two distinct personas, two emotional registers
Vinyl collectors and book readers are different segments with different
aesthetics and rituals. The crate-digger's emotional space is **the record
shop / listening room** (warmth, gold, label red, vinyl texture). The reader's
is **the library / reading nook** (warm paper, wood, a quiet accent). Giving
each its own room lets a member whose identity is "reader who happens to own
some records" feel at home in the books tab *and* in the records tab — instead
of always living in the vinyl-coded theme.

### 3.2 Differentiation in a crowded category
Most incumbents are **single-theme** (Discogs = one utilitarian identity;
Goodreads = one brand) or **split into separate apps** (CLZ ships CLZ Music and
CLZ Books as distinct products). Per-kind theming inside *one* app is a
differentiator no major player owns: **"each collection feels like it belongs
to its own world — but it's still one app."** [VALIDATE — refresh competitor
screenshots at decision time.]

### 3.3 Activation of the second tab
A member granted both Records and Books may habitually live in one tab. A
distinct, appealing "room" for the second kind is a lightweight activation
lever: it invites exploration ("what does my shelf look like in here?") and
gives each collection an identity worth filling. This maps to a concrete KPI —
% of members granted both kinds who add ≥1 item to both within 14 days.

### 3.4 Shareability & earned media
The launch already ships **per-kind share art** (persona cards, share images).
Themed rooms make screenshots and persona cards feel bespoke per passion —
more save-worthy, more platform-native on #vinyl and #bookstagram feeds, and a
low-cost stream of campaign assets (the `campaign-picsart-video-spec.md`
brand kit can stay, with per-room color grades).

### 3.5 A scalable pattern for the future
The roadmap already has a "new catalog kind" pattern (`add-catalog-type`). A
theme-per-kind system means the *next* collection type gets a room too, without
rethinking identity each time. This turns theming from a one-off feature into
product architecture that future content can hang off.

### 3.6 Perceived premium value
Cohesive multi-room theming reads as polish and care — it supports premium
positioning and the self-serve paywall path (`ADR-0003`) by making the paid
experience feel more "owned." [Benefit is directional — validate in the private
test.]

---

## 4. The constraint — "still feel in the same application"

### 4.1 The risks
- **Brand fragmentation**: two loud themes can read as two products — the exact
  failure CLZ chose to *avoid* by shipping two apps. If a user forgets which app
  they're in, theming has failed.
- **The promise**: "your two loves, one place" (copy kit §1, §4) is the core
  message. A hard theme split undermines it.
- **Cost & QA**: two themes = two contrast passes, double visual QA, more token
  surface, more screenshots/docs to keep true. On a dark `#16130F` base, every
  new accent must hold ≥4.5:1 for text (the existing tokens already document
  this discipline — `--danger-bright` note in `src/index.css`).
- **Dark-screen risk**: the app has **no error boundary**; any theme-switching
  regression that throws during render blanks the UI. Theme switching must be
  defensively coded and tested (`docs/technical.md` / copilot-instructions
  gotchas).
- **Localization surface**: theme itself adds few strings, but if themes carry
  labels ("Room", "Theme") they must enter the 7-language dictionary.

### 4.2 The cohesion rules (what must never change between rooms)
1. **The skeleton**: `#16130F` body, typography (Fraunces / Inter / IBM Plex
   Mono), radii, spacing, the header + Records|Books tabs, bottom sheets.
2. **The brand anchor**: **runout gold stays the universal Halcova accent** for
   the wordmark, icons, primary CTAs, and brand moments — it is the thread that
   makes both rooms read as one app (and it's the shipped icon/brand-kit gold).
3. **The motif**: the barcode element appears in both rooms (it's in the icon
   brief and the scanner is the product's signature gesture).
4. **The flow**: scan → confirm → never-rebuy logic is identical; only the
   "décor" differs.
5. **Copy discipline**: crate↔shelf wording stays exactly as the catalog
   parameterizes it; no new vocabulary per room unless it ships in the
   dictionary.

---

## 5. Recommended model — "One home, two rooms"

### 5.1 What differentiates (the "décor" per kind)
| Surface | Records room (crate) | Books room (shelf) |
| --- | --- | --- |
| Ambient background tint | current warm vinyl black (status quo) | a subtly distinct warm tint on the same `#16130F` family `[VALIDATE]` |
| Surfaces accent (chips, active states, focus) | runout gold (status quo) | a **books accent** — see 5.2 `[VALIDATE]` |
| Alarm/"already own" accent | label red (status quo, semantic) | keep **semantic** colors identical across rooms (danger = danger everywhere) |
| Empty state & hero art | vinyl/crate illustration | book/reading-nook illustration |
| Card micro-details | vinyl "peek" badge by format (exists) | a shelf-like treatment (exists — `BookCard`) |
| Scanner reticle | EAN/UPC framing | ISBN framing — same scanner, kind-specific targeting overlay |
| Gamification share card | crate persona card (exists) | shelf persona card (exists) |

**Semantic colors (danger, success, owned states) stay global and identical** —
they carry meaning, not personality, and color-only semantics are already
guarded by label+icon+text (per `design-redesign.md`).

### 5.2 Candidate book accents (directional — UI/UX Expert to prototype) `[VALIDATE]`
All must pass contrast on the dark base and feel "library," not "second brand":

- **Warm amber/brass** — closest to gold → maximum cohesion, minimum
  differentiation (probably too close to feel like a *different* room).
- **Reading-room green (muted sage/forest)** — clearly distinct hue from gold,
  reads "library/study," strong dark-theme contrast; check cultural
  associations per market (see §7).
- **Oxblood/terracotta** — bookish (Penguin classics), but risks colliding with
  the semantic **label-red** used for "already own / danger" in records; would
  need careful separation.

**Recommendation to test:** green-family for books vs gold for records, with
gold retained everywhere as the tie. Directional only — the UI/UX Expert owns
the palette, with a contrast gate (≥4.5:1 text / ≥3:1 UI).

### 5.3 Token hygiene (flag for Front End Architect)
Current tokens are **vinyl-named** (`--sleeve-black`, `--vinyl-groove`,
`--jacket-kraft`, `--label-red`, `--runout-gold`). Recommendation: introduce a
**neutral core token layer** (dark base, text, semantic colors) + **per-kind
accent alias groups** (`--kind-records-accent`, `--kind-books-accent`), so
records stays visually identical today and books gains a room without a
breaking visual rewrite. This is a design/architecture decision — not done by
Marketing.

---

## 6. Audience & market segmentation (who feels this)

| Segment | Primary kind | What theming does for them |
| --- | --- | --- |
| Vinyl-first collectors (Discogs-heavy, crate-diggers) | Records | Records room keeps current identity — zero disruption; gold/vinyl is theirs |
| Reader-first (Bookstagram, Goodreads-adjacent) | Books | A shelf that looks like *their* world, not the record shop's |
| Dual collectors (both tabs) | Both | The payoff of "Two loves. One halcova." — the flagship segment to win |
| Family/shared households (multi-member) | Both | Each member's granted kind gets its own recognizable room |

Market note: the private-test circle is FR/NL/PT-BR/DE/ES/IT + EN
(`private-test-plan.md`). It is the ideal lab to validate whether theming
moves activation/attitude before any public spend.

---

## 7. International & localization considerations

- **Color meaning varies by market** `[VALIDATE]`:
  - Gold (records anchor): positive across target markets (premium/warm) — safe.
  - Green (candidate for books): generally positive (nature, calm) but has
    religion/flag associations in some regions; check DE/ES/IT/BR specifically
    before locking it.
  - Red (semantic "already own"): stays **semantic**, never thematic — already
    used carefully per market copy.
  - Rule: **theme accents must never carry meaning** (keep semantics global).
- **Barcode formats are a genuine, global-safe differentiation**: records =
  EAN-13/UPC (Discogs), books = ISBN (Google Books). A kind-specific scanner
  reticle is *true to the product* and needs no translation — a strong "room"
  signal with zero copy cost. Keep both formats supported (F-01 already
  decodes them).
- **Copy**: theming should add near-zero strings; if we add labels ("Room",
  "Shelf theme", settings), they enter `localization-dictionary.md` and all 7
  locales — keep them out of the v1 to avoid dictionary churn.
- **Accessibility across languages**: dark-theme contrast must hold for every
  locale (no locale-specific text-length/color interactions expected; verify
  DE/PT-BR longer strings in chips).

---

## 8. Competitive scan (directional — re-check at decision time)

| Player | Model | Signal for us |
| --- | --- | --- |
| **Discogs** (discogs.com) | Records-first; single utilitarian identity; "Millions of Records… All In One App." | A giant that offers breadth but one look; a themed "room" is differentiation |
| **Goodreads** (goodreads.com) | Books-only; single brand; discovery/social focus | Not a barcode cataloger; no "crate" analogue — no direct theming lesson |
| **CLZ Music / CLZ Books** (clz.com) | **Separate apps** per kind | Proves kind-specific identity is wanted — but at the cost of "one app" cohesion; our "one home, two rooms" is the middle path |
| **LibraryThing** | Books-only cataloging | Single-brand; not a theming benchmark |

All external claims are directional; refresh with current screenshots/store
listings at decision time `[VALIDATE]`.

---

## 9. Measurement plan (proposed events — none exist today `[VALIDATE]`)

Product/analytics hooks to propose (Front End + data owner to confirm):

- **Activation per room**: % of members with both kinds granted who add ≥1 item
  to *each* kind within 14 days (pre/post theming).
- **Engagement per room**: items added, wishlist adds, "Crate/Shelf dive,"
  browse filters, notes, share-card saves — segmented by kind.
- **Retention**: 7/30-day return by kind; whether books-tab usage rises with a
  distinct books room.
- **Perception**: private-test survey questions (does the books tab "feel like
  it belongs"? does it still feel like the same app?) — the cohesion KPI.
- **Campaign UTM**: if theming ships as a marketing beat (launch/screenshots),
  tag per-channel links per `campaign-landing-page.md`; room-specific
  screenshots are a natural A/B for ad creative.
- **No new pricing claims**: theming must not be marketed as a paid feature
  without product/`ADR-0003` sign-off.

---

## 10. Recommended rollout (phasing — after this analysis is accepted)

1. **Phase 0 — Validate (no code):** private-test survey (7-language circle):
   do users *want* distinct rooms? Which book accent reads best? Cohesion test
   (same-app perception). Owner: Marketing + UI/UX Expert.
2. **Phase 1 — Architecture (records unchanged):** neutral token layer +
   per-kind accent aliases; records keeps today's look (visual no-op, low risk).
   Owner: Front End Architect/Developer. Branch: `feat/theme-per-collection`.
3. **Phase 2 — Books room (flag-gated):** ship books accent + reticle behind a
   per-kind flag; run A/B on the private circle. Owner: Front End Developer +
   Tester (contrast + no dark-screen regression).
4. **Phase 3 — Marketing:** per-room screenshots, share cards, campaign beat.
   Owner: Marketing Manager.
5. **Phase 4 — Document:** ADR capturing the reversal of the
   "no color-theme change" non-goal. Owner: Whole Stack Architect.

Gates between phases: Phase 0 go/no-go on survey; Phase 2 go/no-go on
activation + cohesion metrics + contrast/QA pass.

---

## 11. Claims needing product validation `[VALIDATE]`

1. That distinct rooms measurably raise second-tab activation/retention — needs
   Phase 0/2 measurement; directional today.
2. Candidate book accent color(s) — palette + contrast to be owned/prototyped
   by UI/UX Expert; green direction is a hypothesis.
3. Cross-market color associations (esp. green in DE/ES/IT/BR) — native check.
4. Current competitor screenshots/positioning — refresh at decision time.
5. Proposed analytics events don't exist yet — confirm feasibility/cost.
6. Token restructure scope/effort — Front End Architect to size.
7. Whether theming belongs on the paid/self-serve tier — `ADR-0003` owner.

---

## 12. Next steps

1. Decide **Option B** ("one home, two rooms") as the working hypothesis.
2. Marketing drafts the Phase 0 private-test survey (room desirability, book
   accent options, same-app perception) — ready for the 7-language circle.
3. Hand the token/architecture proposal to the **Front End Architect** (neutral
   tokens + per-kind aliases, records unchanged) and the palette prototype to
   the **UI/UX Expert** (with contrast gates).
4. Re-run this analysis after Phase 0 data before any implementation branch is
   created.
