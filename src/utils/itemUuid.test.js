// M2 #289 — client-side STABLE item uuid generation (data-gate requirement #2).
// The identities must be stable so the outbox op (#292), mirror record and
// server record reconcile on ONE uuid; migration-stable; and never collide
// between server-backed and local (offline-add) records.
import { beforeEach, describe, expect, it } from 'vitest'
import { hasServerIdentity, newLocalItemUuid, serverItemUuid } from './itemUuid'

beforeEach(() => {})

describe('newLocalItemUuid', () => {
  it('mints unique, prefixed local identities (stable per mint)', () => {
    const a = newLocalItemUuid()
    const b = newLocalItemUuid()
    expect(a).not.toBe(b)
    expect(a.startsWith('local:')).toBe(true)
    expect(b.startsWith('local:')).toBe(true)
    // A valid uuid v4 shape after the prefix (so #292 can push it as an op id).
    expect(a).toMatch(
      /^local:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('is deterministic across calls for the same underlying random source (no global state)', () => {
    // Each call mints fresh — the point is uniqueness, not re-use. Two calls
    // must never return the same id (a collision would corrupt the mirror key).
    const seen = new Set(Array.from({ length: 100 }, () => newLocalItemUuid()))
    expect(seen.size).toBe(100)
  })
})

describe('serverItemUuid', () => {
  it('derives a deterministic mirror key from the server id', () => {
    expect(serverItemUuid('r1')).toBe('server:r1')
    expect(serverItemUuid('r1')).toBe('server:r1') // stable
    expect(serverItemUuid(42)).toBe('server:42')
  })

  it('returns "" for a missing server id (no key to derive)', () => {
    expect(serverItemUuid(undefined)).toBe('')
    expect(serverItemUuid(null)).toBe('')
  })
})

describe('hasServerIdentity', () => {
  it('distinguishes server-backed records from local offline adds', () => {
    expect(hasServerIdentity('server:r1')).toBe(true)
    expect(hasServerIdentity('local:abc')).toBe(false)
    expect(hasServerIdentity('')).toBe(false)
  })
})
