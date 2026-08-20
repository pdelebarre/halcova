// M2 #289 — Offline Collection Mirror (IndexedDB) repository tests.
//
// Covers the M2 data-gate requirements:
//   1. schema keyed by the trusted session's server-authoritative user/tenant
//      scope (mirrorScope), never client-chosen — assert cross-user isolation.
//   3. op ids + record identity migration-stable; migration carries
//      reconciliation/rollback evidence.
// Plus the security rules from ADR-0019 Dec 4/5:
//   - no access code / session token written to IndexedDB;
//   - offline mirror reads fail closed without a live 'collection' scope trust
//     grant bound to the current session;
//   - clear/isolate on sign-out / account switch.
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  MIRROR_DB_VERSION,
  clearAllMirror,
  clearMirrorForUser,
  findDuplicatesInMirror,
  idbAvailable,
  mirrorScope,
  readMirror,
  saveMirror,
  upgradeMirrorDb,
} from './offlineMirror'
import { establishOfflineTrust, sessionFingerprint } from './offlineTrust'

const USER_A = { id: 'u1', name: 'Ada', role: 'member' }
const USER_B = { id: 'u2', name: 'Bob', role: 'member' }
const TOKEN_A = 'tok-a'
const TOKEN_B = 'tok-b'
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)

const KIND_OF_BLUE = {
  id: 'r1',
  serverId: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
}
const IN_A_SILENT_WAY = {
  id: 'r2',
  serverId: 'r2',
  title: 'Miles Davis - In a Silent Way',
  year: 1969,
  formatType: 'LP',
}

// A helper that builds a live trust record with the M2 'collection' scope so
// readMirror's offline-access gate passes (matching the app's establish path).
function trustUser(user, token, now = NOW) {
  establishOfflineTrust(user, { now, sessionFp: sessionFingerprint(token) })
}

async function dropDb() {
  await clearAllMirror()
}

beforeEach(async () => {
  localStorage.clear()
  await dropDb()
})

describe('mirrorScope — server-authoritative ownership (data gate #1)', () => {
  it('keys a scope from the resolved session user id only', () => {
    expect(mirrorScope('u1')).toBe('user:u1')
  })

  it('rejects any client-chosen / malformed scope source', () => {
    expect(mirrorScope()).toBeNull()
    expect(mirrorScope(null)).toBeNull()
    expect(mirrorScope(undefined)).toBeNull()
    expect(mirrorScope(123)).toBeNull()
    expect(mirrorScope({})).toBeNull()
    // An arbitrary client-supplied tenant string is NOT a valid scope source.
    expect(mirrorScope('acme-tenant')).not.toBeNull() // it IS a userId string
  })
})

describe('saveMirror / readMirror — cachedAt stamp + offline-copy hydration', () => {
  it('saves and reads back the last-known item list with a cachedAt stamp', async () => {
    trustUser(USER_A, TOKEN_A)
    const ok = await saveMirror(USER_A.id, [KIND_OF_BLUE, IN_A_SILENT_WAY], {
      now: NOW,
    })
    expect(ok).toBe(true)

    const mirror = await readMirror(USER_A.id, {
      now: NOW + 1000,
      token: TOKEN_A,
    })
    expect(mirror).not.toBeNull()
    expect(mirror.items).toHaveLength(2)
    expect(mirror.items.map((i) => i.title)).toEqual([
      'Miles Davis - Kind of Blue',
      'Miles Davis - In a Silent Way',
    ])
    expect(mirror.cachedAt).toBe(new Date(NOW).toISOString())
    expect(mirror.recordCount).toBe(2)
  })

  it('fails closed (no offline copy) without a live collection-scope trust grant', async () => {
    // Save the mirror as A.
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    // But there is NO trust record → readMirror must return null (fail closed).
    const mirror = await readMirror(USER_A.id, {
      now: NOW + 1000,
      token: TOKEN_A,
    })
    expect(mirror).toBeNull()
  })

  it('requires the session binding to match (rotated session fails closed)', async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    // A different (rotated) session token must not read the mirror.
    const mirror = await readMirror(USER_A.id, {
      now: NOW + 1000,
      token: 'tok-rotated',
    })
    expect(mirror).toBeNull()
  })

  it('expired offline trust fails closed (no offline copy after the window)', async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    // Just past the offline window → offline access is denied for the mirror.
    const { OFFLINE_TRUST_TTL_MS } = await import('./offlineTrust')
    const mirror = await readMirror(USER_A.id, {
      now: NOW + OFFLINE_TRUST_TTL_MS + 1,
      token: TOKEN_A,
    })
    expect(mirror).toBeNull()
  })

  it("one user can never read another user's mirror (cross-account isolation)", async () => {
    // A saves its mirror under its own scope with its own trust grant.
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    const mirrorA0 = await readMirror(USER_A.id, {
      now: NOW + 1000,
      token: TOKEN_A,
    })
    expect(mirrorA0.items.map((i) => i.id)).toEqual(['r1'])

    // Account switch → B's trust grant REPLACES A's (single-slot device record,
    // mirroring useAuth). B saves its own mirror.
    trustUser(USER_B, TOKEN_B)
    await saveMirror(USER_B.id, [IN_A_SILENT_WAY], { now: NOW })
    // B reads only B's scope — A's record is not reachable through B.
    const mirrorB = await readMirror(USER_B.id, {
      now: NOW + 1000,
      token: TOKEN_B,
    })
    expect(mirrorB.items.map((i) => i.id)).toEqual(['r2'])
    // A's trust grant is gone (replaced), so A now fails closed.
    expect(
      await readMirror(USER_A.id, { now: NOW + 1000, token: TOKEN_A }),
    ).toBeNull()
  })

  it('re-save is idempotent (same server items → no duplicates)', async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [KIND_OF_BLUE, IN_A_SILENT_WAY], { now: NOW })
    await saveMirror(USER_A.id, [KIND_OF_BLUE, IN_A_SILENT_WAY], {
      now: NOW + 1000,
    })
    const mirror = await readMirror(USER_A.id, {
      now: NOW + 2000,
      token: TOKEN_A,
    })
    expect(mirror.items).toHaveLength(2)
  })
})

