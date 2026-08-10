# Item Shape Contract

Every cataloged item is a plain object with this shape, shared by records and
books so `CollectionView.jsx`, `useCollection`, and `findRelated` work
unchanged for any kind.

## Core fields

| Field | Type | Meaning |
|---|---|---|
| `title` | string | `"Artist - Author - Title"` — split with `splitArtistTitle` |
| `year` | string | release / publication year |
| `label` | string | label (records) / publisher (books) |
| `genre` | string[] | genres / categories |
| `coverImage` | string | https cover URL |
| `barcode` | string | cleaned barcode / ISBN (digits only) |
| `id` | string | server-assigned UUID (added by the Netlify function) |
| `dateAdded` | string | ISO timestamp (added by the Netlify function) |

## Kind-specific ids

- **Records** (`discogsId`): also `catno`, `formatRaw`, `formatType`, `style`,
  `country`, `resourceUrl`, `discogsType`.
- **Books** (`googleBooksId`): also `isbn`, `description`, `pageCount`,
  `language`, `infoLink`, `resourceUrl`.

## Lookup API contract

Each `src/api/<kind>.js` exports:

- `searchByBarcode(code)` → array of candidate items
- `searchByText(query)` → array of candidate items (top ~20)
- `getDetail(id)` → detail fields for the Detail view

Lookup errors carry a `code` so the flow shows the right message:

- `NO_TOKEN` → "Add a <lookupName> token first…" (opens Settings)
- `BAD_TOKEN` → token rejected (Discogs 401)
- `RATE_LIMIT` → provider rate limit (429)
- `HTTP_ERROR` → any other non-OK response
