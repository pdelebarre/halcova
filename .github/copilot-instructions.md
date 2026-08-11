# Runout — Project Guidelines

Runout (package name `runout`, repo `vinyl-crate`) is a React 19 + Vite 8 PWA
for cataloging vinyl records and books by scanning barcodes. There is no app
server — just a static frontend plus one Netlify function backed by Netlify
Blobs.

## Architecture

- **One shared collection flow** (`src/CollectionView.jsx`) drives *both*
  records and books. A `catalog` object (`src/catalog.js`: `recordsCatalog`,
  `booksCatalog`) parameterizes everything: which lookup API to call, which
  components render items, and the copy used in labels/toasts/empty states.
- **Item shape** is identical for records and books: `title` stored as
  `"Artist - Author - Title"`, plus `year`, `label`, `genre`, `coverImage`,
  `barcode`, and a kind-specific id (`discogsId` / `googleBooksId`).
- **Lookup APIs** live in `src/api/*` (Discogs, Google Books) and normalize
  raw responses into the item shape above. Errors carry a `code`
  (`NO_TOKEN`, `BAD_TOKEN`, `RATE_LIMIT`, `HTTP_ERROR`).
- **Auth** (no passwords): the owner signs in with the admin key
  (`RUNOUT_ADMIN_KEY` env / `.env`); members request access and are approved
  from the admin panel, which issues `RU-XXXX-XXXX-XXXX` access codes. The
  session lives at `localStorage.runout.session` and every function call
  carries `Authorization: Bearer <code>`. See `src/api/auth.js`,
  `netlify/functions/auth.js` + `admin.js`, `netlify/functions/_shared/`.
- **Storage**: `netlify/functions/collection.js` is a CRUD API over Netlify
  Blobs. Every request is authorized (Bearer code / admin key). The owner
  keeps the legacy stores (`runout-collection` / `runout-library`); each
  member gets isolated `collection-<userId>-<kind>` stores (see
  `storeNameFor` in `netlify/functions/_shared/users.js`). The frontend talks
  to it via `src/api/collection.js` and `src/hooks/useCollection.js`
  (optimistic updates with rollback on failure).
- **PWA**: `vite-plugin-pwa` (`vite.config.js`) precaches the shell *and* the
  scanner `.wasm`, with NetworkFirst caching for the Discogs/Google Books APIs
  and CacheFirst for their cover images.

## Conventions

- Split titles with `splitArtistTitle` from `src/utils/match.js` — never
  reimplement it. A missing import here has caused real render crashes.
- **There is no error boundary.** Any uncaught render error unmounts React to
  a dark screen (`body` background is `#16130F`). Guard new item data paths
  defensively.
- User-facing copy belongs in the catalog object's `.copy`, not hardcoded in
  components.
- Normalize API responses to the item shape inside `src/api/*`, never in views.
- Barcodes/ISBNs are cleaned to digits (`/[^0-9Xx]/g`) before searching.
- Duplicate detection matches on `discogsId` / `googleBooksId` / `barcode`
  (see `findRelated` in `src/utils/match.js`).
- **Never leak secrets**: don't log access codes or the admin key; strip the
  `code` field before sending users to the client (`publicUser` in
  `netlify/functions/_shared/auth.js`).

## Build & Test

```bash
npm install --cache "$TMPDIR/npm-cache"   # sandbox: use temp npm cache
npm run dev        # frontend on :5173 (functions proxied to :8888)
netlify dev        # frontend + functions together, usually :8888
npm run lint       # oxlint
npm test           # vitest run
npm run test:watch / test:coverage
npm run build      # vite build (PWA precaches the scanner wasm)
```

## Gotchas

- The scanner's `zxing-wasm` is self-hosted and precached by the PWA — keep the
  `?url` import + `locateFile` override + `.wasm` in `globPatterns` if you touch
  it.
- Camera APIs require HTTPS or `localhost`.
- Deploy with `netlify deploy --build` — drag-and-drop of `dist` skips
  `netlify/functions` and breaks the collection API. Set `RUNOUT_ADMIN_KEY` in
  production (never the dev fallback).
- Vite's file watcher can serve stale transforms under the sandbox — after
  editing, re-request the file or restart the dev server before debugging.

## Workflows

- **Agents** (`.github/agents/`), two layers:
  - *Roles*: `Project Manager` (orchestrates the team), `Whole Stack
    Architect` (cloud/scalability/backend design), `Front End Architect`
    (front-end design/review), `Front End Developer` (implement), `Tester`
    (QA), `Security Auditor` (security review), `UI UX Expert` (ergonomics +
    Figma design via MCP).
  - *Domain specialists*: `Runout Engineer` (general), `Catalog Designer`
    (new collection kinds), `Scanner Builder` (camera + zxing-wasm),
    `Netlify Backend` (functions / Blobs / auth / PWA), `Ergonomics Reviewer`
    (read-only UX/ergonomics/a11y review).
- **Skills** (`.github/skills/`):
  - `add-catalog-type` — add a new kind of collectible (records → books pattern)
  - `barcode-scanning` — the zxing-wasm camera scanner
  - `lookup-api-integration` — Discogs / Google Books / new providers
  - `netlify-collection` — the Netlify function + Blobs backend
  - `auth-access` — access codes, admin panel, per-collection plans
  - `pwa-offline` — precaching, runtime caching, offline behavior
  - `testing` — Vitest + Testing Library conventions
  - `ergonomics-review` — read-only UX/ergonomics/a11y audit checklist
  - `whole-stack-architecture` — cloud/scalability review + backend design
  - `figma-design` — Figma MCP workflows + design tokens
- **Prompts** (`.github/prompts/`): `add-catalog-tests`, `deploy-to-netlify`,
  `fix-dark-screen`, `review-changes`, `update-copy`, `review-ergonomics`,
  `fix-ergonomics`, `review-architecture`, `design-in-figma`.
- Detailed docs: `docs/technical.md`, `docs/functional.md`.
