# Rename Strategy — from "Runout" to a name that sticks

> **⚠️ SUPERSEDED (2026-08-12).** This Round-1 draft recommended "Trove", which
> was rejected on sound. The **final, locked decision is `Alcove`** — see
> [`rename-alcove.md`](./rename-alcove.md). This file is kept as iteration
> history only.

**Status:** Draft for discussion (superseded) · **Owner:** Marketing Manager · **Date:** 2026-08-12
**Product being named:** Runout — a PWA that catalogs **records and books** by
scanning barcodes (EAN/UPC for records, ISBN for books), looks them up on
Discogs / Google Books, flags what you already own, and keeps your **crate**
(records) and **shelf** (books) in one app. Dark `#16130F` collector aesthetic.

> Everything below is grounded in what the app actually does (verified against
> `docs/functional.md`, `docs/technical.md`, `src/catalog.js`). Where a claim
> needs product or legal validation, it is flagged `[VALIDATE]`.

---

## 1. Executive summary

**Recommendation: rename the public brand from `Runout` to `Trove`, with
`Stack` as the strong-but-riskier alternate and `Archive` as the safe
descriptive fallback.** Keep the in-app media language — *"your crate,
cataloged"* and *"your shelf, cataloged"* — unchanged; they're good, specific,
and loved. The product name should sit *above* those lines, not replace them.

Why rename at all: `Runout` encodes only half the product (vinyl), reads as
"run **out**" (the opposite of building a collection), means nothing to book
collectors, and is hard to pronounce/type in most non-English markets. The
app is at `v0.1.0` with no store listings and no public equity — this is the
cheapest moment in the product's life to get the name right.

---

## 2. Current name diagnosis — why "Runout" doesn't stick

`Runout` is a real vinyl term (the **runout groove** — the locked spiral at the
end of a record side, where matrix numbers are etched). For a hardcore vinyl
head it's a lovely easter egg. As a brand it fails four tests:

| Test | Verdict | Why |
| --- | --- | --- |
| **Bridges records *and* books** | ✗ Fail | Vinyl-only. Book users get nothing, and books are half the product. |
| **Positive semantic pull** | ✗ Fail | "Run **out**" = depletion. The product builds a collection *up*. Wrong emotional direction. |
| **International** | ✗ Fail | Ambiguous pronunciation (`run-out` vs `roo-nout`), no meaning in FR/DE/ES/PT/JA; "runout" also collides with ski, film, and publishing jargon. |
| **Sayable / typeable / spellable** | ✗ Fail | Four distinct vowel-ish sounds, easy to mishear and misspell; not a verb or a command. |

It scores the lowest of every candidate in Section 5.

---

## 3. The product truth a name must anchor

Any winning name has to be true to the product, so it can carry a story without
fabricating features. The name must make sense for someone who:

1. **Scans a barcode** (EAN/UPC for records, ISBN for books) with their phone camera — no typing, no app store download.
2. **Catalogs two kinds of things at once** — records *and* books, one shared flow, "your crate" + "your shelf".
3. **Never double-buys** — the app flags what you already own before you add (exact release / other pressing / same artist).
4. **Shares with family** — multiple members, each with their own private crate and shelf, no passwords to remember.
5. **Keeps it for life** — server-backed storage, offline shell, installs to the home screen like a native app.

The killer insight for naming: **the word that unifies a record crate and a
bookshelf is the *collection itself*.** Vinyl lives in *stacks*; books live in
*stacks* (library stacks); a treasured collection of either is a *trove*.
Names about the container or the act of collecting bridge both media.

---

## 4. Naming criteria (weighted rubric)

