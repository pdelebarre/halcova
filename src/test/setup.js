import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Backend test files (netlify/**) run under `// @vitest-environment node` and
// have no `window`/DOM — skip the jsdom-only setup below for them. The static
// imports above are safe in node (they only touch the DOM when called).
if (typeof window !== 'undefined') {
  // Node 26 ships an experimental global `localStorage` that is only usable with
  // --localstorage-file. Vitest's jsdom environment aliases `window` to the Node
  // global and skips overriding `localStorage` (the key conflicts with Node's),
  // so jsdom's real Storage never surfaces. Install a small in-memory polyfill.
  if (typeof window.localStorage?.getItem !== 'function') {
    const store = new Map()
    const localStorageMock = {
      getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
      setItem: (k, v) => { store.set(String(k), String(v)) },
      removeItem: (k) => { store.delete(String(k)) },
      clear: () => { store.clear() },
      key: (i) => [...store.keys()][i] ?? null,
      get length() { return store.size },
    }
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
      writable: true,
    })
  }

  // Minimal window.matchMedia polyfill so components using media queries
  // via JS (SortMenu's useMedia, ListView) do not throw in jsdom.
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }

  // Basic cleanup and mock restore between tests.
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })
}
