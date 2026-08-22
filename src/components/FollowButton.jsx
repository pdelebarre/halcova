import { useCallback, useEffect, useState } from 'react'
import * as socialApi from '../api/social'
import { t } from '../i18n'
import './FollowButton.css'

/**
 * FollowButton — Follow/unfollow toggle for profile pages (FEAT-8.2, #327).
 *
 * Props:
 *   targetId    — the user_id or collection share_id to follow/unfollow
 *   targetType  — 'user' (default) or 'collection'
 *   onFollow    — optional callback(targetId, isFollowing) after toggle
 *   size        — 'sm' | 'md' (default)
 */
export default function FollowButton({ targetId, targetType = 'user', onFollow, size = 'md' }) {
  const [following, setFollowing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (!targetId) {
      setFollowing(false)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    socialApi.isFollowing(targetId, targetType)
      .then((data) => {
        if (!cancelled) setFollowing(!!data.isFollowing)
      })
      .catch(() => {
        if (!cancelled) setFollowing(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [targetId, targetType])

  const handleToggle = useCallback(async () => {
    if (toggling || !targetId) return
    setToggling(true)
    try {
      if (following) {
        await socialApi.unfollow(targetId, targetType)
        setFollowing(false)
      } else {
        await socialApi.follow(targetId, targetType)
        setFollowing(true)
      }
      onFollow?.(targetId, !following)
    } catch {
      // Silently fail — the button stays in its current state.
    } finally {
      setToggling(false)
    }
  }, [following, targetId, targetType, toggling, onFollow])

  if (loading) {
    return (
      <button type="button" className={`follow-btn follow-btn--${size} follow-btn--loading`} disabled>
        <span className="follow-btn-spinner" aria-hidden="true" />
      </button>
    )
  }

  return (
    <button
      type="button"
      className={`follow-btn follow-btn--${size} ${following ? 'follow-btn--active' : ''}`}
      onClick={handleToggle}
      disabled={toggling}
      aria-pressed={following}
      aria-label={following ? t('social.unfollow') : t('social.follow')}
    >
      {following ? t('social.following') : t('social.follow')}
    </button>
  )
}