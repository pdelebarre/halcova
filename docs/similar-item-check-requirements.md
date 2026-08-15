# Similar-item check before adding — requirements clarification

Status: **Requirements confirmed (2026-08-15) — ready for implementation** · Owner: Product / Front End Developer

## 1. Goal

> When I add a new item, I want to know whether I already own a **similar** item —
> a book in another edition or another language, or a record I already have in
> another format (e.g. adding a CD when I already own the LP) — **before** the
> item lands in my collection.

This document clarifies what "similar" means, what already exists in the app, the
gaps, the proposed match model, and the open decisions that need a product call.

## 2. Current behavior (grounded in code)

Every path into adding — barcode auto-match, picker selection, text search, manual
entry, cover OCR — funnels through the same check before anything is saved:

- `CollectionView.jsx` → `presentCandidate()` → `findRelated()` in
  `src/utils/match.js`, rendered by `ScanResult.jsx` (the result sheet).

`findRelated` already classifies a candidate against the owned collection and the
wishlist:

| Result | Rule | UI today |
| --- | --- | --- |
| `ownedExact` | same `discogsId`, **or** same `googleBooksId`, **or** same `barcode`/ISBN | Banner "Already in your crate/shelf", button becomes **Add anyway** |
| `wishlistExact` | same in wishlist | Banner "In your wishlist", button becomes **Own it** |
| `sameAlbum` | same normalized **artist + album title** string, but not the exact release | Caution banner "You already own this album/book — different pressing/format/edition", button stays **Add** |
| `otherArtist` | other works by the same artist/author | "More by {name} in your crate (n)" list |

