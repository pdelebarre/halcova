// M3 #160 — Idempotent Push/Pull Sync Engine (ADR-0019 Dec 7/8).
//
// WHAT THIS IS
// ------------
// The core client-side sync orchestrator. It:
//   1. Pushes pending outbox operations to the server sync endpoint with
//      stable idempotency keys (clientOpId).
//   2. Pulls incremental changes from the server using a cursor.
//   3. Applies pulled changes to the local database (localDatabase.js).
//   4. Retries failed operations with bounded exponential backoff.
//   5. Persists sync state (cursor, queue metrics) across reloads/restarts.
//   6. Provides observability (queue size, latency, failures, conflicts).
//
// RELATIONSHIP TO outboxSync.js
// -----------------------------
// outboxSync.js (M2 #292) provides the minimal push + reconcile for individual
// ops via the collection API. This engine supersedes it for M3 by:
//   - Batching operations into a single sync push request.
//   - Adding incremental pull with cursor.
//   - Adding retry with bounded exponential backoff.
//   - Persisting sync state across reloads.
//   - Adding observability metrics.
//
// SECURITY (ADR-0019 Dec 4/5/6/7/8 — mandatory)
//   - No credentials in sync payloads: only safe op IDs and item data.
//   - Server-authoritative ownership: scope is derived from the resolved
//     session user id, never client-chosen.
//   - Re-authorization at sync time: every sync request authenticates.
//   - No silent discard (ADR-0016 rule 12): failed ops are surfaced.
//   - Fail-closed on any error: never silently drops data.

import { getSessionToken, getUserId } from './session'
import { listPendingOps, markFlushed, markFailed } from './outbox'
import {
  saveItem,
  saveItems,
  deleteItem as localDeleteItem,
  clearTombstone,
  getItem,
  getTombstones,
  SYNC_STATUS,
} from '../repositories/localDatabase'
import { checkConflict, ConflictError, determineEntityType } from './conflictResolver'
import { saveConflict } from './conflictStore'

const SYNC_FN_BASE = '/.netlify/functions/sync'

// ---------------------------------------------------------------------------
// Backoff constants
// ---------------------------------------------------------------------------

// Bounded exponential backoff: base delay 1s, max delay 60s, jitter 0.5
export const BACKOFF_BASE_MS = 1000
export const BACKOFF_MAX_MS = 60000
export const BACKOFF_JITTER = 0.5
export const MAX_RETRY_ATTEMPTS = 5

// ---------------------------------------------------------------------------
// Sync state persistence keys (localStorage)
// ---------------------------------------------------------------------------

const SYNC_CURSOR_KEY = 'runout.sync.cursor'
const SYNC_METRICS_KEY = 'runout.sync.metrics'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Calculate the next backoff delay. Bounded exponential with jitter.
 * Returns milliseconds to wait before the next retry.
 */
export function nextBackoff(attempt) {
  if (attempt <= 0) return 0
  const capped = Math.min(attempt, MAX_RETRY_ATTEMPTS)
  const base = BACKOFF_BASE_MS * Math.pow(2, capped - 1)
  const clamped = Math.min(base, BACKOFF_MAX_MS)
  const jitter = clamped * BACKOFF_JITTER * Math.random()
  return Math.round(clamped + jitter)
}

/**
 * Read the persisted pull cursor for a user.
 */
export function readPersistedCursor(userId) {
  if (!userId) return null
  try {
    const raw = localStorage.getItem(`${SYNC_CURSOR_KEY}:${userId}`)
    return raw || null
  } catch {
    return null
  }
}

/**
 * Persist the pull cursor for a user.
 */
export function persistCursor(userId, cursor) {
  if (!userId || !cursor) return
  try {
    localStorage.setItem(`${SYNC_CURSOR_KEY}:${userId}`, cursor)
  } catch {
    /* best-effort */
  }
}

/**
 * Read persisted sync metrics.
 */
