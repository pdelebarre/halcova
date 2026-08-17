---
name: pwa-offline
description: "Runout's PWA & offline layer (vite-plugin-pwa in vite.config.js): precaching the shell and the scanner .wasm, runtime caching for the Google Books API (NetworkFirst) and cover images (CacheFirst), the manifest, service worker auto-update, and offline behavior on iOS Safari. Record lookups go through the /discogs Netlify function, which caches in Netlify Blobs server-side. Triggers: 'PWA', 'offline', 'service worker', 'precache', 'cache', 'install app', 'add to home screen', 'workbox', 'runtime caching', 'wasm precache', 'offline mode'."
---
# PWA & Offline

Runout is an installable PWA. The shell (HTML/CSS/JS/icons **and the scanner
`.wasm`**) is precached at build time, and lookup API responses + cover images
are cached at runtime so the app keeps working on a flaky connection.

## When to Use
- Change the manifest, icons, or start URL.
- Add/remove a runtime cache rule (new lookup host, image CDN, etc.).
- Debug offline behavior, stale data, or why the scanner wasm isn't cached.
- Touch the service worker / `vite.config.js` `workbox` block.

## How It Works (all in `vite.config.js`)
- **`vite-plugin-pwa`**, `registerType: 'autoUpdate'` — the SW updates itself;
  no manual "update available" banner.
- **`globPatterns: ['**/*.{js,css,html,png,svg,ico,wasm}']`** — precaches the
  app shell AND `zxing_reader.wasm`. The `wasm` extension here is what keeps
  the scanner working offline — never remove it.
- **Manifest**: name `Runout — Records & Books`, `theme_color`/`background_color`
  `#16130F`, `display: 'standalone'`, `orientation: 'portrait'`, icons
  192 / 512 / maskable.
- **Runtime caching**:
  - discogs images (`*.discogs.com` jpg/png/gif) → **CacheFirst**
    (`discogs-images`, 500 entries, 30 days). Lookup *responses* aren't cached
    in the browser — records go through the `/discogs` Netlify function, which
    caches them in Netlify Blobs server-side.
  - `www.googleapis.com` → **NetworkFirst** (`google-books-api`, 200 entries)
  - `books.google.com` images → **CacheFirst** (`google-books-images`, 500
    entries, 30 days)

## Common Tasks
- **Add a runtime cache rule**: append an entry to `runtimeCaching` in
  `vite.config.js`. API responses → NetworkFirst; immutable cover images →
  CacheFirst with `maxAgeSeconds` (30d) and `maxEntries` (500).
- **Cache a new image host**: copy the books.google.com rule, change the
  `urlPattern` hostname, and give it its own `cacheName` (so old entries are
  evictable independently).
- **Change an icon / name**: edit the `manifest` block and
  `includeAssets`; regenerate `public/icon-*.png` (maskable needs safe zones).

## Verification
- `npm run build`, then `vite preview` (or deploy) and open DevTools →
  Application → Service Workers / Cache Storage.
- Confirm the precache list contains `zxing_reader.wasm`.
- Go Offline in DevTools: the app shell loads, cached items render, and the
  collection still shows (NetworkFirst falls back to cache).
- On a real phone: Add to Home Screen → airplane mode → open → still works.
- Camera scanning requires HTTPS or `localhost` — an HTTP LAN IP will not work.

## Gotchas
- **Do not regress wasm precaching**: the `?url` import + `locateFile` override
  in `src/components/ScannerModal.jsx` and `wasm` in `globPatterns` must all
  stay in sync.
- CacheFirst images can show stale covers for up to 30 days — bump
  `maxAgeSeconds` when a provider changes image URLs.
- `registerType: 'autoUpdate'` means a newly deployed SW takes over on the next
  load; test deploys on a clean browser profile to see fresh precache.
- The Netlify function (`/.netlify/functions/*`) is NOT cached — collection
  writes go straight to the network (correct: they must be authorized live).

## Security requirements (checklist)

Verify each item before merging a PWA/offline change:

- [ ] **Offline storage review** — list exactly what is cached (precache vs
      runtime) and why; every cache has a named, evictable entry.
- [ ] **Cache scope** — private data (collection items, session, user
      profiles) is NEVER cached in the service worker or shared caches; only
      public lookup responses and cover images are cached.
- [ ] **No sensitive caching** — the collection API and auth endpoints are
      never runtime-cached; confirm no auth/session data lands in Cache
      Storage.
- [ ] **Logout cleanup** — signing out clears cached session data and any
      user-scoped cached entries, not just `localStorage`; cache keys must not
      leak data across accounts.
- [ ] **Cross-account isolation** — cached responses are not keyed in a way
      that lets one signed-in user see another's data after sign-out or after
      signing in as a different account.
- [ ] **Wasm/precache integrity** — the scanner `.wasm` stays precached and no
      cache rule is broadened to `/*` or `*` (which could capture sensitive
      responses).
