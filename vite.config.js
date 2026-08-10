import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Runout — Record Collection',
        short_name: 'Runout',
        description: 'Scan a barcode, catalog the record. Your LP, EP and CD collection in one crate.',
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
            urlPattern: ({ url }) => url.hostname === 'api.discogs.com',
            handler: 'NetworkFirst',
            options: { cacheName: 'discogs-api', expiration: { maxEntries: 200 } },
          },
          {
            urlPattern: ({ url }) => url.hostname.includes('discogs.com') && /\.(jpe?g|png|gif)$/i.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'discogs-images', expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 } },
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