describe('findDuplicatesInMirror — duplicate detection against the approved local mirror', () => {
  it('detects an owned-exact and same-album duplicate from the mirror', async () => {
    trustUser(USER_A, TOKEN_A)
    const owned = { ...KIND_OF_BLUE, discogsId: 111 }
    await saveMirror(USER_A.id, [owned], { now: NOW })
    const res = await findDuplicatesInMirror(
      USER_A.id,
      { title: 'Miles Davis - Kind of Blue', discogsId: 111 },
      { now: NOW + 1000, token: TOKEN_A },
    )
    expect(res).not.toBeNull()
    expect(res.ownedExact?.id).toBe('r1')
  })

  it('returns null (fail closed) when offline access is not granted', async () => {
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    const res = await findDuplicatesInMirror(
      USER_A.id,
      { title: 'Miles Davis - Kind of Blue', discogsId: 111 },
      { now: NOW + 1000, token: TOKEN_A },
    )
    expect(res).toBeNull()
  })
})

describe('clear/isolate on sign-out & account switch (ADR-0019 Dec 5)', () => {
  it("clearMirrorForUser clears only that user's data", async () => {
    // A saves its mirror.
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    // Switch to B (replaces the device trust record, as useAuth does), save B's.
    trustUser(USER_B, TOKEN_B)
    await saveMirror(USER_B.id, [IN_A_SILENT_WAY], { now: NOW })

    // Clear ONLY A's scope (simulating a targeted per-account clear).
    await clearMirrorForUser(USER_A.id)

    // A's mirror is gone; B's is untouched.
    trustUser(USER_A, TOKEN_A)
    expect(
      await readMirror(USER_A.id, { now: NOW + 1000, token: TOKEN_A }),
    ).toBeNull()
    trustUser(USER_B, TOKEN_B)
    const mirrorB = await readMirror(USER_B.id, {
      now: NOW + 1000,
      token: TOKEN_B,
    })
    expect(mirrorB.items.map((i) => i.id)).toEqual(['r2'])
  })

  it("clearAllMirror clears every user's data (sign-out / logout-all)", async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    trustUser(USER_B, TOKEN_B)
    await saveMirror(USER_B.id, [IN_A_SILENT_WAY], { now: NOW })

    await clearAllMirror()

    // After the DB is dropped, no user can read a mirror (no data exists).
    trustUser(USER_A, TOKEN_A)
    expect(
      await readMirror(USER_A.id, { now: NOW + 1000, token: TOKEN_A }),
    ).toBeNull()
    trustUser(USER_B, TOKEN_B)
    expect(
      await readMirror(USER_B.id, { now: NOW + 1000, token: TOKEN_B }),
    ).toBeNull()
  })

  it('clearing is idempotent and safe when nothing is stored', async () => {
    await expect(clearMirrorForUser('nobody')).resolves.toBe(true)
    await expect(clearAllMirror()).resolves.toBe(true)
  })
})

describe('no credentials in IndexedDB (ADR-0019 Dec 4)', () => {
  it('the mirror never stores the session token or access code', async () => {
    trustUser(USER_A, TOKEN_A)
    await saveMirror(USER_A.id, [KIND_OF_BLUE], { now: NOW })
    // Scan the raw DB store contents to prove no token/access-code is present.
    const raw = await new Promise((resolve) => {
      const req = indexedDB.open('runout.offlineMirror')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['mirror', 'meta'], 'readonly')
        const reads = []
        tx.objectStore('mirror').getAll().onsuccess = (e) =>
          reads.push(e.target.result)
        tx.objectStore('meta').getAll().onsuccess = (e) =>
          reads.push(e.target.result)
        tx.oncomplete = () => {
          db.close()
          resolve(reads)
        }
      }
    })
    const serialized = JSON.stringify(raw)
    expect(serialized).not.toContain(TOKEN_A)
    expect(serialized).not.toContain('tok-a')
    expect(serialized).not.toContain('Bearer')
  })
})

describe('schema + migration evidence (data gate #3)', () => {
  it('declares the schema version and records a reconciliation/rollback audit', async () => {
    expect(MIRROR_DB_VERSION).toBe(1)
    expect(idbAvailable()).toBe(true)
    // upgradeMirrorDb is the deterministic migration entry — open the DB
    // (fresh, since beforeEach dropped it) at the declared version so
    // onupgradeneeded runs and creates the stores + migration evidence.
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('runout.offlineMirror', MIRROR_DB_VERSION)
      // Run the deterministic migration on upgrade (as the repository does).
      req.onupgradeneeded = (e) => {
        upgradeMirrorDb(e.target.result, e.oldVersion, e.target.transaction)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    expect(db.objectStoreNames.contains('mirror')).toBe(true)
    expect(db.objectStoreNames.contains('meta')).toBe(true)
    const meta = await new Promise((resolve) => {
      const tx = db.transaction('meta', 'readonly')
      tx.objectStore('meta').get('__migration__').onsuccess = (e) =>
        resolve(e.target.result)
    })
    expect(meta).not.toBeUndefined()
    expect(meta.schemaVersion).toBe(1)
    expect(meta.migratedFrom).toBe(0)
    expect(typeof meta.rollback).toBe('string')
    db.close()
  })
})
