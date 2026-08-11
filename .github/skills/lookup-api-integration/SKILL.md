---
name: lookup-api-integration
description: 'Add or change a lookup API in Runout (Discogs for records, Google Books for books). Covers the Discogs server proxy (single token + shared cache), normalizing responses to the shared item shape, rate limits, error codes, and adding a brand-new provider. Triggers: "Discogs", "Google Books", "lookup API", "search API", "token", "rate limit", "normalize", "provider".'
---
# Lookup API Integration

Runout looks up scanned codes and text against external APIs. Records go
through a **server-side Discogs proxy** (`netlify/functions/discogs.js`) that
owns one token and caches responses; books are looked up straight from the
browser (`src/api/books.js`). This skill covers extending them or adding a new
provider.

## When to Use
- Fix a lookup bug, handle a new error code, or adjust normalization.
- Add a new provider (e.g. MusicBrainz) and wire it as a catalog's `api`.

## Provider Contract
Each `src/api/<provider>.js` exports:
- `searchByBarcode(code)` → array of candidate items (item shape)
- `searchByText(query)` → array of candidates (top ~20)
- `getDetail(id)` → detail fields for the Detail view

Errors carry a `code` so the flow shows the right message:
- `SERVER_NO_TOKEN` → the site hasn't configured a Discogs token yet (ask the
  owner to set `RUNOUT_DISCOGS_TOKEN`)
- `BAD_TOKEN` → token rejected (Discogs 401)
- `RATE_LIMIT` → provider rate limit (429)
- `HTTP_ERROR` → other non-OK response

## Conventions (read both files first)
- Normalize inside the API module — never in views.
- Clean codes to digits (`/[^0-9Xx]/g`) before searching.
- **Discogs**: `src/api/discogs.js` calls the **`/.netlify/functions/discogs`
  proxy** with the user's access code as `Authorization: Bearer`. The function
  (`netlify/functions/discogs.js`) owns the single `RUNOUT_DISCOGS_TOKEN`, sends
  a `User-Agent` header (Discogs policy), and caches responses in the shared
  `discogs-cache` blob store (barcode/release: 30 days, text search: 1 day).
  Errors: 401 → `BAD_TOKEN`, 429 → `RATE_LIMIT`, missing env →
  `SERVER_NO_TOKEN`. No token is ever stored in the browser.
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
