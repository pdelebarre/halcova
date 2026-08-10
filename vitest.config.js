import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Test config is separate from vite.config.js so the PWA plugin doesn't run
// (and the service worker / wasm precaching don't interfere) during tests.
export default defineConfig({
  plugins: [react()],
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
    include: ['src/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**'],
      exclude: [
        'src/main.jsx',
        'src/test/**',
      ],
    },
  },
})
