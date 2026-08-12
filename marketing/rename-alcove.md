# Rename Plan — "Alcove" (FINAL)

**Status:** Locked decision · **Owner:** Marketing Manager · **Date:** 2026-08-12
**Supersedes:** `rename-strategy.md` (R1 · "Trove"), `rename-strategy-round2.md`,
`rename-strategy-round3.md`, `rename-strategy-round4-international.md`
(iteration history kept on file for reference).

---

## 1. Decision

**Rename the public brand from `Runout` to `Alcove`.**

Chosen under the user's constraints:
- must **sound good in EN, FR, PT, NL, DE, ES, IT**,
- must carry **treasure + cozy**,
- must **bridge records and books** (both media, one collection flow).

**Why Alcove:** a warm recessed nook that holds your treasures — and it is a
real, natural word in the **same family across all seven target languages**
(`alcove` / `alcôve` / `alcova` / `alkoof` / `Alkoven` / `alcoba` / `alcova`).
It's 6 letters (fits the PWA `short_name` ≤ 12 limit), two soft syllables, and
it names a *place* — exactly like the product's own voice ("your crate",
"your shelf"). It carries both the cozy warmth and the treasure-keeping idea,
and it sits naturally on the dark `#16130F` aesthetic.

---

## 2. Why the name works (grounded in the real product)

| Requirement | How Alcove meets it |
| --- | --- |
| Bridges records **and** books | Names the *place the collection lives*, not the media — no vinyl-only or book-only bias |
| Treasure + cozy | An alcove *holds your treasures*; warm, intimate, sheltering |
| International | True cognate family in all 7 target languages (see §4) |
| Sound | Two soft syllables ("AL-cove"), no awkward digraphs, easy to say/type |
| Fits the brand | Dark, collector, "curated space" mood; works as a proper noun in all markets |

---

## 3. Brand architecture

```
[ Product ]  ALCOVE
[ Records ]  your crate, cataloged     ← keep (recordsCatalog.copy.emptyTagline)
[ Books  ]  your shelf, cataloged      ← keep (booksCatalog.copy.emptyTagline)
[ Tagline ]  Two loves. One alcove.
```

**Taglines (all trace to real behavior):**
- *"Two loves. One alcove."* — the two-catalog product, warm.
- *"Scan it. Keep it. Find it."* — scan → add → search/filter (F-01, F-08, F-09).
- *"Never rebuy what you already own."* — duplicate detection (F-07).
- *"Every crate, every shelf, in its own alcove."* — the two collections, together.

**One-line positioning (landing page / README / press):**
> Alcove is the app that catalogs your records and books by scanning their
> barcodes — it looks them up on Discogs and Google Books, remembers what you
> already own so you never double-buy, and keeps your crate and your shelf
> together in one cozy place. No app store, no account setup: it runs in your
> browser and installs to your home screen.

---

## 4. International verification (summary)

| EN | FR | PT | NL | DE | ES | IT | Negative meaning |
| --- | --- | --- | --- | --- | --- | --- | --- |
| alcove | alcôve | alcova | alkoof | Alkoven | alcoba | alcova | none found |

- Full per-language notes in `rename-strategy-round4-international.md`.
- **`[VALIDATE]`** — a native-speaker pronunciation/meaning check for the 7
  target languages is still required before launch (names with the same
  written form can drift in connotation).

---

## 5. Legal & availability checklist — `[VALIDATE]` (required before commit)

1. **Trademark search** — EUIPO, USPTO, WIPO, INPI, and Japan/other target
   markets, classes 09 (software) and 41 (entertainment/education). Also check
   *Alcove* coworking and any "Alcove" apps.
2. **Domain check** — exact-match `.com`, `.app`, plus country TLDs for target
   markets; expect `getalcove.*` / `tryalcove.*` / `.app` as realistic homes.
3. **App-store collisions** — Apple App Store + Google Play (even though the
   product is a PWA today; it affects a future native build).
4. **Social handles** — `@alcove` on Instagram/TikTok/Bluesky/YouTube/X.
5. **Bad-word scan** — confirm no vulgar or negative meaning in any of the 7
   target languages (native check).

