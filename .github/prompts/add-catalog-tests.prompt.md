---
description: "Add or expand Vitest + Testing Library tests for Runout's shared collection flow: splitArtistTitle/findRelated (src/utils/match.js), useCollection (src/hooks/useCollection.js), and lookup API normalization (src/api/*). Triggers: 'add tests', 'write tests', 'test coverage', 'unit test', 'vitest', 'testing library'."
name: "Add catalog tests"
argument-hint: "What to test (e.g. 'duplicate detection in match.js')?"
agent: "Tester"
---
Write tests for the shared collection flow in Runout using Vitest + Testing
Library (already configured: jsdom environment, `@testing-library/react`).
Follow the `testing` skill in `.github/skills/testing/` for conventions and
gotchas.

## Targets (pure logic first — easiest to test well)
- `src/utils/match.js`: `splitArtistTitle` (with/without ` - `, edge cases) and
  `findRelated` (exact duplicate, same album different pressing, other albums
  by the same artist, no matches).
- `src/api/*` normalization: `searchByBarcode` / `searchByText` output matches
  the item shape (mock `global.fetch`; never hit Discogs/Google Books — see
  `src/api/books.test.js` for the pattern).
- `src/hooks/useCollection.js`: optimistic `add`/`update`/`remove` plus
  rollback on failure (mock `src/api/collection` with `vi.mock`).
- `src/catalog.js`: every catalog object exposes the keys the shared flow
  needs (mirror the existing `src/catalog.test.js`).

## Conventions
- Put test files next to sources: `src/utils/match.test.js`,
  `src/hooks/useCollection.test.js`.
- Name tests as behaviors (`describe`/`it`), not implementation details.
- Run with `npm test` (watch: `npm run test:watch`, coverage:
  `npm run test:coverage`).

## Deliverables
- New test files.
- `npm test` passes, and `npm run lint` stays clean.
