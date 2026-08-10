---
name: add-catalog-type
description: 'Add a new collection type to Runout (cassettes, 7" singles, DVDs, movies, games — anything with a lookup API). Follows the records → books pattern: new API module, catalog object in src/catalog.js, Card/Grid/Detail/ManualAdd components, a new blob store, and tests. Triggers: "new catalog", "add a collection type", "catalog a new kind of thing", "add cassettes", "new entity".'
---
# Add a Catalog Type

Runout catalogs records and books through one shared flow
(`src/CollectionView.jsx`). This skill is the checklist for adding a third (or
fourth) kind by copying the existing `records → books` pattern.

## When to Use
- The user asks to catalog a new kind of thing (cassettes, 7"s, DVDs, comics…).
- Any work that adds or changes the `catalog` abstraction in `src/catalog.js`.

## The Pattern in One Line
A catalog = a lookup API (normalizes to the item shape) + 4 components
(Card, Grid, Detail, ManualAdd) + a `catalog` object + a blob store + copy.
Templates: `recordsCatalog`/`booksCatalog` in `src/catalog.js`, and
`src/api/books.js` as the simplest API module.

## Item Shape Contract
Every item is a plain object with: `title` (`"Artist - Author - Title"`),
`year`, `label`, `genre` (array), `coverImage`, `barcode`, plus a kind-specific
id (`discogsId` / `googleBooksId`). See
[references/item-shape.md](./references/item-shape.md) for the full table.

## Procedure
1. **API module** — create `src/api/<kind>.js` with `searchByBarcode(code)`,
   `searchByText(query)`, and `getDetail(id)`, normalizing results into the item
   shape. Copy `src/api/books.js` and follow the `lookup-api-integration` skill.
2. **Components** — create `Card`, `Grid`, `Detail`, and `ManualAdd` under
   `src/components/` modeled on the records/books counterparts, reusing
   `styles/shared.css` and the matching `*.css` files.
3. **Catalog object** — add `<kind>Catalog` to `src/catalog.js` with every key
   the existing catalogs have: `kind`, `entity`, `collectionLabel`, `storage`,
   `api`, `getDetail`, `lookupName`, `formats` (chips or `[]`), `genreLabel`,
   `artistLabel`, `sortOptions`, `components`, `detailLink`, and the full `copy`
   block (empty state, toasts, lookups, duplicate messaging).
4. **Storage** — add the new kind to `COLLECTIONS` in
   `netlify/functions/collection.js` and a store mapping in `storeNameFor` in
   `netlify/functions/_shared/users.js` so records/books/<kind> never mix and
   member stores stay isolated per kind (see the `netlify-collection` skill).
   Remember every collection endpoint is auth-gated (Bearer code / admin key).
5. **Tab wiring (if a top-level kind)** — add the tab in `App.jsx` and select
   the catalog by tab the same way `catalog.js` selects today.
6. **Duplicate detection** — `findRelated` in `src/utils/match.js` matches on
   `discogsId` / `googleBooksId` / `barcode`; add your id to the contract if it
   introduces a new identity field.
7. **Tests** — add tests for the API normalization and any kind-specific
   behavior; follow the `testing` skill (Vitest + Testing Library).
8. **Verify** — `npm run lint`, `npm test`, `npm run build`, then a quick
   manual check in the browser (scan/lookup → add → reload persists).

## Checklist
- [ ] API module normalizes to the item shape — no raw API fields leak to views
- [ ] `catalog.js` object complete (every `copy` key present)
- [ ] New blob store added (records/books stay isolated)
- [ ] Components follow existing ones and reuse `styles/shared.css`
- [ ] Lint + tests + build pass
