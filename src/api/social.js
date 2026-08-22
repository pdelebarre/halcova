import { getSessionToken } from '../utils/session'

// Client for the social Netlify function (FEAT-8.2, #327).
// Follows the same patterns as src/api/profiles.js and src/api/collection.js.

const FN_BASE = '/.netlify/functions/social'

function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function handle(res) {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    let code
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
      if (body?.code) code = body.code
    } catch { /* ignore */ }
    const err = new Error(msg)
    if (code) err.code = code
    throw err
  }
  return res.json()
}

// POST /social/follow — follow a user or collection
export async function follow(followedId, followedType = 'user') {
  const res = await fetch(`${FN_BASE}/follow`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ followedId, followedType }),
  })
  return handle(res)
}

// POST /social/unfollow — unfollow a user or collection
export async function unfollow(followedId, followedType = 'user') {
  const res = await fetch(`${FN_BASE}/unfollow`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ followedId, followedType }),
  })
  return handle(res)
}

// GET /social/following — list who the current user follows
export async function getFollowing({ before, limit } = {}) {
  const params = new URLSearchParams()
  if (before) params.set('before', before)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  const res = await fetch(`${FN_BASE}/following${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  })
  return handle(res)
}

// GET /social/followers/:targetId — list followers of a target
export async function getFollowers(targetId, { type = 'user', before, limit } = {}) {
  const params = new URLSearchParams({ type })
  if (before) params.set('before', before)
  if (limit) params.set('limit', String(limit))
  const res = await fetch(`${FN_BASE}/followers/${encodeURIComponent(targetId)}?${params.toString()}`, {
    headers: authHeaders(),
  })
  return handle(res)
}

// GET /social/is-following — check if the current user follows a target
export async function isFollowing(followedId, type = 'user') {
  const res = await fetch(`${FN_BASE}/is-following?followedId=${encodeURIComponent(followedId)}&type=${encodeURIComponent(type)}`, {
    headers: authHeaders(),
  })
  return handle(res)
}

// GET /social/feed — the current user's activity feed
export async function getFeed({ before, limit } = {}) {
  const params = new URLSearchParams()
  if (before) params.set('before', before)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  const res = await fetch(`${FN_BASE}/feed${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  })
  return handle(res)
}

// POST /social/activity — log an activity for the current user
export async function logActivity(type, data = {}) {
  const res = await fetch(`${FN_BASE}/activity`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, data }),
  })
  return handle(res)
}

// GET /social/activity/mine — the current user's own activities
export async function getMyActivities({ before, limit } = {}) {
  const params = new URLSearchParams()
  if (before) params.set('before', before)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  const res = await fetch(`${FN_BASE}/activity/mine${qs ? `?${qs}` : ''}`, {
    headers: authHeaders(),
  })
  return handle(res)
}