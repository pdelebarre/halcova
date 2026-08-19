import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Visible update prompt: instead of silently auto-updating, a new build
      // shows a "New version available" banner (src/components/UpdateNotice.jsx)
      // with a Reload button. `injectRegister: false` stops the plugin from
      // injecting <script src="/registerSW.js"> — we register from code via
      // `virtual:pwa-register` so we can surface the update to the user.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Halcova — Records & Books',
        short_name: 'Halcova',
        description: 'Halcova — scan a barcode, catalog the thing. Your records and books in one app. Never double-buy: it knows what you already own.',
        theme_color: '#16130F',
        background_color: '#16130F',
        display: 'standalone',
        // No orientation lock: the layout already supports landscape (iPad,
        // desktop web apps), and `orientation` is ignored outside mobile.
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // woff2/woff added so the self-hosted @fontsource faces are precached
        // (offline-complete shell, phase 0). wasm must stay for the scanner.
        // gz added for the OCR traineddata (Tesseract lang data) so cover
        // scanning works offline once the worker has loaded once.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,wasm,gz,woff2,woff}'],
        // The OCR core (3.9 MB wasm.js) and English traineddata (10.9 MB gz)
        // blow past workbox's default 2 MiB precache cap — raise it so cover
        // scanning is fully available offline.
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        // Offline navigation fallback (M1 shell, #157): the app is an SPA with
        // a single precached `index.html`. Without a navigateFallback, a
        // reload or deep-link navigation while offline returns a network error
        // for any URL that isn't literally `/`. Serving the precached shell
        // for every navigation means the installed app reloads offline and the
        // client router shows the right view from its own route state. Only
        // non-asset navigations are affected; the `navigations` runtime rule
        // below is what actually routes them.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Route navigations (client-route changes, reloads, deep links)
            // NetworkFirst so online navigations always fetch fresh HTML, but
            // fall back to the precached index.html when offline — this is
            // what makes "reload the installed app offline" succeed. It is
            // scoped strictly to `request.mode === 'navigate'`, so it can
            // never capture an API/private data response.
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'navigations', networkTimeoutSeconds: 3 },
          },
          {
            // Cover images are re-hosted through the lookup functions (T6,
            // ADR-0002) so the browser never touches 3rd-party hosts. Cache
            // them CacheFirst: immutable in practice, so serve from cache and
            // fall back to the proxy on miss.
            urlPattern: ({ url }) =>
              (url.pathname.startsWith('/.netlify/functions/discogs') ||
               url.pathname.startsWith('/.netlify/functions/books')) &&
              url.searchParams.get('action') === 'cover',
            handler: 'CacheFirst',
            options: { cacheName: 'covers', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            // Lookups go through the Netlify function proxies (the server-side
            // Blob cache is the primary dedup). This is just a modest client
            // cache so repeat lookups don't re-hit the network. Cover requests
            // are excluded — they're handled CacheFirst above.
            urlPattern: ({ url }) =>
              (url.pathname.startsWith('/.netlify/functions/discogs') ||
               url.pathname.startsWith('/.netlify/functions/books')) &&
              url.searchParams.get('action') !== 'cover',
            handler: 'NetworkFirst',
            options: { cacheName: 'lookup-api', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 } },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      // In local dev, forward function calls to `netlify dev` (port 8888) if running.
      '/.netlify/functions': 'http://localhost:8888',
    },
  },
})
