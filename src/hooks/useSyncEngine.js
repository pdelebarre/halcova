// M3 #160 — Sync Engine React Hook (ADR-0019 Dec 7/8).
//
// WHAT THIS IS
// ------------
// A React hook that initializes the sync engine and triggers synchronization
// on startup, foreground (visibilitychange), and `online` events. It exposes
// sync state, metrics, and a manual `sync()` trigger.
//
// RELATIONSHIP TO useOutboxSync.js
// --------------------------------
// useOutboxSync.js (M2 #292) provides the minimal reconnect sync trigger for
// the outbox push. This hook supersedes it for M3 by:
//   - Using the full sync engine (push + pull + retry).
//   - Persisting sync state across reloads.
//   - Exposing observability metrics.
//   - Triggering on startup in addition to foreground/online.
//
// SECURITY (ADR-0019 Dec 4/5/6/7/8)
//   - No credentials in sync payloads.
//   - Server-authoritative ownership.
//   - Re-authorization at sync time.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getSessionToken, getUserId } from '../utils/session'
import { syncCycle, getSyncMetrics, defaultMetrics } from '../utils/syncEngine'
import { countPendingOps } from '../utils/outbox'

/**
 * useSyncEngine — full bidirectional sync hook.
 *
 * @param {object} opts
 * @param {string} [opts.collection='records']
 * @param {number} [opts.startupDelayMs=1000]  Delay before initial sync on mount
 * @returns {{
 *   syncState: string,        // 'idle' | 'syncing' | 'synced' | 'partial' | 'error'
 *   pendingCount: number,
 *   metrics: object,
 *   lastResult: object|null,
 *   sync: Function,           // Manual trigger
 * }}
 */
export function useSyncEngine({
  collection = 'records',
  startupDelayMs = 1000,
} = {}) {
  const [syncState, setSyncState] = useState('idle')
  const [pendingCount, setPendingCount] = useState(0)
  const [metrics, setMetrics] = useState(defaultMetrics())
  const [lastResult, setLastResult] = useState(null)
  const syncingRef = useRef(false)
  const mountedRef = useRef(true)

  // Refresh pending count
  const refreshPendingCount = useCallback(async () => {
    const userId = getUserId()
    if (!userId) {
      setPendingCount(0)
      return
    }
    const n = await countPendingOps(userId, { token: getSessionToken() })
    if (mountedRef.current) setPendingCount(n)
  }, [])

  // Refresh metrics
  const refreshMetrics = useCallback(() => {
    const userId = getUserId()
    if (!userId) {
      setMetrics(defaultMetrics())
      return
    }
    const m = getSyncMetrics(userId)
    if (mountedRef.current) setMetrics(m)
  }, [])

  // Run a sync cycle
  const sync = useCallback(async () => {
    const userId = getUserId()
    const token = getSessionToken()
    if (!userId || syncingRef.current) return null

    syncingRef.current = true
    setSyncState('syncing')

    try {
      const result = await syncCycle({ collection })
      if (mountedRef.current) {
        setSyncState(result.status === 'synced' ? 'synced' : result.status === 'partial' ? 'partial' : 'idle')
        setLastResult(result)
        await refreshPendingCount()
        refreshMetrics()
      }
      return result
    } catch (err) {
      if (mountedRef.current) {
        setSyncState('error')
      }
      return null
    } finally {
      syncingRef.current = false
    }
  }, [collection, refreshPendingCount, refreshMetrics])

  // Initial sync on mount (with delay)
  useEffect(() => {
    mountedRef.current = true
    refreshPendingCount()
    refreshMetrics()

    const timer = setTimeout(() => {
      sync()
    }, startupDelayMs)

    return () => {
      mountedRef.current = false
      clearTimeout(timer)
    }
  }, [sync, refreshPendingCount, refreshMetrics, startupDelayMs])

  // Trigger sync on online event
  useEffect(() => {
    const onOnline = () => {
      sync()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [sync])

  // Trigger sync on foreground (visibilitychange)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        sync()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [sync])

  return {
    syncState,
    pendingCount,
    metrics,
    lastResult,
    sync,
    refreshPendingCount,
    refreshMetrics,
  }
}