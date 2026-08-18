// @vitest-environment node
//
// SEC-3.4 (#197) — production security headers. The function responses get
// them via the shared `json`/`securityHeaders` (unit-tested in security.test.js);
// this test verifies the SPA/static assets get them from netlify.toml (there
// are no browser e2e tests, so a source-level check is the honest regression
// guard — mirrors offline-isolation.test.js reading vite.config.js).

import { describe, expect, it } from 'vitest'

async function netlifyToml() {
  const { readFile } = await import('node:fs/promises')
  const path = (await import('node:path')).default
  const { fileURLToPath } = await import('node:url')
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  return readFile(path.join(root, 'netlify.toml'), 'utf8')
}

describe('SEC-3.4 (#197) — netlify.toml carries the production security headers', () => {
  it('the SPA header block sets every required security header', async () => {
    const src = await netlifyToml()
    const blockStart = src.indexOf('[[headers]]')
    const block = src.slice(blockStart)

    for (const header of [
      'X-Content-Type-Options',
      'X-Frame-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
      'Content-Security-Policy',
    ]) {
      expect(block).toContain(header)
    }
    // Frame-ancestors must be in the CSP and X-Frame-Options set (clickjacking).
    expect(block).toContain("frame-ancestors 'none'")
    expect(block).toContain('X-Frame-Options = "DENY"')
  })

  it('the CSP covers the app\'s needs without breaking it', async () => {
    const src = await netlifyToml()
    const cspLine = src.split('\n').find((l) => l.includes('Content-Security-Policy'))
    expect(cspLine).toContain("script-src 'self'")
    // The barcode scanner compiles WebAssembly (zxing-wasm); the CSP must allow
    // wasm compilation without allowing eval() — 'wasm-unsafe-eval'.
    expect(cspLine).toContain("script-src 'self' 'wasm-unsafe-eval'")
    expect(cspLine).toContain("style-src 'self' 'unsafe-inline'")
    // Cover/lookup hosts allowed for images.
    expect(cspLine).toContain('*.discogs.com')
    expect(cspLine).toContain('*.googleapis.com')
    // No inline script allowance — the shell has no inline scripts.
    expect(cspLine).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('fingerprinted /assets are served immutable with nosniff', async () => {
    const src = await netlifyToml()
    const assetsStart = src.indexOf('for = "/assets/*"')
    expect(assetsStart).toBeGreaterThan(-1)
    const assets = src.slice(assetsStart)
    expect(assets).toContain('Cache-Control')
    expect(assets).toContain('immutable')
    expect(assets).toContain('X-Content-Type-Options')
  })
})