| # | Criterion | Weight | What "good" looks like |
| --- | --- | --- | --- |
| 1 | **Bridges records & books** | 30% | No vinyl-only or book-only bias; names the *collection*, not the media. |
| 2 | **Sticky / memorable** | 20% | One idea, ≤ ~8 letters, repeats easily in conversation ("oh, the trove app"). |
| 3 | **International-safe** | 20% | Clean to say/type in EN/FR/DE/ES/PT/JA; no accidental profanity or wrong meaning. |
| 4 | **Unique enough** | 15% | Defensible domain + trademark; minimal collisions with known apps. |
| 5 | **Brand story** | 10% | Can carry a tagline, a verb, an icon, and the dark collector aesthetic. |
| 6 | **Sayable/typeable** | 5% | Spellable after hearing it once. |

Scores are 1–5 per criterion; weighted total is /5.

---

## 5. Candidate shortlist (scored)

### The shortlist

| Name | Bridges | Sticky | Intl | Unique | Story | Sayable | **Weighted** | Type |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Trove** | 5 | 5 | 4 | 4 | 5 | 5 | **4.65** | Evocative |
| **Stack** | 5 | 5 | 3 | 2 | 4 | 4 | **4.00** | Evocative/descriptive |
| **Archive** | 5 | 3 | 4 | 2 | 3 | 5 | **3.75** | Descriptive |
| **Scanlog** | 4 | 3 | 4 | 4 | 3 | 4 | **3.70** | Functional (coined) |
| **Case** | 5 | 3 | 3 | 2 | 4 | 4 | **3.60** | Evocative |
| **Tally** | 4 | 4 | 3 | 3 | 3 | 4 | **3.55** | Functional |
| **Ledger** | 4 | 4 | 3 | 2 | 4 | 4 | **3.50** | Evocative |
| *Runout (current)* | 1 | 2 | 2 | 4 | 3 | 2 | ***2.10*** | Insider term |

### 5.1 🏆 Trove (recommended)

- **Meaning:** a treasure hoard. A crate of records and a shelf of books are
  both *troves*. Perfectly neutral to both media — criterion #1 nailed.
- **Sticky:** one syllable, 5 letters, rare enough to be memorable, common
  enough to be understood ("treasure trove").
- **International:** near-identical in FR (`trôve`/`trouvaille`), DE, ES, PT;
  easy katakana in JA (`トローヴ`). No bad homophones found.
- **Story:** *"Two loves. One trove."* Fits the dark, collectible, treasure-vault
  aesthetic (`#16130F`). Works as a verb-ish noun ("trove your shelf").
- **Risk `[VALIDATE]`:** `trove.nla.gov.au` (Australia's national discovery
  service, a *library* product) exists — same category-ish, different market.
  A **trademark + domain search is required** (Section 7). `.app`, `gettrove.*`,
  and country TLDs are the realistic fallbacks.

### 5.2 Stack (strong alternate — domain-riskier)

- **Meaning:** stacks of vinyl *and* book stacks and library stacks. Instantly
  understood, no explanation needed.
- **Story:** *"Stack your crate. Stack your shelf."* Great verb.
- **Risk `[VALIDATE]`:** `stack.com` (Stack Overflow's), plus dozens of
  "Stack" products. A generic word = weak trademark and a domain you cannot
  own. **Only pursue if legal clears it.**

### 5.3 Archive (safe descriptive fallback)

- **Meaning:** an archive is a collection of anything — records, books, both.
  A cognate in FR/DE/ES/IT (`archive`, `Archiv`, `archivo`).
- **Weakness:** it's a category word (the Internet Archive, countless "Archive"
  apps), so it's the *least* defensible and the least "warm." Good short_name
  only if nothing else clears.

### 5.4 Function-first: Scanlog (the "say what it does" option)

- A coined compound of **scan + catalog/log** — literally the two actions the
  app performs (F-01 scanning, F-08 collection). Latin roots → clean across
  Europe. More unique than "Archive."
- **Weakness:** utilitarian, less emotional; it sells the mechanic, not the
  collector's identity.

### Why the obvious ones lose

