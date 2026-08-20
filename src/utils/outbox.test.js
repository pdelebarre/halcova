// M2 #292 — Offline Capture Outbox (IndexedDB) repository tests.
//
// Covers the outbox contract:
//   - durable staging with a STABLE idempotency key (== the item's local uuid),
//     scoped by the server-authoritative user id (never client-chosen);
//   - fail-closed trust gating on the M2 'mutation' scope bound to the current
//     session (a device without a live grant cannot queue offline mutations);
//   - no session token / access code ever written to IndexedDB (ADR-0019 Dec 4);
//   - clear/isolate on sign-out & account switch (ADR-0019 Dec 5);
//   - flushed/failed transitions preserve the op id (op → mirror → server
//     reconciliation) and failed ops stay durable + retryable (ADR-0016 rule 12).
import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import {
  OUTBOX_DB_VERSION,
  clearAllOutbox,
  clearOutboxForUser,
  countPendingOps,
  listPendingOps,
  markFailed,
  markFlushed,
  outboxScope,
  stageAdd,
  upgradeOutboxDb,
} from './outbox'
import { clearAllMirror } from './offlineMirror'
import { establishOfflineTrust, sessionFingerprint } from './offlineTrust'

const USER_A = { id: 'u1', name: 'Ada', role: 'member' }
const USER_B = { id: 'u2', name: 'Bob', role: 'member' }
const TOKEN_A = 'tok-a'
const TOKEN_B = 'tok-b'
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)

const ITEM = {
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  barcode: '889853958719',
}

function trustUser(user, token, now = NOW) {
  establishOfflineTrust(user, { now, sessionFp: sessionFingerprint(token) })
}

async function dropAll() {
  await clearAllOutbox()
  await clearAllMirror()
}

beforeEach(async () => {
  localStorage.clear()
  await dropAll()
})

describe('outboxScope — server-authoritative ownership', () => {
  it('derives the scope from the resolved session user id only', () => {
    expect(outboxScope('u1')).toBe('user:u1')
  })

  it('rejects any client-chosen / malformed scope source', () => {
    expect(outboxScope()).toBeNull()
    expect(outboxScope(null)).toBeNull()
    expect(outboxScope(undefined)).toBeNull()
    expect(outboxScope(123)).toBeNull()
  })
})

describe('stageAdd — durable offline add with a stable idempotency key', () => {
  it('stages a pending add under the item uuid and lists it back', async () => {
    trustUser(USER_A, TOKEN_A)
    const op = await stageAdd(USER_A.id, {
      collection: 'records',
      item: ITEM,
      barcode: '889853958719',
      ocrText: 'MILES DAVIS',
      now: NOW,
      token: TOKEN_A,
    })
    expect(op).not.toBeNull()
    expect(op.opId).toMatch(/^local:/) // stable local uuid
    expect(op.scope).toBe('user:u1')
    expect(op.kind).toBe('add')
    expect(op.state).toBe('pending')
    expect(op.barcode).toBe('889853958719')
    expect(op.ocrText).toBe('MILES DAVIS')
    expect(op.capturedAt).toBe(new Date(NOW).toISOString())
    // The staged item is keyed to the SAME uuid (op → mirror → server reconcile).
    expect(op.pendingItem.uuid).toBe(op.opId)

    const pending = await listPendingOps(USER_A.id, { now: NOW + 1000, token: TOKEN_A })
    expect(pending).toHaveLength(1)
    expect(pending[0].opId).toBe(op.opId)
    expect(await countPendingOps(USER_A.id, { now: NOW + 1000, token: TOKEN_A })).toBe(1)
  })

  it('fails closed (no staging) without a live mutation-scope trust grant', async () => {
    // No trust record at all.
    const op = await stageAdd(USER_A.id, {
      item: ITEM,
      now: NOW,
      token: TOKEN_A,
    })
    expect(op).toBeNull()
    expect(await listPendingOps(USER_A.id, { now: NOW + 1000, token: TOKEN_A })).toEqual([])
  })

  it('fails closed on a rotated session (token binding mismatch)', async () => {
    trustUser(USER_A, TOKEN_A)
    const op = await stageAdd(USER_A.id, {
      item: ITEM,
      now: NOW,
      token: 'tok-rotated',
    })
    expect(op).toBeNull()
  })

  it('fails closed after the offline window expires', async () => {
    trustUser(USER_A, TOKEN_A, NOW)
    const { OFFLINE_TRUST_TTL_MS } = await import('./offlineTrust')
    const op = await stageAdd(USER_A.id, {
      item: ITEM,
      now: NOW + OFFLINE_TRUST_TTL_MS + 1,
      token: TOKEN_A,
    })
    expect(op).toBeNull()
  })
})

