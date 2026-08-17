import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../api/reviews'
import { getSession, getSessionToken } from '../utils/session'

// ---------------------------------------------------------------------------
// useReviews(kind, sourceId) — load + mutate the community-review thread for
// one release (records → item.discogsId, books → item.googleBooksId).
//
// Mirrors useCollection's optimistic-with-rollback pattern: writes update the
// state immediately, then adopt the server's returned review on success or
// revert + re-throw on failure. The aggregate is derived from the displayed
// list (published ratings only), so it moves with the caller's own review and
// never relies on fragile client-side delta math against a server number that
// could be moderated/rounded differently.
//
// "Not signed in" still loads the public reviews/aggregate — only the
// composer is gated (component side via `signedIn`).
// ---------------------------------------------------------------------------

// Two reviews are "the same" if they share an id, or (id-less optimistic
// entries) the same author id. Never compare on authorName — two members can
// share a name.
function isSameReview(a, b) {
  if (!a || !b) return false
  if (a.id && b.id) return a.id === b.id
  return !!(a.authorId && a.authorId === b.authorId)
}

// Published-rating aggregate over a review list — count + 1-decimal average.
// Only published reviews count (a pending mine must not inflate the average).
function aggregateFrom(reviews) {
  const ratings = (Array.isArray(reviews) ? reviews : [])
    .filter((r) => !r?.status || r.status === 'published')
    .map((r) => Number(r?.rating))
    .filter((n) => Number.isFinite(n) && n > 0)
  if (!ratings.length) return { avg: 0, count: 0 }
  const count = ratings.length
  const avg = Math.round((ratings.reduce((a, b) => a + b, 0) / count) * 10) / 10
  return { avg, count }
}

// Newest first — defensive against a backend that forgets to sort.
function sortNewestFirst(list) {
  return [...list].sort((a, b) => new Date(b?.createdAt) - new Date(a?.createdAt))
}

export function useReviews(kind, sourceId) {
  const signedIn = !!getSessionToken()

  const [reviews, setReviews] = useState([]) // published reviews from the server
  const [mine, setMine] = useState(null)     // the caller's own review or null
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState(null)

  // No provider id (e.g. a manually added item) → nothing to load; stay ready
  // with an empty thread rather than firing a pointless request.
  const canLoad = !!(kind && sourceId)

  const refresh = useCallback(async () => {
    if (!canLoad) {
      setReviews([])
      setMine(null)
      setError(null)
      setStatus('ready')
      return
    }
    setStatus('loading')
    try {
      const data = await api.listReviews(kind, sourceId)
      setReviews(sortNewestFirst(Array.isArray(data.reviews) ? data.reviews : []))
      setMine(data.mine || null)
      setError(null)
      setStatus('ready')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }, [kind, sourceId, canLoad])

  useEffect(() => { refresh() }, [refresh])

  // What the UI actually renders: the caller's review first (once), then the
  // rest of the published list. Works whether or not the backend includes the
  // caller's own review inside `reviews`.
  const allReviews = useMemo(() => {
    const list = Array.isArray(reviews) ? reviews : []
    if (!mine) return list
    return [mine, ...list.filter((r) => !isSameReview(r, mine))]
  }, [reviews, mine])

  const aggregate = useMemo(() => aggregateFrom(allReviews), [allReviews])

  // Upsert the caller's review. The optimistic entry carries the current
  // session's identity so it dedupes against the server list; on success the
  // server's authoritative review replaces it (and any stale copy of the
  // caller's review is dropped from the list).
  const addOrUpdate = useCallback(async (rating, body) => {
    const prevMine = mine
    const me = getSession()?.user || {}
    const optimistic = {
      id: prevMine?.id || `pending-${Date.now()}`,
      kind,
      sourceId,
      authorId: prevMine?.authorId || me.id || '',
      authorName: prevMine?.authorName || me.name || '',
      rating: Number(rating),
      body: String(body ?? ''),
      status: 'published',
      createdAt: prevMine?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setMine(optimistic)
    try {
      const data = await api.upsertReview({ kind, sourceId, rating, body })
      const saved = data?.review || optimistic
      setMine(saved)
      setReviews((prev) => sortNewestFirst([saved, ...prev.filter((r) => !isSameReview(r, saved))]))
      return saved
    } catch (err) {
      setMine(prevMine)
      throw err
    }
  }, [kind, sourceId, mine])

  // Delete the caller's review. Clears `mine` optimistically and drops the
  // deleted review from the published list too (it may have been included).
  const remove = useCallback(async () => {
    const prevMine = mine
    if (!prevMine?.id) return
    setMine(null)
    try {
      await api.deleteReview({ kind, sourceId, id: prevMine.id })
      setReviews((prev) => prev.filter((r) => !isSameReview(r, prevMine)))
    } catch (err) {
      setMine(prevMine)
      throw err
    }
  }, [kind, sourceId, mine])

  return {
    reviews,
    mine,
    allReviews,
    aggregate,
    status,
    error,
    refresh,
    addOrUpdate,
    remove,
    signedIn,
  }
}
