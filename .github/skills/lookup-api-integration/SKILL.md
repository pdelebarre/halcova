---
name: lookup-api-integration
description: 'Add or change a lookup API in Runout (Discogs for records, Google Books for books). Covers normalizing responses to the shared item shape, token storage in localStorage, rate limits, error codes, and adding a brand-new provider. Triggers: "Discogs", "Google Books", "lookup API", "search API", "token", "rate limit", "normalize", "provider".'
---
# Lookup API Integration

Runout looks up scanned codes and text against external APIs straight from the
browser. Two providers exist: Discogs (`src/api/discogs.js`, records) and
Google Books (`src/api/books.js`, books). This skill covers extending them or
adding a new provider.

## When to Use
- Fix a lookup bug, handle a new error code, or adjust normalization.
- Add a new provider (e.g. MusicBrainz) and wire it as a catalog's `api`.

## Provider Contract
Each `src/api/<provider>.js` exports:
- `searchByBarcode(code)` → array of candidate items (item shape)
- `searchByText(query)` → array of candidates (top ~20)
- `getDetail(id)` → detail fields for the Detail view

Errors carry a `code` so the flow shows the right message:
- `NO_TOKEN` → "Add a <lookupName> token first…" (opens Settings)
- `BAD_TOKEN` → token rejected (Discogs 401)
- `RATE_LIMIT` → provider rate limit (429)
- `HTTP_ERROR` → other non-OK response

## Conventions (read both files first)
- Normalize inside the API module — never in views.
- Clean codes to digits (`/[^0-9Xx]/g`) before searching.
- **Discogs**: needs a personal token at
  `localStorage.runout_discogs_token` (`getToken`/`setToken`/`hasToken`); send
  a `User-Agent` header (Discogs policy); 401 → `BAD_TOKEN`, 429 →
  `RATE_LIMIT`.
- **Google Books**: no token; add `country=US`; upshift `http://` cover URLs to
  `https://` to avoid mixed-content blanks; slice the year from ISO dates
  (`"2012-03-01"` → `"2012"`).
- Titles are saved as `"Artist - Author - Title"` so `splitArtistTitle` works.

## Procedure — New Provider
1. Create `src/api/<provider>.js` modeled on `books.js` (the simpler template).
2. Normalize results to the item shape; pick a kind-specific id and `barcode`.
3. Point a new `<kind>Catalog` entry in `src/catalog.js` at its `api` +
   `getDetail`.
4. Follow `.github/skills/add-catalog-type/SKILL.md` for the rest (components,
   storage, tests).

## Verification
- Unit-test the pure normalization functions.
- Hit the provider from the integrated browser and confirm the item shape
  renders correctly in the match picker.