describe('markFlushed / markFailed — durable transitions that keep the op id', () => {
  it('marks an op flushed and records the server item for reconciliation', async () => {
    trustUser(USER_A, TOKEN_A)
    const op = await stageAdd(USER_A.id, { item: ITEM, now: NOW, token: TOKEN_A })
    const serverItem = { id: 'srv-1', serverId: 'srv-1', title: ITEM.title, year: ITEM.year }
    const updated = await markFlushed(USER_A.id, op.opId, serverItem, {
      now: NOW + 1000,
      token: TOKEN_A,
    })
    expect(updated.state).toBe('flushed')
    expect(updated.serverId).toBe('srv-1')
    expect(updated.opId).toBe(op.opId) // op identity is stable across transitions
    // A flushed op is no longer pending.
    expect(await countPendingOps(USER_A.id, { now: NOW + 2000, token: TOKEN_A })).toBe(0)
  })

  it('marks an op failed but keeps it durable + retryable (ADR-0016 rule 12)', async () => {
    trustUser(USER_A, TOKEN_A)
    const op = await stageAdd(USER_A.id, { item: ITEM, now: NOW, token: TOKEN_A })
    const failed = await markFailed(USER_A.id, op.opId, 'flaky reconnect', {
      now: NOW + 1000,
      token: TOKEN_A,
    })
    expect(failed.state).toBe('failed')
    expect(failed.lastError).toBe('flaky reconnect')
    expect(failed.attempts).toBe(1)
    // A failed op is STILL pending (retryable), never silently discarded.
    const pending = await listPendingOps(USER_A.id, { now: NOW + 2000, token: TOKEN_A })
    expect(pending).toHaveLength(1)
    expect(pending[0].opId).toBe(op.opId)
  })

  it('never touches another user op', async () => {
    trustUser(USER_A, TOKEN_A)
    const op = await stageAdd(USER_A.id, { item: ITEM, now: NOW, token: TOKEN_A })
    // B cannot flush or fail A's op (B has no matching scope).
    expect(await markFlushed(USER_A.id, op.opId, { id: 'x' }, { now: NOW + 1000, token: TOKEN_B })).toBeNull()
    expect(await markFailed(USER_A.id, op.opId, 'nope', { now: NOW + 1000, token: TOKEN_B })).toBeNull()
  })
})

