import { useCallback, useEffect, useRef, useState } from 'react'
import { getSessionToken, getUserId } from '../utils/session'
import { countPendingOps } from '../utils/outbox'
import { flushPendingOps } from '../utils/outboxSync'

// M2 #292 — Reconnect sync trigger (foreground-only, iOS-safe).
//
// There is NO assumption of Background Sync / SyncManager (iOS limits). Instead
// the outbox is flushed on foreground `online` and `visibilitychange` events,
// plus an explicit manual `flush()`. This is the accepted M2 reconciliation
// model (ADR-0019 Dec 7). Full background/periodic sync is M3 (#160/#161).
//
// `onSynced` is called after a flush that pushed at least one op, so the
// collection view can refresh against the reconciled mirror. The hook exposes a
// minimal `syncState` ('idle' | 'syncing' | 'error') and `pendingCount` so a
// caller can surface "N pending" — full UX polish is #159.
export function useOutboxSync({ collection = 'records', onSynced } = {}) {
  const [syncState, setSyncState] = useState('idle')
  const [pendingCount, setPendingCount] = useState(0)
  const [lastResult, setLastResult] = useState(null)
  // Keep the latest onSynced without re-binding the event listeners.
  const onSyncedRef = useRef(onSynced)
  onSyncedRef.current = onSynced

  const refreshPendingCount = useCallback(async () => {
    const userId = getUserId()
    if (!userId) {
      setPendingCount(0)
      return
    }
    const n = await countPendingOps(userId, { token: getSessionToken() })
    setPendingCount(n)
  }, [])

  const flush = useCallback(async () => {
    const userId = getUserId()
    const token = getSessionToken()
    if (!userId) return { attempted: 0, pushed: 0, failed: 0, failedOps: [] }
    setSyncState('syncing')
    try {
      const result = await flushPendingOps({ userId, token, collection })
      setSyncState(result.failed > 0 ? 'error' : 'idle')
      setLastResult(result)
      await refreshPendingCount()
      if (result.pushed > 0 && onSyncedRef.current) onSyncedRef.current(result)
      return result
    } catch (err) {
      setSyncState('error')
      throw err
    }
  }, [collection, refreshPendingCount])

  // Foreground reconnect: flush when the device comes online, and when the tab
  // becomes visible again (covers the iOS app-foreground case without any
  // Background Sync assumption). Bound once; state is read via refs.
  useEffect(() => {
    refreshPendingCount()
    const onOnline = () => { flush() }
    const onVisible = () => {
      if (document.visibilityState === 'visible') flush()
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [flush, refreshPendingCount])

  return { syncState, pendingCount, lastResult, flush, refreshPendingCount }
}
