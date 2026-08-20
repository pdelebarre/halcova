import { useCallback, useEffect, useState } from 'react'
import * as api from '../api/collection'
import * as apiLending from '../api/lending'
import { getSession, getSessionToken } from '../utils/session'
import { readMirror, saveMirror } from '../utils/offlineMirror'
import { OFFLINE_SCOPES } from '../utils/offlineTrust'

// M2 Offline Collection Mirror hydration (#289; ADR-0019 Dec 5).
//
// `useCollection` now hydrates from the local IndexedDB mirror when:
//   - the device is OFFLINE, or
//   - a "safe" network request fails (a non-auth failure — e.g. a 5xx, a
//     network error, or the backend being unreachable).
//
// It NEVER hydrates from the mirror on a confirmed authorization failure
// (401/403): a revoked/disabled session must fail closed, not fall back to
// cached private data (ADR-0019 Dec 4 — cached trusted state is never evidence
// an account is still authorized).
//
// The mirror read itself is capability-scoped and session-bound (see
// offlineMirror.readMirror): it only returns data when the M1 trusted-session
// record grants the 'collection' scope for the resolved session user AND the
// session token still matches the record that the mirror was bound to.
//
// When data comes from the mirror, `source` is 'offline' so the UI can surface
// a clear "showing offline copy" state. When it comes live from the network,
// `source` is 'live' and the fresh list is written back to the mirror (with a
// `cachedAt` stamp) so the next offline launch has the latest known state.
//
// Scope is SERVER-AUTHORITATIVE: the mirror is keyed under the resolved session
// user id (`getSession().user.id`) — never a client-chosen tenant/owner.

// Whether the request failed in a way that is SAFE to fall back to the offline
// mirror. Authorization failures (401/403) are NEVER safe (fail closed); a
// missing network, a 5xx, or a generic fetch/network error is safe to hydrate
// from the mirror. We cannot branch on `err.code` here reliably (the collection
// API throws Error with optional `.code`), so we classify by status when
// available and treat any non-auth error as safe-to-mirror.
function isSafeToMirror(err) {
  if (!err) return false
  if (err.status === 401 || err.status === 403) return false
  if (typeof err.code === 'string') {
    const code = err.code.toUpperCase()
    if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'AUTH') return false
  }
  return true
}

export function useCollection(collection = 'records') {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)
  // 'live' | 'offline' | null — 'offline' means the current items came from the
  // IndexedDB mirror (showing the last-known offline copy), not the network.
  const [source, setSource] = useState(null)
  // The mirror `cachedAt` stamp when `source === 'offline'` (for the UI note).
  const [mirroredAt, setMirroredAt] = useState(null)

  const refresh = useCallback(async () => {
    setStatus('loading')
    setError(null)
    const user = getSession()?.user
    const token = getSessionToken()
    try {
      const data = await api.listItems(collection)
      setItems(data)
      setStatus('ready')
      setSource('live')
      setMirroredAt(null)
      // Write the fresh list back to the mirror (fail-closed: a storage
      // failure never affects the live view). Only when we have a resolved
      // session user to scope it under.
      if (user?.id) {
        await saveMirror(user.id, data)
      }
    } catch (err) {
      // Fail closed on confirmed authorization failures — never render cached
      // private data for a revoked/disabled session.
      if (!isSafeToMirror(err)) {
        setError(err.message)
        setStatus('error')
        setSource(null)
        setMirroredAt(null)
        return
      }
      // Safe failure (offline / 5xx / network): try the offline mirror. The
      // mirror read is itself gated by offline trust + session binding.
      const mirror = user?.id
        ? await readMirror(user.id, { token, scopeName: OFFLINE_SCOPES.COLLECTION })
        : null
      if (mirror) {
        setItems(mirror.items)
        setStatus('ready')
        setSource('offline')
        setMirroredAt(mirror.cachedAt)
        return
      }
      // No usable offline copy — surface the error (with the original message)
      // rather than a silent empty view.
      setError(err.message)
      setStatus('error')
      setSource(null)
      setMirroredAt(null)
    }
  }, [collection])

  useEffect(() => { refresh() }, [refresh])

  const add = useCallback(async (item) => {
    const saved = await api.addItem(item, collection)
    setItems((prev) => [saved, ...prev])
    return saved
  }, [collection])

  const update = useCallback(async (id, patch) => {
    const prevItems = items
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
    try {
      await api.updateItem(id, patch, collection)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  const remove = useCallback(async (id) => {
    const prevItems = items
    setItems((prev) => prev.filter((it) => it.id !== id))
    try {
      await api.deleteItem(id, collection)
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  // Optimistic lend: set item.lending immediately, revert + re-throw on failure.
  // The optimistic shape mirrors what the lending function stores (see
  // netlify/functions/lending.js handleLend) so the UI matches the server.
  // `payload` is { borrower: { name, contact? }, dueOn? }.
  const lend = useCallback(async (id, payload) => {
    const prevItems = items
    setItems((prev) =>
      prev.map((it) =>
        it.id === id
          ? {
              ...it,
              lending: {
                borrower: {
                  name: payload.borrower.name,
                  ...(payload.borrower.contact ? { contact: payload.borrower.contact } : {}),
                },
                lentOn: new Date().toISOString(),
                ...(payload.dueOn ? { dueOn: payload.dueOn } : {}),
              },
            }
          : it,
      ),
    )
    try {
      await apiLending.lend({ collection, itemId: id, borrower: payload.borrower, dueOn: payload.dueOn })
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  // Optimistic return: clear item.lending and push the loan onto lendingHistory
  // immediately, revert + re-throw on failure. Cap matches the server's
  // HISTORY_CAP (netlify/functions/lending.js).
  const returnItem = useCallback(async (id) => {
    const prevItems = items
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it
        const updated = { ...it }
        if (it.lending) {
          const record = { ...it.lending, returnedOn: new Date().toISOString() }
          updated.lendingHistory = [record, ...(it.lendingHistory || [])].slice(0, 10)
        }
        delete updated.lending
        return updated
      }),
    )
    try {
      await apiLending.returnItem({ collection, itemId: id })
    } catch (err) {
      setItems(prevItems)
      throw err
    }
  }, [items, collection])

  return { items, status, error, source, mirroredAt, refresh, add, update, remove, lend, returnItem }
}
