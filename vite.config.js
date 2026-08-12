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
        name: 'Hokan — Records & Books',
        short_name: 'Hokan',
        description: 'Hokan — scan a barcode, catalog the thing. Your records and books in one app. Never double-buy: it knows what you already own.',
        theme_color: '#16130F',
        background_color: '#16130F',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,wasm}'],
        runtimeCaching: [
          {
            // Lookups go through the Netlify function proxies (the server-side
            // Blob cache is the primary dedup). This is just a modest client
            // cache so repeat lookups don't re-hit the network.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/.netlify/functions/discogs') ||
              url.pathname.startsWith('/.netlify/functions/books'),
            handler: 'NetworkFirst',
            options: { cacheName: 'lookup-api', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 } },
          },
          {
            urlPattern: ({ url }) => url.hostname.includes('discogs.com') && /\.(jpe?g|png|gif)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'discogs-images', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 } },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'books.google.com' && /\.(jpe?g|png|gif|webp)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'google-books-images', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 } },
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
