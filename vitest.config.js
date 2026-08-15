import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test config is separate from vite.config.js so the PWA plugin doesn't run
// (and the service worker / wasm precaching don't interfere) during tests.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The real module only exists when vite-plugin-pwa is active. Point it
      // at a no-op stub in tests (see src/test/mock-pwa-register.js).
      'virtual:pwa-register': fileURLToPath(new URL('./src/test/mock-pwa-register.js', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        // A real http origin is required for jsdom's localStorage to work
        // (an opaque origin like about:blank disables it).
        url: 'http://localhost:3000',
      },
    },
    globals: true,
    css: false,
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}', 'netlify/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**', 'netlify/**'],
      exclude: [
        'src/main.jsx',
        'src/test/**',
        'netlify/**/*.test.js',
      ],
      // The team's coverage gate: `npm run test:coverage` fails if any metric
      // drops below 70%. Keep the agents/skills in sync with these numbers.
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
  },
})
