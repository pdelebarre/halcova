// M3 #161 — Conflict Resolution Hook (ADR-0019 Dec 8).
//
// WHAT THIS IS
// ------------
// A React hook that reads unresolved conflicts from the conflict store and
// exposes resolution actions. It provides:
//   - conflicts: the list of unresolved conflicts for the current user.
//   - resolveConflict: apply a resolution strategy (server/local/merge).
//   - refresh: re-read conflicts from the store.
//   - metrics: conflict frequency and resolution outcome counts.
//
// SECURITY (ADR-0019 Dec 4/5/6/8)
//   - No credentials in conflict payloads (conflictResolver sanitizes).
//   - Server-authoritative ownership: reads are scoped to the resolved
//     session user id.
//   - Fail-closed: any store failure yields an empty list / no-op.

import { useCallback, useEffect, useState } from 'react'
import { getUserId } from '../utils/session'
import {
  getConflicts,
  getConflictMetrics,
  markResolved,
} from '../utils/conflictStore'
import {
  applyResolution,
  buildResolutionPatch,
  RESOLUTION,
} from '../utils/conflictResolver'

/**
 * useConflicts — read and resolve conflicts for the current user.
 *
 * @param {object} opts
 * @param {number} [opts.refreshId=0] - Bump to force a re-read.
 * @returns {{
 *   conflicts: Array,
 *   metrics: object,
 *   loading: boolean,
 *   refresh: Function,
 *   resolveConflict: Function,
 * }}
 */
export function useConflicts({ refreshId = 0 } = {}) {
  const [conflicts, setConflicts] = useState([])
  const [metrics, setMetrics] = useState({
    totalConflicts: 0,
    unresolved: 0,
    resolvedServer: 0,
    resolvedLocal: 0,
    resolvedMerged: 0,
  })
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const userId = getUserId()
    if (!userId) {
      setConflicts([])
      setMetrics({
        totalConflicts: 0,
        unresolved: 0,
        resolvedServer: 0,
        resolvedLocal: 0,
        resolvedMerged: 0,
      })
      setLoading(false)
      return
    }

    const [unresolved, m] = await Promise.all([
      getConflicts(userId, { status: 'unresolved' }),
      getConflictMetrics(userId),
    ])
    setConflicts(unresolved)
    setMetrics(m)
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, refreshId])

  /**
   * Resolve a conflict with a given strategy.
   *
   * @param {string} conflictId - The conflict's stable id.
   * @param {string} resolution - One of RESOLUTION values.
   * @param {object} [mergedItem] - The merged item for MERGE resolution.
   * @returns {Promise<boolean>} True on success, false on failure.
   */
  const resolveConflict = useCallback(async (conflictId, resolution, mergedItem) => {
    const userId = getUserId()
    if (!userId) return false

    const conflict = conflicts.find((c) => c.conflictId === conflictId)
    if (!conflict) return false

    try {
      const resolved = applyResolution(conflict, resolution, mergedItem)
      const ok = await markResolved(userId, conflictId, resolved)
      if (ok) {
        await refresh()
      }
      return ok
    } catch {
      return false
    }
  }, [conflicts, refresh])

  return {
    conflicts,
    metrics,
    loading,
    refresh,
    resolveConflict,
    RESOLUTION,
    buildResolutionPatch,
  }
}