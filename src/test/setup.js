import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

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

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})
