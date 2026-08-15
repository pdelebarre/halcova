---
name: testing
description: "Runout's Vitest + Testing Library conventions: what and where to test (pure logic in src/utils/match.js, API normalization in src/api/* with mocked fetch, the useCollection hook with a mocked api module), behavior-first test names, coverage, and the jsdom/localStorage quirks. Triggers: 'test', 'tests', 'unit test', 'vitest', 'testing library', 'add tests', 'test coverage', 'failing test', 'coverage'."
---
# Testing

Runout tests with **Vitest + Testing Library** (jsdom environment). The test
config lives in `vitest.config.js` — deliberately separate from
`vite.config.js` so the PWA plugin (service worker / wasm precache) never runs
during tests.

## When to Use
- Add or extend tests (new feature, new catalog kind, new API provider).
- Fix a failing test, or raise coverage on the shared flow.
- Change behavior of `match.js`, `src/api/*`, or `useCollection`.

## Setup
- Config: `vitest.config.js` — `environment: 'jsdom'`, `globals: true`,
  `setupFiles: ['./src/test/setup.js']`, coverage v8 (reports to `./coverage`,
  excludes `src/main.jsx` and `src/test/**`).
- `src/test/setup.js` — jest-dom matchers, auto `cleanup`, mock/global
  restoration after each test, and an **in-memory `localStorage` polyfill**
  (Node 26's experimental global `localStorage` hides jsdom's — don't "fix"
  this by removing the polyfill).
- Commands:
  ```bash
  npm test              # vitest run
  npm run test:watch    # vitest watch
  npm run test:coverage # vitest run --coverage
  ```

## Where Tests Live & What to Test
Test files sit **next to their source** (`src/utils/match.test.js`,
`src/api/books.test.js`, `src/hooks/useCollection.test.js`, …) — Vitest
discovers `src/**/*.test.{js,jsx}`.

1. **Pure logic** (easiest, highest value): `splitArtistTitle` (with/without
   ` - `, edge cases) and `findRelated` (exact duplicate, same album different
   pressing, other albums by the same artist, no match) in `src/utils/match.js`.
2. **API normalization** (`src/api/*`): given a mocked raw response, the
   result matches the item shape (title as `"Artist - Author - Title"`, year
   slicing, http→https covers, ISBN fallback, missing-field handling). See
   `src/api/books.test.js` for the pattern.
3. **`useCollection`**: optimistic `add`/`update`/`remove` and the rollback on
   failure (mock `src/api/collection` with `vi.mock`; assert the hook's items
   revert when the mock rejects).
4. **`catalog.js`**: `src/catalog.test.js` keeps the catalog contract honest
   (every catalog has the keys the flow needs).

## Mocking Conventions
- **Never hit the real network**: Discogs / Google Books are mocked by
  stubbing `global.fetch` (see `books.test.js`: `global.fetch = vi.fn()` +
  `mockResolvedValue({ ok: true, status: 200, json: async () => data })`).
- Hook tests mock the api module, not `fetch`.
- `beforeEach` re-stubs; `afterEach` in `setup.js` restores mocks and clears
  localStorage so tests don't leak into each other.

## Name Tests as Behaviors
Use `describe`/`it` that read like requirements, not implementation:
- Good: `it('cleans the ISBN, queries by isbn: and normalizes volumes')`
- Avoid: `it('calls fetch with the right params')`

## Gotchas
- **`onBlur` won't fire on `el.blur()`** if focus never moved to a focusable
  element — use `userEvent.click()` on another button to trigger a real save.
- The spinning `empty-disc` CSS animation breaks Playwright's "stable" click
  check — use `page.evaluate(() => el.click())` or `{ force: true }` when
  testing the empty state in a browser.
- Dark-screen render crashes (no error boundary) are best caught with a
  component render test that feeds a weird item shape.
- Coverage excludes `src/main.jsx` and `src/test/**` by design; don't add
  tests for entry-point or test-helper files.

## Coverage Threshold
- The team gates on **70%** for all four metrics — `statements`, `branches`,
  `functions`, `lines` — enforced by `coverage.thresholds` in
  `vitest.config.js`. `npm run test:coverage` exits non-zero if any metric
  falls below 70%.
- Branches is usually the tightest metric; new conditionals without tests show
  up there first.
- Never lower the threshold to make the suite green — write the missing tests,
  or narrow the `exclude` list deliberately and explain why.

## Verification
- `npm test` is green, `npm run test:coverage` clears the 70% threshold, and
  `npm run lint` stays clean before you call work done.
