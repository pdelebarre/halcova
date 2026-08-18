# Runout — Project Guidelines

Runout (package name `runout`, repo `vinyl-crate`) is a React 19 + Vite 8 PWA for cataloging vinyl records and books by scanning barcodes. There is no app server — just a static frontend plus one Netlify function backed by Netlify Blobs.

## Agent governance

Halcova uses a governed multi-agent delivery model. The **Project Manager is accountable for orchestration and milestone advancement**, but specialist agents retain independent technical authority and blocking gates.

Canonical sources:
- `docs/agents/responsibility-matrix.md` — responsibilities, authority and veto gates.
- `docs/adr/0014-agent-orchestration-and-governance.md` — governance decision/rationale.
- `.github/skills/agentic-workflow/SKILL.md` — execution graph and gate loops.
- GitHub #355 — canonical milestone roadmap and exit criteria.

Rules:
- PM cannot convert a mandatory specialist FAIL into PASS.
- Security Auditor blocks security-sensitive completion; Multi-tenant Security blocks tenant-isolation completion.
- Tester owns the required quality/test verdict.
- Relevant architecture/data/API/platform/offline agents own their specialist design gates.
- Ergonomics Reviewer blocks defined critical UX/accessibility gates.
- An implementation agent does not approve its own security or quality gate.
- A milestone advances only after its #355 exit criteria and mandatory specialist gates pass.

## Architecture

- **One shared collection flow** (`src/CollectionView.jsx`) drives *both* records and books. A `catalog` object (`src/catalog.js`: `recordsCatalog`, `booksCatalog`) parameterizes everything: which lookup API to call, which components render items, and the copy used in labels/toasts/empty states.
- **Item shape** is identical for records and books: `title` stored as `"Artist - Author - Title"`, plus `year`, `label`, `genre`, `coverImage`, `barcode`, and a kind-specific id (`discogsId` / `googleBooksId`).
- **Lookup APIs** live in `src/api/*` (Discogs, Google Books) and normalize raw responses into the item shape above. Errors carry a `code` (`NO_TOKEN`, `BAD_TOKEN`, `RATE_LIMIT`, `HTTP_ERROR`).
- **Auth** (no passwords): the owner signs in with the admin key (`RUNOUT_ADMIN_KEY` env / `.env`); members request access and are approved from the admin panel, which issues `RU-XXXX-XXXX-XXXX` access codes. The session lives at `localStorage.runout.session` and every function call carries `Authorization: Bearer <code>`. See `src/api/auth.js`, `netlify/functions/auth.js` + `admin.js`, `netlify/functions/_shared/`.
- **Storage**: `netlify/functions/collection.js` is a CRUD API over Netlify Blobs. Every request is authorized (Bearer code / admin key). The owner keeps the legacy stores (`runout-collection` / `runout-library`); each member gets isolated `collection-<userId>-<kind>` stores (see `storeNameFor` in `netlify/functions/_shared/users.js`). The frontend talks to it via `src/api/collection.js` and `src/hooks/useCollection.js` (optimistic updates with rollback on failure).
- **PWA**: `vite-plugin-pwa` (`vite.config.js`) precaches the shell *and* the scanner `.wasm`, with NetworkFirst caching for the Discogs/Google Books APIs and CacheFirst for their cover images.

## Conventions

- Split titles with `splitArtistTitle` from `src/utils/match.js` — never reimplement it. A missing import here has caused real render crashes.
- **There is no error boundary.** Any uncaught render error unmounts React to a dark screen (`body` background is `#16130F`). Guard new item data paths defensively.
- User-facing copy belongs in the catalog object's `.copy`, not hardcoded in components.
- Normalize API responses to the item shape inside `src/api/*`, never in views.
- Barcodes/ISBNs are cleaned to digits (`/[^0-9Xx]/g`) before searching.
- Duplicate detection matches on `discogsId` / `googleBooksId` / `barcode` (see `findRelated` in `src/utils/match.js`).
- **Never leak secrets**: don't log access codes or the admin key; strip the `code` field before sending users to the client (`publicUser` in `netlify/functions/_shared/auth.js`).
- **Mandatory security gate**: any change touching auth, authorization, user data, payments, storage, caching, external APIs, or databases requires threat modeling + negative security tests and a `Security Auditor` (or `Multi-tenant Security` for tenant isolation) review before it is declared done.

## Tickets & Epics

- **Every ticket is a GitHub issue and belongs to exactly one parent epic.** Never file a ticket without linking it to its epic issue. If no epic exists for the work, create one (labeled `epic`) before creating any subtask tickets.
- **Epic naming:** `[DOMAIN]-EPIC-<N>` for work-stream epics (e.g. `SEC-EPIC-1`, `SEC-EPIC-2`, … for security); product/marketing epics use `epic #<N>`. An epic is a numbered issue labeled `epic` that links all of its subtask tickets.
- **Ticket naming:** numbered issues within an epic, referenced as `#<N>` (e.g. `#176`, `#188`). Follow the epic's `T<k>` subtask ordering (T1, T2, …) and reference the epic + ticket in code/comments/docs as `(EPIC, #ticket)`, e.g. `(SEC-EPIC-1, #176)`. Apply the epic's labels (`backend`, `frontend`, `i18n`, `qa`, `marketing`, `security`, `enhancement`, `priority:P0–P3`, `blocked`).
- The Project Manager owns this: identify the parent epic before breaking work into tasks, and never hand off a task that isn't tied to a ticket + epic.
- Live epic/ticket map and milestone plan: `marketing/backlog-grooming-launch-handoff.md`.

## Branching & Version Control

- **Never commit new feature work directly to `main`.** Before starting any new feature, create a feature branch from `main`: `git switch -c feat/<kebab-slug>`.
- Use intent prefixes, kebab-case, short names: `feat/` (features), `fix/` (bug fixes), `docs/` (documentation), `chore/` (tooling/refactors).
- The Project Manager (or implementing agent) creates the branch before work starts; implementation, tests, and docs for that feature live on it.
- Sync with `main` regularly (`git fetch origin && git merge origin/main`), and finish with a pull request — don't push straight to `main`.
- Exceptions are allowed only when the user explicitly says to work on `main`.

## Build & Test

```bash
npm install --cache "$TMPDIR/npm-cache"
npm run dev
netlify dev
npm run lint
npm test
npm run test:coverage
npm run build
```

## Workflows

- **Agents:** Project Manager (orchestrator); Whole Stack Architect, Front End Architect, Data Architect, Platform Architect and Offline Architect (architecture); API Contract Reviewer; Front End Developer / Runout Engineer (implementation); Tester (quality gate); Security Auditor / Multi-tenant Security (security gates); UI UX Expert / Ergonomics Reviewer (experience); Catalog Designer / Scanner Builder / Netlify Backend (domain implementation); Observability Engineer (operational evidence); Agent Developer (agent system); Marketing Manager (GTM).
- **Skills:** `agentic-workflow` is the canonical governed execution graph; other skills define domain procedures and must respect its authority/gate model.

Detailed docs: `docs/technical.md`, `docs/functional.md`.
