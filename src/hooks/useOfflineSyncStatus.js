import { useEffect, useRef, useState } from 'react'
import { getSession } from '../utils/session'
import { readOutboxSummary } from '../utils/offlineOutbox'

// M2 Offline Sync Status hook (#159; ADR-0019 Dec 12, ADR-0016 UX rules).
//
// Combines the live network state (same navigator.onLine + window event
// convention as OnlineIndicator) with the collection's hydration source
// ('offline' = showing the IndexedDB mirror) and the outbox summary (#292
// interface) into a single, UI-friendly sync state the SyncStatus component
// can render.
//
// The hook NEVER writes anything and NEVER fabricates a pending/untracked
// mutation. The outbox summary fails closed (empty queue) until #292's durable
// store exists, so before #292 the UI correctly reports "no pending changes"
// instead of inventing one. A failed online action can never silently become an
// untracked local mutation here — that invariant is enforced by the collection
// layer (useCollection throws on a failed online write; it never hides it).
//
// `syncId` is an optional bump to re-read the outbox summary (e.g. after a
// manual "Sync now" or after a mutation completes). Consumers pass 0/false when
// they don't need it.
//
// Returns:
//   online        — true when the device reports a network.
//   source        — the collection's hydration source: 'offline' | 'live' | null.
//   mirroredAt    — the mirror cachedAt stamp when source === 'offline'.
//   summary       — { pending, conflict, error, synced } from the outbox (0s before #292).
//   hasAttention  — true when there are pending, conflict or error operations.
export function useOfflineSyncStatus({ source = null, mirroredAt = null, syncId = 0 } = {}) {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [summary, setSummary] = useState({ pending: 0, conflict: 0, error: 0, synced: 0 })
  // Track the last known session user so we only read the outbox for the
  // server-resolved session user (never a client-chosen scope).
  const lastUserId = useRef('')

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const user = getSession()?.user
    const userId = user?.id || ''
    lastUserId.current = userId
    if (!userId) {
      setSummary({ pending: 0, conflict: 0, error: 0, synced: 0 })
      return
    }
    readOutboxSummary(userId).then((s) => {
      if (!cancelled) setSummary(s)
    })
    return () => { cancelled = true }
  }, [online, syncId])

  const hasAttention = summary.pending > 0 || summary.conflict > 0 || summary.error > 0

  return {
    online,
    source,
    mirroredAt,
    summary,
    hasAttention,
    userId: lastUserId.current,
  }
}
