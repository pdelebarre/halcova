import { useCallback, useEffect, useRef, useState } from 'react'
import * as socialApi from '../api/social'
import { t } from '../i18n'
import './FeedPage.css'

/**
 * FeedPage — Collector Activity Feed (FEAT-8.2, #327).
 *
 * Displays a paginated list of activities from followed users. Activities are
 * filtered through the authorization model (only public profile activities are
 * visible). Paginated with cursor-based "Load more" or infinite scroll.
 *
 * Props:
 *   onViewProfile  — optional callback(shareId) to navigate to a user's profile
 *   onViewItem     — optional callback(itemId, kind) to navigate to an item
 */
export default function FeedPage({ onViewProfile, onViewItem }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const sentinelRef = useRef(null)
  const loadingRef = useRef(false)
  const mountedRef = useRef(true)

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    setLoading(true)
    setError(null)

    socialApi.getFeed({ limit: 20 })
      .then((data) => {
        if (cancelled || !mountedRef.current) return
        setActivities(data.items || [])
        setNextCursor(data.nextCursor || null)
        setHasMore(!!data.hasMore)
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return
        setError(err.message || t('feed.loadError'))
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoading(false)
      })

    return () => { cancelled = true }
  }, [])

  // Load more with cursor
  const loadMore = useCallback(async () => {
    if (loadingRef.current || !nextCursor) return
    loadingRef.current = true
    setLoadingMore(true)

    try {
      const data = await socialApi.getFeed({ before: nextCursor, limit: 20 })
      if (!mountedRef.current) return
      setActivities((prev) => [...prev, ...(data.items || [])])
      setNextCursor(data.nextCursor || null)
      setHasMore(!!data.hasMore)
    } catch {
      // Silently fail on load-more errors
    } finally {
      if (mountedRef.current) setLoadingMore(false)
      loadingRef.current = false
    }
  }, [nextCursor])

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingRef.current) {
          loadMore()
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadMore])

  // Cleanup on unmount
  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  function formatTime(isoString) {
    if (!isoString) return ''
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMinutes = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMinutes < 1) return t('feed.justNow')
    if (diffMinutes < 60) return t('feed.minutesAgo', { n: diffMinutes })
    if (diffHours < 24) return t('feed.hoursAgo', { n: diffHours })
    if (diffDays < 7) return t('feed.daysAgo', { n: diffDays })
    return date.toLocaleDateString()
  }

  function renderActivity(activity) {
    const actor = activity.actor || {}
    const data = activity.data || {}

    switch (activity.type) {
      case 'add_item':
        return (
          <div className="feed-activity feed-activity--add">
            <div className="feed-activity-actor">
              {actor.avatar ? (
                <img
                  className="feed-activity-avatar"
                  src={actor.avatar}
                  alt={actor.username || ''}
                  onClick={() => onViewProfile?.(actor.shareId)}
                />
              ) : (
                <div
                  className="feed-activity-avatar feed-activity-avatar-placeholder"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {(actor.username || '?')[0]?.toUpperCase()}
                </div>
              )}
              <div className="feed-activity-header">
                <span
                  className="feed-activity-username"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {actor.username || t('profile.defaultName')}
                </span>
                <span className="feed-activity-action">
                  {t('feed.addedItem', { kind: data.kind || '' })}
                </span>
              </div>
            </div>
            <div className="feed-activity-body" onClick={() => onViewItem?.(data.itemId, data.kind)}>
              {data.coverImage && (
                <img className="feed-activity-cover" src={data.coverImage} alt={data.title || ''} loading="lazy" />
              )}
              <div className="feed-activity-details">
                <strong className="feed-activity-title">{data.title || t('common.untitled')}</strong>
                {data.artists && <span className="feed-activity-artist">{data.artists}</span>}
                {data.authorsList && <span className="feed-activity-artist">{data.authorsList}</span>}
                {data.year && <span className="feed-activity-year">{data.year}</span>}
              </div>
            </div>
            <span className="feed-activity-time">{formatTime(activity.createdAt)}</span>
          </div>
        )

      case 'complete_collection':
        return (
          <div className="feed-activity feed-activity--complete">
            <div className="feed-activity-actor">
              {actor.avatar ? (
                <img
                  className="feed-activity-avatar"
                  src={actor.avatar}
                  alt={actor.username || ''}
                  onClick={() => onViewProfile?.(actor.shareId)}
                />
              ) : (
                <div
                  className="feed-activity-avatar feed-activity-avatar-placeholder"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {(actor.username || '?')[0]?.toUpperCase()}
                </div>
              )}
              <div className="feed-activity-header">
                <span
                  className="feed-activity-username"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {actor.username || t('profile.defaultName')}
                </span>
                <span className="feed-activity-action">
                  {t('feed.completedCollection', { kind: t(`kind.${data.kind || 'records'}`) })}
                </span>
              </div>
            </div>
            <span className="feed-activity-time">{formatTime(activity.createdAt)}</span>
          </div>
        )

      case 'showcase_update':
        return (
          <div className="feed-activity feed-activity--showcase">
            <div className="feed-activity-actor">
              {actor.avatar ? (
                <img
                  className="feed-activity-avatar"
                  src={actor.avatar}
                  alt={actor.username || ''}
                  onClick={() => onViewProfile?.(actor.shareId)}
                />
              ) : (
                <div
                  className="feed-activity-avatar feed-activity-avatar-placeholder"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {(actor.username || '?')[0]?.toUpperCase()}
                </div>
              )}
              <div className="feed-activity-header">
                <span
                  className="feed-activity-username"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {actor.username || t('profile.defaultName')}
                </span>
                <span className="feed-activity-action">
                  {t('feed.updatedShowcase', { kind: t(`kind.${data.kind || 'records'}`) })}
                </span>
              </div>
            </div>
            <span className="feed-activity-time">{formatTime(activity.createdAt)}</span>
          </div>
        )

      case 'profile_update':
        return (
          <div className="feed-activity feed-activity--profile">
            <div className="feed-activity-actor">
              {actor.avatar ? (
                <img
                  className="feed-activity-avatar"
                  src={actor.avatar}
                  alt={actor.username || ''}
                  onClick={() => onViewProfile?.(actor.shareId)}
                />
              ) : (
                <div
                  className="feed-activity-avatar feed-activity-avatar-placeholder"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {(actor.username || '?')[0]?.toUpperCase()}
                </div>
              )}
              <div className="feed-activity-header">
                <span
                  className="feed-activity-username"
                  onClick={() => onViewProfile?.(actor.shareId)}
                >
                  {actor.username || t('profile.defaultName')}
                </span>
                <span className="feed-activity-action">{t('feed.updatedProfile')}</span>
              </div>
            </div>
            {Array.isArray(data.fields) && data.fields.length > 0 && (
              <div className="feed-activity-changed-fields">
                {data.fields.join(', ')}
              </div>
            )}
            <span className="feed-activity-time">{formatTime(activity.createdAt)}</span>
          </div>
        )

      default:
        return null
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="feed-page">
        <h2 className="feed-page-title">{t('feed.title')}</h2>
        <div className="feed-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="feed-skeleton">
              <div className="feed-skeleton-avatar" />
              <div className="feed-skeleton-lines">
                <div className="feed-skeleton-line" />
                <div className="feed-skeleton-line feed-skeleton-line--short" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Error state
  if (error && activities.length === 0) {
    return (
      <div className="feed-page">
        <h2 className="feed-page-title">{t('feed.title')}</h2>
        <div className="feed-empty">
          <p className="feed-error-msg">{error}</p>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => window.location.reload()}
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="feed-page">
      <h2 className="feed-page-title">{t('feed.title')}</h2>

      {activities.length === 0 ? (
        <div className="feed-empty">
          <div className="feed-empty-icon" aria-hidden="true">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <p className="feed-empty-text">{t('feed.emptyTitle')}</p>
          <p className="feed-empty-subtext">{t('feed.emptyDesc')}</p>
        </div>
      ) : (
        <div className="feed-list" role="feed" aria-label={t('feed.title')}>
          {activities.map((activity) => (
            <article key={activity.id} className="feed-item" aria-label={`${activity.type} activity`}>
              {renderActivity(activity)}
            </article>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="feed-sentinel">
        {loadingMore && (
          <div className="feed-loading-more">
            <span className="feed-spinner" aria-hidden="true" />
            <span>{t('feed.loadingMore')}</span>
          </div>
        )}
        {!hasMore && activities.length > 0 && (
          <p className="feed-end">{t('feed.end')}</p>
        )}
      </div>
    </div>
  )
}