export function readPersistedMetrics(userId) {
  if (!userId) return null
  try {
    const raw = localStorage.getItem(`${SYNC_METRICS_KEY}:${userId}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/**
 * Persist sync metrics.
 */
export function persistMetrics(userId, metrics) {
  if (!userId) return
  try {
    localStorage.setItem(`${SYNC_METRICS_KEY}:${userId}`, JSON.stringify(metrics))
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// Push phase
// ---------------------------------------------------------------------------

/**
 * Push pending outbox operations to the server sync endpoint.
 *
 * Sends the base version (serverVersion) with each mutation for OCC.
 * Handles 'conflict' status from the server by persisting a conflict
 * record locally.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.token
 * @param {string} [opts.collection='records']
 * @param {number} [opts.now=Date.now()]
 * @returns {Promise<{attempted:number, pushed:number, failed:number, conflicted:number, failedOps:Array<{opId:string,message:string}>, latencyMs:number}>}
 */
export async function pushPendingOps({
  userId,
  token,
  collection = 'records',
  now = Date.now(),
} = {}) {
  const start = performance.now()
  const ops = await listPendingOps(userId, { now, token })
  const result = { attempted: 0, pushed: 0, failed: 0, conflicted: 0, failedOps: [], latencyMs: 0 }

  if (ops.length === 0) {
    result.latencyMs = Math.round(performance.now() - start)
    return result
  }

  // Build the batch payload, including base version for OCC
  const operations = await Promise.all(ops.map(async (op) => {
    let baseVersion = 0
    // Look up the local record to get the server version
    if (op.serverId || op.pendingItem?.uuid) {
      const uuid = op.pendingItem?.uuid || `server:${op.serverId}`
      const localRecord = await getItem(userId, uuid)
      if (localRecord) {
        baseVersion = localRecord.serverVersion || 0
      }
    }
    return {
      opId: op.opId,
      kind: op.kind,
      collection: op.collection || collection,
      item: op.pendingItem || undefined,
      itemId: op.serverId || undefined,
      patch: op.patch || undefined,
      baseVersion,
    }
  }))

  try {
    const res = await fetch(`${SYNC_FN_BASE}/push`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ operations, collection }),
    })

    if (!res.ok) {
      // Entire batch rejected
      for (const op of ops) {
        await markFailed(userId, op.opId, `Batch push rejected (${res.status})`, { now, token })
        result.failed += 1
        result.failedOps.push({ opId: op.opId, message: `Batch push rejected (${res.status})` })
      }
      result.attempted = ops.length
      result.latencyMs = Math.round(performance.now() - start)
      return result
    }

    const body = await res.json()
    const { results } = body

    for (const r of results || []) {
      result.attempted += 1
      if (r.status === 'accepted') {
        await markFlushed(userId, r.opId, r.item || {}, { now, token })
        // Update the local database sync status
        if (r.item?.id) {
          await saveItem(userId, r.item, {
            now,
            serverVersion: r.item.serverVersion || r.serverVersion || 1,
            syncStatus: SYNC_STATUS.SYNCED,
          })
        }
        result.pushed += 1
      } else if (r.status === 'conflict') {
        // Conflict detected — persist locally and mark op as failed
        result.conflicted = (result.conflicted || 0) + 1
        result.failed += 1
        result.failedOps.push({ opId: r.opId, message: r.error || 'Conflict' })

        await markFailed(userId, r.opId, r.error || 'Conflict detected', { now, token })

        // Build and persist a conflict record
        const op = ops.find((o) => o.opId === r.opId)
        if (op && r.serverItem) {
          const conflict = checkConflict({
            uuid: op.pendingItem?.uuid || `server:${op.serverId}`,
            localItem: op.pendingItem || {},
            serverItem: r.serverItem,
            serverVersion: r.serverVersion || 0,
            localVersion: r.localVersion || 0,
            baseVersion: r.expectedVersion || 0,
            scope: `user:${userId}`,
            entityType: determineEntityType(op.pendingItem || r.serverItem),
          })
          if (conflict) {
            await saveConflict(userId, conflict)
          }
        }
      } else {
        await markFailed(userId, r.opId, r.error || 'Rejected by server', { now, token })
        result.failed += 1
        result.failedOps.push({ opId: r.opId, message: r.error || 'Rejected by server' })
      }
    }

    // Persist the cursor from the push response
    if (body.cursor) {
      persistCursor(userId, body.cursor)
    }

    result.latencyMs = Math.round(performance.now() - start)
    return result
  } catch (err) {
    // Network error — all ops remain pending (retryable)
    const message = (err && err.message) || 'Network error during push'
    for (const op of ops) {
      await markFailed(userId, op.opId, message, { now, token })
      result.failed += 1
      result.failedOps.push({ opId: op.opId, message })
    }
    result.attempted = ops.length
    result.latencyMs = Math.round(performance.now() - start)
    return result
  }
}

// ---------------------------------------------------------------------------
// Pull phase
// ---------------------------------------------------------------------------

/**
 * Pull incremental changes from the server and apply them to the local database.
 *
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.token
 * @param {string} [opts.collection='records']
 * @param {string} [opts.cursor]  Override cursor (uses persisted cursor by default)
 * @param {number} [opts.limit=100]
 * @param {number} [opts.now=Date.now()]
 * @returns {Promise<{pulled:number, deleted:number, cursor:string|null, hasMore:boolean, latencyMs:number}>}
 */
export async function pullChanges({
  userId,
  token,
  collection = 'records',
  cursor,
  limit = 100,
  now = Date.now(),
} = {}) {
  const start = performance.now()
  const effectiveCursor = cursor || readPersistedCursor(userId)
  const result = { pulled: 0, deleted: 0, cursor: null, hasMore: false, latencyMs: 0 }

  try {
    const res = await fetch(`${SYNC_FN_BASE}/pull`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cursor: effectiveCursor || undefined,
        collection,
        limit,
      }),
    })

    if (!res.ok) {
      result.latencyMs = Math.round(performance.now() - start)
      return result
    }

    const body = await res.json()

    // Apply pulled items to the local database
    if (Array.isArray(body.items) && body.items.length > 0) {
      const saved = await saveItems(userId, body.items, { now, syncStatus: SYNC_STATUS.SYNCED })
      if (saved) result.pulled = body.items.length
    }

    // Apply deletions
    if (Array.isArray(body.deletedIds)) {
      for (const id of body.deletedIds) {
        const uuid = `server:${id}`
        await localDeleteItem(userId, uuid, { now })
        await clearTombstone(userId, uuid)
        result.deleted += 1
      }
    }

    // Persist the cursor
    if (body.cursor) {
      persistCursor(userId, body.cursor)
      result.cursor = body.cursor
    }

    result.hasMore = !!body.hasMore
    result.latencyMs = Math.round(performance.now() - start)
    return result
  } catch (err) {
    result.latencyMs = Math.round(performance.now() - start)
    return result
  }
}

// ---------------------------------------------------------------------------
// Full sync cycle
// ---------------------------------------------------------------------------

/**
 * Run a full sync cycle: push pending ops, then pull changes.
 * Retries failed pushes with bounded exponential backoff.
 *
 * @param {object} opts
 * @param {string} [opts.collection='records']
 * @param {number} [opts.maxRetries=MAX_RETRY_ATTEMPTS]
 * @param {number} [opts.now=Date.now()]
 * @returns {Promise<SyncResult>}
 */
export async function syncCycle({
  collection = 'records',
  maxRetries = MAX_RETRY_ATTEMPTS,
  now = Date.now(),
} = {}) {
  const userId = getUserId()
  const token = getSessionToken()
  if (!userId) return createEmptyResult('no_user')

  const start = performance.now()
  const result = {
    status: 'idle',
    pushResult: null,
    pullResult: null,
    totalLatencyMs: 0,
    metrics: null,
  }

  // --- Push phase with retry ---
  let pushResult = { attempted: 0, pushed: 0, failed: 0, conflicted: 0, failedOps: [], latencyMs: 0 }
  let retries = 0

  while (retries <= maxRetries) {
    pushResult = await pushPendingOps({ userId, token, collection, now })

    if (pushResult.failed === 0) break

    retries++
    if (retries <= maxRetries) {
      const delay = nextBackoff(retries)
      await sleep(delay)
    }
  }

  result.pushResult = pushResult

  // --- Pull phase ---
  const pullResult = await pullChanges({ userId, token, collection, now })
  result.pullResult = pullResult

  // --- Determine overall status ---
  const hasConflicts = pushResult.conflicted > 0
  if (hasConflicts) {
    result.status = 'conflict'
  } else if (pushResult.failed > 0) {
    result.status = 'partial'
  } else if (pushResult.pushed > 0 || pullResult.pulled > 0 || pullResult.deleted > 0) {
    result.status = 'synced'
  } else {
    result.status = 'idle'
  }

  result.totalLatencyMs = Math.round(performance.now() - start)

  // --- Update metrics ---
  const metrics = updateMetrics(userId, {
    pushAttempted: pushResult.attempted,
    pushPushed: pushResult.pushed,
    pushFailed: pushResult.failed,
    pushConflicted: pushResult.conflicted,
    pullPulled: pullResult.pulled,
    pullDeleted: pullResult.deleted,
    latencyMs: result.totalLatencyMs,
    status: result.status,
    now,
  })
  result.metrics = metrics

  return result
}

// ---------------------------------------------------------------------------
// Metrics / observability
// ---------------------------------------------------------------------------

/**
 * Default metrics shape.
 */
export function defaultMetrics() {
  return {
    totalPushed: 0,
    totalFailed: 0,
    totalPulled: 0,
    totalDeleted: 0,
    lastSyncAt: null,
    lastStatus: 'idle',
    lastLatencyMs: 0,
    queueSize: 0,
    conflictCount: 0,
    consecutiveFailures: 0,
  }
}

/**
 * Update and persist sync metrics.
 */
export function updateMetrics(userId, event) {
  const existing = readPersistedMetrics(userId) || defaultMetrics()
  const conflictCount = existing.conflictCount + (event.pushConflicted || 0)
  const updated = {
    ...existing,
    totalPushed: existing.totalPushed + (event.pushPushed || 0),
    totalFailed: existing.totalFailed + (event.pushFailed || 0),
    totalPulled: existing.totalPulled + (event.pullPulled || 0),
    totalDeleted: existing.totalDeleted + (event.pullDeleted || 0),
    conflictCount,
    lastSyncAt: new Date(event.now || Date.now()).toISOString(),
    lastStatus: event.status || existing.lastStatus,
    lastLatencyMs: event.latencyMs || 0,
    consecutiveFailures:
      event.pushFailed > 0 ? (existing.consecutiveFailures || 0) + 1 : 0,
  }
  persistMetrics(userId, updated)
  return updated
}

/**
 * Read current sync metrics for a user.
 */
export function getSyncMetrics(userId) {
  return readPersistedMetrics(userId) || defaultMetrics()
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function createEmptyResult(status) {
  return {
    status,
    pushResult: { attempted: 0, pushed: 0, failed: 0, conflicted: 0, failedOps: [], latencyMs: 0 },
    pullResult: { pulled: 0, deleted: 0, cursor: null, hasMore: false, latencyMs: 0 },
    totalLatencyMs: 0,
    metrics: null,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}