describe('clear/isolate on sign-out & account switch (ADR-0019 Dec 5)', () => {
  it("clearOutboxForUser clears only that user's queued ops", async () => {
    trustUser(USER_A, TOKEN_A)
    await stageAdd(USER_A.id, { item: ITEM, now: NOW, token: TOKEN_A })
    trustUser(USER_B, TOKEN_B)
    await stageAdd(USER_B.id, { item: { title: 'B item' }, now: NOW, token: TOKEN_B })

    await clearOutboxForUser(USER_A.id)

    // A is empty; B is untouched.
    trustUser(USER_A, TOKEN_A)
    expect(await countPendingOps(USER_A.id, { now: NOW + 1000, token: TOKEN_A })).toBe(0)
    trustUser(USER_B, TOKEN_B)
    expect(await countPendingOps(USER_B.id, { now: NOW + 1000, token: TOKEN_B })).toBe(1)
  })

  it('clearAllOutbox clears every user (sign-out / logout-all)', async () => {
    trustUser(USER_A, TOKEN_A)
    await stageAdd(USER_A.id, { item: ITEM, now: NOW, token: TOKEN_A })
    trustUser(USER_B, TOKEN_B)
    await stageAdd(USER_B.id, { item: { title: 'B item' }, now: NOW, token: TOKEN_B })

    await clearAllOutbox()

    trustUser(USER_A, TOKEN_A)
    expect(await countPendingOps(USER_A.id, { now: NOW + 1000, token: TOKEN_A })).toBe(0)
    trustUser(USER_B, TOKEN_B)
    expect(await countPendingOps(USER_B.id, { now: NOW + 1000, token: TOKEN_B })).toBe(0)
  })

  it('clearing is idempotent and safe when nothing is stored', async () => {
    await expect(clearOutboxForUser('nobody')).resolves.toBe(true)
    await expect(clearAllOutbox()).resolves.toBe(true)
  })

  // SECURITY (ADR-0019 Dec 5/12) fail-closed privacy reset: if the IndexedDB
  // delete transaction fails (abort/quota/cursor error) while READS still
  // succeed, clearOutboxForUser must report FALSE (not true) so the UI can never
  // say "cleared" while the raw queued op (pendingItem/barcode/ocrText) survives
  // to auto-flush on reconnect. This was a `catch { return true }` fail-open.
  it('clearOutboxForUser FAILS CLOSED (false) when the delete transaction fails, leaving the op durable', async () => {
    trustUser(USER_A, TOKEN_A)
    await stageAdd(USER_A.id, { item: ITEM, now: NOW, token: TOKEN_A })

    // Force every delete in the clear transaction to throw inside the cursor's
    // onsuccess handler. fake-indexeddb aborts the transaction on that throw,
    // so tx.onabort fires and the clear must resolve false — while reads
    // (listPendingOps/countPendingOps) keep succeeding.
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('runout.outbox', OUTBOX_DB_VERSION)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const storeProto = Object.getPrototypeOf(
      db.transaction('ops').objectStore('ops'),
    )
    const origDelete = storeProto.delete
    storeProto.delete = () => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    }
    try {
      expect(await clearOutboxForUser(USER_A.id)).toBe(false)
    } finally {
      storeProto.delete = origDelete
      db.close()
    }

    // Fail-closed: the raw op is NOT silently cleared — it stays durable and
    // retryable (ADR-0016 rule 12), so nothing is reported as wiped.
    trustUser(USER_A, TOKEN_A)
    expect(await countPendingOps(USER_A.id, { now: NOW + 1000, token: TOKEN_A })).toBe(1)
  })
})

describe('no credentials in the outbox (ADR-0019 Dec 4)', () => {
  it('the outbox never stores the session token or access code', async () => {
    trustUser(USER_A, TOKEN_A)
    await stageAdd(USER_A.id, { item: ITEM, barcode: '889853958719', now: NOW, token: TOKEN_A })

    const raw = await new Promise((resolve) => {
      const req = indexedDB.open('runout.outbox')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction(['ops', 'meta'], 'readonly')
        const reads = []
        tx.objectStore('ops').getAll().onsuccess = (e) => reads.push(e.target.result)
        tx.objectStore('meta').getAll().onsuccess = (e) => reads.push(e.target.result)
        tx.oncomplete = () => { db.close(); resolve(reads) }
      }
    })
    const serialized = JSON.stringify(raw)
    expect(serialized).not.toContain(TOKEN_A)
    expect(serialized).not.toContain('tok-a')
    expect(serialized).not.toContain('Bearer')
    expect(serialized).not.toContain('RU-')
  })
})

describe('schema + migration evidence', () => {
  it('declares the schema version and records a reconciliation/rollback audit', async () => {
    expect(OUTBOX_DB_VERSION).toBe(1)
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('runout.outbox', OUTBOX_DB_VERSION)
      req.onupgradeneeded = (e) => upgradeOutboxDb(e.target.result, e.oldVersion, e.target.transaction)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    expect(db.objectStoreNames.contains('ops')).toBe(true)
    const meta = await new Promise((resolve) => {
      const tx = db.transaction('meta', 'readonly')
      tx.objectStore('meta').get('__migration__').onsuccess = (e) => resolve(e.target.result)
    })
    expect(meta.schemaVersion).toBe(1)
    expect(meta.migratedFrom).toBe(0)
    expect(typeof meta.rollback).toBe('string')
    db.close()
  })
})
