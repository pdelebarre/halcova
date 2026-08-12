// Test stand-in for vite-plugin-pwa's `virtual:pwa-register` module.
//
// The real module is only provided by the PWA plugin at build/dev time, and
// `vitest.config.js` intentionally omits that plugin (so the service worker /
// wasm precaching don't interfere with tests). We alias `virtual:pwa-register`
// to this stub so bare imports resolve; tests that care about update behavior
// mock the module anyway (see src/__tests__/update-notice.test.jsx).
export function registerSW() {
  return () => {}
}
