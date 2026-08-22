# RETRO-2.1 — esbuild import resolution blind spot

- **Date:** 2026-08-22
- **Team:** AI
- **Issue:** #310 AI provider test/dry-run dashboard (deploy fix ce60d01)
- **Mistake:** `ai-dryrun.js` imported `{ buildProvider }` from `./ai-admin`, but `ai-admin.js` defined it as a plain `function buildProvider(...)` — no `export` keyword. Unit tests (Vitest) never caught this because `dryRunFeedback` tests mock the provider adapter, so the real import graph was never traced.
- **Root cause:** The test suite covers the *mocked* import path, not the *bundler's* import path. Vitest resolves imports per-file with module-level mocking; esbuild (Netlify's bundler) tree-shakes the full module graph and fails when an import has no matching export. These two resolution strategies are not equivalent — a test-suite PASS can coexist with a bundler FAIL.
- **Detection:** Only surfaced at deploy time (`netlify deploy --prod`), not during CI `npm test` or `npm run build` (the Vite build does not bundle `netlify/functions/`; esbuild does that at deploy time).
- **Rule:** Any PR that adds a new `import` from an existing or new `netlify/functions/_shared/` module must verify that the exported symbol actually exists in the target module. The safest way is `netlify build --dry-run` (or `npm run build` for the client; for functions, `npx esbuild --bundle netlify/functions/admin.js --outfile=/dev/null 2>&1` or a deploy dry-run). A simpler check: grep for `export` in the target module matching the import name.
- **Gate:** Release Validator pre-submit checklist — `netlify build --dry-run` (or equivalent bundler check) must pass for any PR touching `netlify/functions/` or `_shared/` files.