- **Shelf / Crate** — each biases toward one media type (violates #1).
- **Groove / Wax / Sleeve** — vinyl-only (violates #1).
- **Tome / Spine** — book-only (violates #1).
- **Ledger** — collides hard with the crypto hardware wallet brand.
- **Grail** — strong in vinyl culture ("grail hunt"), weak for books.

---

## 6. Recommended brand architecture

Product name sits above the existing, per-media taglines:

```
[ Product ]  TROVE
[ Records ]  your crate, cataloged     ← keep (recordsCatalog.copy.emptyTagline)
[ Books  ]  your shelf, cataloged      ← keep (booksCatalog.copy.emptyTagline)
[ Tagline ]  Scan it. Keep it. Find it.  /  Two loves. One trove.
```

**Tagline candidates (all trace to real behavior):**
- *"Scan it. Keep it. Find it."* — maps to scan → add → search/filter (F-01, F-08, F-09).
- *"Never rebuy what you already own."* — maps to duplicate detection (F-07). Strong for the collector.
- *"Every crate, every shelf, one app."* — maps to the two-catalog product.
- *"Catalog the things you love."* — warm, general.

**One-line positioning (for landing page / README / press):**
> Trove is the app that catalogs your records and books by scanning their
> barcodes — it looks them up on Discogs and Google Books, remembers what you
> already own so you never double-buy, and keeps your crate and your shelf
> together in one place. No app store, no account setup: it runs in your
> browser and installs to your home screen.

---

## 7. Legal & availability checklist — `[VALIDATE]` (required before commit)

1. **Trademark search** (EUIPO, USPTO, WIPO, JPO) for the chosen name in
   class 09 (software) and 41 (entertainment/education) — and, for Trove, check
   the Australian National Library's use.
2. **Domain check** — exact-match `.com`, `.app`, and 5–8 country TLDs for your
   target markets; expect to use a `get*`/`try*` prefix or `.app`.
3. **App-store collisions** — search Apple App Store + Google Play for the name,
   even though the product is a PWA today (it affects a future native build).
4. **Social handles** — `@<name>` on Instagram/TikTok/Bluesky/YouTube/X.
5. **Reuse check** — ensure the name has no vulgar or negative meaning in the
   languages you plan to ship (FR/DE/ES/PT/JA at minimum).

---

## 8. International & localization notes

- **Barcode formats are not a blocker.** Records carry EAN/UPC and books carry
  ISBN — all are barcodes the scanner already reads (EAN-13, EAN-8, UPC-A,
  UPC-E, Code 128, per F-01). No region needs a different code path.
- **Distribution is region-agnostic.** Because it's a PWA (no app-store gate),
  a URL is the only distribution mechanism. The chosen **domain/TLD is the
  internationalization lever** — pick one, and localize the landing page, not
  the binary.
- **Tone by market (for the copy kit):**
  - *EN/DE/SE/JP* — feature-forward: scan, catalog, never double-buy.
  - *FR/IT/ES/PT* — emotion-forward: your collection is a treasure; "le trésor".
  - *JA/KR* — emphasize *整理/整理整頓* (organizing) and *記録* (keeping records) — order + preservation.
- **Localized name treatment:** keep the English wordmark `Trove` everywhere
  (proper noun), localize only the tagline and landing copy. Flag `[VALIDATE]`
  if you plan to translate the wordmark itself.

---

## 9. Rollout map — every public surface to change

### Public / user-visible (must change)

| # | Surface | File | Current | Change to |
| --- | --- | --- | --- | --- |
| 1 | In-app header wordmark | `src/components/Header.jsx` (line ~52, `<span className="wordmark">`) | `Runout` | `Trove` |
| 2 | Auth "no collections" screen | `src/App.jsx` (line ~46, `auth-wordmark`) | `Runout` | `Trove` |
| 3 | Browser tab title | `index.html` (`<title>`) | `Runout — Records & Books` | `Trove — Records & Books` |
| 4 | iOS home-screen title | `index.html` (`apple-mobile-web-app-title`) | `Runout` | `Trove` |
| 5 | SEO description | `index.html` (`meta description`) | "Scan a barcode, catalog the thing…" | repositioned line (Section 6) |
| 6 | PWA install name | `vite.config.js` (`manifest.name`) | `Runout — Records & Books` | `Trove — Records & Books` |
| 7 | PWA short name (icon label) | `vite.config.js` (`manifest.short_name`) | `Runout` | `Trove` |
| 8 | PWA install description | `vite.config.js` (`manifest.description`) | current | repositioned line |
| 9 | App icon / favicon / apple-touch-icon | `public/favicon.png`, `apple-touch-icon.png`, `icon-*.png` | Runout icon | new mark `[VALIDATE: design]` |
| 10 | README title & copy | `README.md` | "Runout — your crate and shelf, cataloged" | "Trove — …" |
| 11 | Docs (brand references) | `docs/functional.md`, `docs/technical.md`, `docs/design-redesign.md`, `.github/copilot-instructions.md` | Runout | Trove |

### Internal identifiers — change or not?

| Identifier | Location | Recommendation |
| --- | --- | --- |
| `package.json` `name: "runout"` | internal | Keep (or rename in a separate chore; affects nothing public) |
| `RUNOUT_ADMIN_KEY` env | internal | Keep — renaming env vars is a deployment risk; document the alias `[VALIDATE]` |
| Blob stores (`runout-identity`, `runout-collection`, …) | `netlify/functions/_shared/users.js` | Keep — data migration is not worth a cosmetic rename |
| `localStorage.runout.session`, `runout_discogs_token_local` | internal | Keep (would log users out otherwise) |
| User-Agent `RunoutRecordCollector/1.0` | `src/api/discogs.js` | Keep (Discogs expects a stable UA) or update in a chore |

> These internal keeps are deliberate: a public rebrand should not nuke
> sessions, data, or the Discogs UA. If you want a *full* rename later, do it as
> a separate migration chore with the Tester + Netlify Backend agents.

### In-app copy handoff (to the Front End Developer)

The wordmark is **not** part of the catalog `.copy` — it's component markup
(items 1–2 above). Do **not** change the per-media taglines; they stay:

- `recordsCatalog.copy.emptyTagline` → keep `"your crate, cataloged"`
- `booksCatalog.copy.emptyTagline` → keep `"your shelf, cataloged"`

If you later want a product tagline inside the app (Section 6), that would go
through the catalog `.copy` blocks — file it as a separate feature, not part of
this rename.

---

## 10. Measuring the rename

Since the product is a PWA distributed by URL, define success on the landing
page (add UTM params per channel):

| Stage | Event | Why |
| --- | --- | --- |
| Reach | pageviews, social impressions | did the name travel? |
| Activation | sign-in / access-code requests | did the name + landing convert? |
| Retention | return visits, items cataloged per user | is the product (not just the name) sticky? |
| Brand recall | `branded search %` (e.g. "trove app") | **the** rename KPI — do people search the name? |

---

## 11. Next steps

1. **Legal gate:** run Section 7 (trademark + domain + store + handles) for
   `Trove` and `Stack` — pick whichever clears; `Archive` is the fallback.
2. **Icon `[VALIDATE]`:** brief the UI/UX Expert (Figma) for a Trove-appropriate
   mark on the dark `#16130F` theme, and regenerate `public/` icons.
3. **Implement:** hand items 1–8 of the rollout table to the Front End
   Developer on a `chore/rename-trove` branch (do not touch `main`).
4. **Launch copy:** use `marketing/rename-copy-kit.md` for the landing page,
   announcement posts, and per-market messaging.
5. **Ship date:** pick a single "name day" to flip the PWA manifest + wordmark
   together so installed home-screen icons don't fork.

*Sources: competitor naming landscape reviewed 2026-08-12 — CLZ (clz.com,
"CLZ is THE collection database software", Music/Books apps) and Libib
(libib.com, "Cloud Cataloging", barcode-scan home libraries) — both position
utilitarian names for the same category, leaving the emotional "trove"
positioning open.*