The result sheet shows the related items ("Other pressings you own" / "Other
editions you own") and each row opens the owned item for comparison.

**Key point: part of this feature already exists.** Scanning a CD when you own the
LP already triggers the caution banner, because Discogs uses the same
"Artist - Album" title across formats. So the request is to make this check
*reliable and complete*, not to build it from scratch.

## 3. Gaps identified

### 3.1 Books — another language (not handled)

`sameAlbum` compares the title string exactly (lowercased/trimmed only — no
diacritic or punctuation stripping). A translated title is a different string:

- Owned: `Antoine de Saint-Exupéry - Le Petit Prince` (FR, ISBN-A)
- Scanned: `Antoine de Saint-Exupéry - The Little Prince` (EN, ISBN-B)

→ different `googleBooksId`, different ISBN, different title → classified **New
item**. The user's exact example.

### 3.2 Records — format variants are only matched by title string

The CD-vs-LP case works **only because the normalized title matches**. It breaks
whenever titles differ across pressings/reissues:

- `Kind of Blue` vs `Kind of Blue (Mono)`
- reissues / deluxe / expanded editions, compilations, live albums

Discogs has a proper grouping concept — **`master_id`** (all formats/countries/
pressings of one album). The Discogs search API returns `master_id` in every
result, but `src/api/discogs.js` currently **does not carry it** into the item, so
Runout ignores the most reliable "same album" signal it could use.

### 3.3 Normalization is too weak

`findRelated` uses a local `normalize()` that only lowercases + trims. The app
already has `normalizeText()` (lowercase + diacritic stripping) used by search, but
`findRelated` doesn't use it. So `José` vs `Jose`, `Téléphone` vs `Telephone`, and
punctuation differences all miss.

### 3.4 Manual entries

Manual adds have no IDs and often no barcode, so they can only ever match by
title. Fuzzy/tolerant matching is needed or two manual entries of the same thing
will never flag each other.

### 3.5 Old items lack the new signals

Even after we start storing `masterId` and `language`, existing items don't have
them. Backfill or lazy enrichment is required or the check silently misses on old
collections.

## 4. Proposed match model

Replace the binary `sameAlbum` with a classified **similarity result** so the UI can
explain *why* an item is "similar" and the user can decide. Confidence is part of
the output.

| Level | Meaning | Signals (records) | Signals (books) | Confidence | Action |
| --- | --- | --- | --- | --- | --- |
| L1 Exact | the very same release/volume | `discogsId` / `barcode` | `googleBooksId` / `isbn` | high | Banner **owned**; button **Add anyway** |
| L2 Same work, different format/pressing | the CD vs the LP | `masterId` equal, else normalized artist+album title | — | high | Caution banner + list; button **Add** |
| L3 Same work, different edition | other printing/publisher/format (pb/hc/ebook/audio) | — | same author + same normalized title, different `googleBooksId`/`isbn`/publisher/year | high | Caution banner + list; button **Add** |
| L4 Same work, different language | translation, or same-title different-lang edition | — | author matches + (normalized title matches **or** Google Books `seriesId` matches) **and** `language` differs | medium | Caution banner + list; button **Add** |
| L4b Possible match (translated title) | title fully translated, not reliably matchable | — | author matches + `language` differs from an owned work by that author + loose title overlap | **low** | Soft "possibly related" hint; never blocks |
| L5 Same artist/author, different work | informational | artist matches | author matches | — | Existing "More by …" list (unchanged) |

Rules of thumb:

- **Records**: `masterId` is preferred over title matching when present; title
  matching stays as the fallback (manual items, master-less releases).
- **Books**: Google Books has no master/work ID. `seriesInfo.bookSeries[].seriesId`
  (already returned by Google Books for many series) is the closest thing to a
  "work" grouping and is the strongest cross-language signal we can get cheaply.
- **Never block on L4/L4b** — only inform. Blocking a translated edition the user
  actually wants (e.g. they collect a book in several languages) would be wrong.
- **Anti-nagging**: L4b must stay quiet unless the author match + language
  conflict is real; an author with many books must not produce a hint on every add.

## 5. Normalization & thresholds

Apply one shared normalizer to artist/author and title for all comparison levels
(reuse/export `normalizeText` from `src/utils/match.js`):

- lowercase
- strip diacritics (NFD) — `José` → `jose`
- strip punctuation, collapse whitespace

Title similarity:

- **Strong match**: normalized title equality → L2/L3 (and L4 if languages differ).
- **Weak match**: ≤ 1-edit fuzzy equality per word (reuse the existing
  `editDistance` bounded to 1) → candidate for L4b "possible" tier.

## 6. Data model changes

Items are stored wholesale (`netlify/functions/collection.js` keeps
`{ ...body, id, dateAdded }`), so new fields persist automatically once the
lookup normalization includes them — no schema migration needed.

| Field | Kind | Source | Where added |
| --- | --- | --- | --- |
| `masterId` | records (new) | Discogs search result `master_id` | `src/api/discogs.js` (both `searchByBarcode` and `searchByText`) |
| `language` | books (already returned, **persist & use**) | Google Books `volumeInfo.language` | already in `src/api/books.js` → now consumed by `findRelated` |
| `isbn10` / `isbn13` | books (nice-to-have) | Google Books `industryIdentifiers` | `src/api/books.js` |
| `seriesId` | books (nice-to-have) | Google Books `seriesInfo.bookSeries[0].seriesId` | `src/api/books.js` |

Note: `language`, `isbn`, `pageCount`, `description` are already computed in
`src/api/books.js` `toBookItem` and already saved (they just aren't used yet).
Manual book adds don't capture language — see §9.

## 7. UX requirements (in the existing result sheet)

- Keep the single funnel: all add paths → `presentCandidate` → result sheet.
- Banner levels: **owned** (L1) / **caution** (L2/L3/L4) / **possible** (L4b, new
  muted tone) / **good** (new).
- Explain the reason in the banner sub-copy, e.g. "You already have this on **LP**"
  (L2), "You already own **another edition**" (L3), "You already have this in
  **French**" (L4) — needs the matching owned item(s) rendered as a tappable list,
  which already exists ("Other pressings/editions you own").
- **Do not block (confirmed)**: adding a similar item (L2–L4) stays one-tap
  **Add** with the caution banner; only L1 changes to **Add anyway**.
- Optional enhancement: a **Compare** affordance on a related row that shows the
  owned item vs the candidate side-by-side (currently a row opens the owned item's
  detail, which is a reasonable first version).
- Optional: after adding a similar item, offer **Link these as related** so the
  user curates the grouping (future).

### Copy keys to update (via catalog `.copy` — do not hardcode in components)

Point the Front End Developer at `src/catalog.js`:

- `recordsCatalog.copy.resultSame` — "Different pressing or format — check before buying."
- `booksCatalog.copy.resultSame` — "Different edition — check before buying."
- New keys for the L4 language case and the L4b possible tier, plus reason labels
  ("on LP", "in French"), mirrored across `src/i18n/locales/*`.

## 8. Backfill & migration (confirmed: lazy)

- **Records**: enrich existing items with `masterId` lazily — fetch the Discogs
  release detail (already cached 30d) when an item is opened/edited, or on first
  add of a candidate that matches by title. Full backfill would burn the shared
  Discogs token budget (rate-limited) — **lazy enrichment confirmed, no deploy-time
  backfill**.
- **Books**: backfill `language`/`seriesId` from Google Books lazily (detail is
  already fetched per item).
- No index rebuild needed: the check runs client-side over the loaded collection,
  same as today.

## 9. Edge cases & scope

- **Manual entries** (records & books): no IDs, often no barcode. They only match
  via normalized title + artist/author (L2/L3), never via master/volume. Consider
  letting users optionally add a barcode/language/format when entering manually.
- **Same title, different author** (books): "1984" by Orwell vs "1984" by someone
  else. Must not match — author must be part of every comparison.
- **Compilations / greatest hits** (records): often have their own master, so they
  won't false-positive against a studio album. Title matching could false-positive
  if titles collide — prefer `masterId`.
- **Wishlist (confirmed)**: the check also surfaces similar (non-exact) wishlist
  entries — shown as a small "Also in your wishlist" note on the related rows.
- **Cross-kind**: a book can never be a record — the check stays within one
  collection kind.

## 10. Confirmed decisions (2026-08-15)

| # | Decision | Outcome |
| --- | --- | --- |
| Q1 | Translated titles (L4b) | **Soft hint only, never blocks** — accepted that a reliable cross-language match isn't possible with the Google Books API |
| Q2 | Confirm step for similar (L2–L4) items | **Keep one-tap Add** with the caution banner; only L1 changes to "Add anyway" (interpreted as agreeing with the recommendation — easy to flip to a confirm if desired) |
| Q3 | Same-format multiple copies (2× LP, different pressings) | **Keep current semantics**: same `discogsId` → L1; same `masterId` (any format) → L2 (interpreted as keeping current behavior) |
| Q4 | Backfill budget | **Lazy enrichment** of old items (no deploy-time backfill) |
| Q5 | Wishlist similarity | **Include** similar (non-exact) wishlist matches in the check ("Also in your wishlist" note) |

Implementation copy is handed off in `marketing/handoff-similar-item-copy.md`.

## 11. Claims needing product validation (do not ship untested copy)

- Discogs `master_id` coverage: present for master-linked releases; some
  standalone releases return none — the title fallback must stay. **Verify on real
  data** that the CD-scan-when-LP-owned case surfaces reliably with `masterId`.
- Google Books `seriesInfo.seriesId` is only populated for a subset of books —
  treat as a bonus signal, never a requirement.
- Translated-title matching (L4b) is inherently approximate — agree the
  false-positive/negative trade-off before writing copy that promises a
  cross-language check.

## 12. Implementation order (final)

1. Add `masterId` (records) + persist/use `language` (books) in normalization
   (`src/api/discogs.js`, `src/api/books.js`).
2. Extend `findRelated` to return classified `similar` results with reasons +
   confidence (reuse `normalizeText`), keep old fields for compatibility; include
   similar (non-exact) wishlist matches (Q5).
3. Result-sheet UI: reason-aware banner sub-copy + muted "possible" tone (Q1), keep
   one-tap **Add** for L2–L4 (Q2), keep L1 vs L2 semantics for same-format doubles
   (Q3). Wire banner copy through `t()` so it localizes — see the copy handoff in
   `marketing/handoff-similar-item-copy.md`.
4. Tests: `src/utils/match.test.js` cases for L2/L3/L4/L4b (see `testing` skill).
5. Lazy enrichment of old items (§8).
6. Update `docs/functional.md` §5 table to the new model.