---

## 6. Rollout map — every public surface to change

### Public / user-visible (must change)

| # | Surface | File | Current | Change to |
| --- | --- | --- | --- | --- |
| 1 | In-app header wordmark | `src/components/Header.jsx` (~line 52, `<span className="wordmark">`) | `Runout` | `Alcove` |
| 2 | Auth "no collections" screen | `src/App.jsx` (~line 46, `auth-wordmark`) | `Runout` | `Alcove` |
| 3 | Browser tab title | `index.html` (`<title>`) | `Runout — Records & Books` | `Alcove — Records & Books` |
| 4 | iOS home-screen title | `index.html` (`apple-mobile-web-app-title`) | `Runout` | `Alcove` |
| 5 | SEO description | `index.html` (`meta description`) | current | repositioned line (§3) |
| 6 | PWA install name | `vite.config.js` (`manifest.name`) | `Runout — Records & Books` | `Alcove — Records & Books` |
| 7 | PWA short name (icon label) | `vite.config.js` (`manifest.short_name`) | `Runout` | `Alcove` |
| 8 | PWA install description | `vite.config.js` (`manifest.description`) | current | repositioned line |
| 9 | App icon / favicon / touch icons | `public/favicon.png`, `apple-touch-icon.png`, `icon-*.png` | Runout mark | new mark `[VALIDATE: design]` |
| 10 | README title & copy | `README.md` | "Runout — …" | "Alcove — …" |
| 11 | Docs / instructions (brand refs) | `docs/functional.md`, `docs/technical.md`, `docs/design-redesign.md`, `.github/copilot-instructions.md` | Runout | Alcove |

### Internal identifiers — keep (deliberately)

| Identifier | Location | Why keep |
| --- | --- | --- |
| `package.json` `name: "runout"` | internal | no public impact |
| `RUNOUT_ADMIN_KEY` env | internal | renaming env vars is a deployment risk |
| Blob stores (`runout-identity`, …) | `netlify/functions/_shared/users.js` | data — no migration for a cosmetic rename |
| `localStorage.runout.session`, `runout_discogs_token_local` | internal | renaming logs users out |
| Discogs User-Agent `RunoutRecordCollector/1.0` | `src/api/discogs.js` | Discogs expects a stable UA |

> A full internal rename (env, stores, keys) is a separate migration chore if
> ever wanted — do it with the Tester + Netlify Backend agents, not with this
> rebrand.

### In-app copy handoff (to the Front End Developer)

- The wordmark is **component markup**, not catalog `.copy` (items 1–2).
- **Keep** the media taglines: `recordsCatalog.copy.emptyTagline`
  (`"your crate, cataloged"`) and `booksCatalog.copy.emptyTagline`
  (`"your shelf, cataloged"`).
- If a product tagline is ever added inside the app, route it through the
  catalog `.copy` blocks as a separate feature.

---

## 7. Measuring the rename

| Stage | Event | Why |
| --- | --- | --- |
| Reach | landing pageviews, social impressions | did the name travel? |
| Activation | sign-in / access-code requests | did the name + landing convert? |
| Retention | return visits, items cataloged per user | is the product sticky? |
| Brand recall | **branded search %** (e.g. "alcove app") | the rename KPI — do people search the name? |

Use UTM params per channel on the landing page.

---

## 8. Next steps

1. **`[VALIDATE]`** Native-speaker pronunciation/meaning check across EN/FR/PT/NL/DE/ES/IT.
2. **`[VALIDATE]`** Legal gate (§5): trademark + domain + stores + handles.
3. **`[VALIDATE]`** Icon mark on the dark theme (brief the UI/UX Expert / Figma);
   regenerate `public/` icons.
4. **Implement** items 1–8 of §6 on a `chore/rename-alcove` branch (never `main`).
5. **Name day** — flip the PWA manifest + wordmark + icons together so installed
   home-screen icons don't fork.
6. **Launch copy** — `copy-kit-alcove.md`.
