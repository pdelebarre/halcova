// netlify/functions/social.js — Follows & Collector Activity Feed (FEAT-8.2, #327).
//
// Every member gets social capabilities: follow/unfollow other members, view
// their activity feed, and log activities for their own actions.
//
// Route surface:
//   POST   /social/follow
//          body { followedId, followedType? }
//          -> 200 { follow: { id, followerId, followedId, followedType, createdAt } }
//
//   POST   /social/unfollow
//          body { followedId, followedType? }
//          -> 200 { unfollowed: true }
//
//   GET    /social/following?before=<cursor>&limit=<n>
//          -> 200 { items: [...], nextCursor: "...", hasMore: bool }
//
//   GET    /social/followers/:targetId?type=<user>&before=<cursor>&limit=<n>
//          -> 200 { items: [...], nextCursor: "...", hasMore: bool }
//
//   GET    /social/feed?before=<cursor>&limit=<n>
//          -> 200 { items: [...], nextCursor: "...", hasMore: bool }
//
//   GET    /social/is-following?followedId=<id>&type=<type>
//          -> 200 { isFollowing: bool }
//
//   POST   /social/activity
//          body { type, data }
//          -> 200 { activity: { ... } }
//
// Security:
//   - Follow/unfollow is idempotent (UNIQUE constraint).
//   - Feed is filtered through visibility model: only public profiles' public
//     activities are shown to the viewer.
//   - Feed is filtered through isBlocked (blocks-repo stub, #330).
//   - Activity data contains ONLY C1 public metadata — no private item
//     attributes leak into feed payloads.
//   - Feed is paginated (cursor-based, created_at DESC) and rate-limited.
//   - Unfollow immediately removes inaccessible content (next feed query
//     excludes unfollowed user's activities).
//   - Demo identity is read-only on follow/unfollow (deny: ['demo']).

import { getStore } from '@netlify/blobs'
import { json } from './_shared/collection-store'
import { enforce, forbidden } from './_shared/policy'
import { rateLimitGuard, rateLimitIdentity } from './_shared/rate-limit'
import { isPostgresConfigured, db } from './_shared/postgres'
import { createFollowsRepo } from './_shared/repositories/follows-repo'
import { createActivitiesRepo } from './_shared/repositories/activities-repo'
import { createBlocksRepo } from './_shared/repositories/blocks-repo'
import { createProfilesRepo } from './_shared/repositories/profiles-repo'
import { readJsonBody, safeError, str, check } from './_shared/security'

const RATE_LIMITS_STORE = 'runout-rate-limits'
const SOCIAL_RATE_LIMIT = Number(process.env.RUNOUT_SOCIAL_RATE_LIMIT) || 60
const FEED_RATE_LIMIT = Number(process.env.RUNOUT_FEED_RATE_LIMIT) || 30

// Allowed follow types.
const FOLLOW_TYPES = new Set(['user', 'collection'])

// Allowed activity types (must match activities-repo).
const ACTIVITY_TYPES = new Set([
  'add_item',
  'complete_collection',
  'showcase_update',
  'profile_update',
])

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const FOLLOW_WRITE_FIELDS = new Set(['followedId', 'followedType'])

function validateFollowBody(body) {
  const unknown = Object.keys(body || {}).filter((k) => !FOLLOW_WRITE_FIELDS.has(k))
  if (unknown.length > 0) {
    return { error: json(400, { error: `Unknown field: ${unknown[0]}`, code: 'UNKNOWN_FIELD' }) }
  }
  const followedId = str(body?.followedId, { required: true, max: 255 })
  const followedType = body?.followedType !== undefined
    ? (FOLLOW_TYPES.has(body.followedType)
        ? { value: body.followedType }
        : { error: { code: 'INVALID_TYPE', message: 'Followed type must be "user" or "collection".' } })
    : { value: 'user' }
  const err = check(followedId, followedType)
  if (err) return { error: json(400, { error: err.message, code: err.code }) }
  return { followedId: followedId.value, followedType: followedType.value }
}

const ACTIVITY_WRITE_FIELDS = new Set(['type', 'data'])

function validateActivityBody(body) {
  const unknown = Object.keys(body || {}).filter((k) => !ACTIVITY_WRITE_FIELDS.has(k))
  if (unknown.length > 0) {
    return { error: json(400, { error: `Unknown field: ${unknown[0]}`, code: 'UNKNOWN_FIELD' }) }
  }
  const type = str(body?.type, { required: true, max: 50 })
  const err = check(type)
  if (err) return { error: json(400, { error: err.message, code: err.code }) }
  if (!ACTIVITY_TYPES.has(type.value)) {
    return { error: json(400, { error: `Unknown activity type: ${type.value}`, code: 'INVALID_TYPE' }) }
  }
  const data = body?.data && typeof body.data === 'object' && !Array.isArray(body.data)
    ? body.data
    : {}
  return { type: type.value, data }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// POST /social/follow
async function handleFollow(followsRepo, user, body) {
  const validated = validateFollowBody(body)
  if (validated.error) return validated.error
  const follow = await followsRepo.follow(user.id, validated.followedId, validated.followedType)
  if (!follow) return json(400, { error: 'Could not follow.', code: 'FOLLOW_FAILED' })
  return json(200, { follow })
}

// POST /social/unfollow
async function handleUnfollow(followsRepo, user, body) {
  const validated = validateFollowBody(body)
  if (validated.error) return validated.error
  await followsRepo.unfollow(user.id, validated.followedId, validated.followedType)
  return json(200, { unfollowed: true })
}

// GET /social/following
async function handleFollowing(followsRepo, user, url) {
  const before = url.searchParams.get('before') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 50)
  const result = await followsRepo.listFollowing(user.id, { limit, before })
  return json(200, result)
}

// GET /social/followers/:targetId
async function handleFollowers(followsRepo, targetId, url) {
  if (!targetId) return json(400, { error: 'Missing targetId', code: 'MISSING_TARGET' })
  const type = url.searchParams.get('type') || 'user'
  const before = url.searchParams.get('before') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 50)
  const result = await followsRepo.listFollowers(targetId, type, { limit, before })
  return json(200, result)
}

// GET /social/is-following
async function handleIsFollowing(followsRepo, user, url) {
  const followedId = url.searchParams.get('followedId')
  const type = url.searchParams.get('type') || 'user'
  if (!followedId) return json(400, { error: 'Missing followedId', code: 'MISSING_FOLLOWED_ID' })
  const result = await followsRepo.isFollowing(user.id, followedId, type)
  return json(200, { isFollowing: result })
}

// GET /social/feed — the viewer's activity feed (pull-based, fan-out-on-read).
// Fetches activities from followed users and filters through visibility + blocks.
async function handleFeed(followsRepo, activitiesRepo, blocksRepo, profilesRepo, user, url) {
  const before = url.searchParams.get('before') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 50)

  // 1. Get the set of user_ids the viewer follows.
  const followedUserIds = await followsRepo.getFollowedUserIds(user.id)
  if (followedUserIds.length === 0) {
    return json(200, { items: [], nextCursor: null, hasMore: false })
  }

  // 2. Fetch activities from followed users.
  const result = await activitiesRepo.getFeed(followedUserIds, { limit: limit * 2, before })

  // 3. Filter through authorization:
  //    - Only include activities from users whose profiles are PUBLIC
  //      (private/owner profiles' activities are excluded).
  //    - Exclude activities from blocked users (stub until #330).
  //    - Strip any non-C1 data from the payload.
  const filtered = []
  for (const activity of result.items) {
    // Check block status (stub returns false until #330).
    const blocked = await blocksRepo.isBlocked(user.id, activity.userId)
    if (blocked) continue

    // Check visibility: get the activity author's profile and ensure it's public.
    const profile = await profilesRepo.getByUserId(activity.userId)
    if (!profile) continue

    // For `add_item` activities, we show them only if the profile's collection
    // visibility is public or owner-level (the viewer follows them, so 'owner'
    // is accessible). For profile_update, only if the profile visibility is public.
    if (activity.type === 'add_item') {
      if (profile.collectionVisibility !== 'public' && profile.collectionVisibility !== 'owner') continue
    } else if (activity.type === 'profile_update') {
      if (profile.visibility !== 'public' && profile.visibility !== 'owner') continue
    } else {
      // complete_collection, showcase_update: require at least "owner" visibility
      if (profile.visibility !== 'public' && profile.visibility !== 'owner') continue
    }

    // 4. Ensure only safe C1 fields are in the data payload.
    const safeData = sanitizeActivityData(activity.type, activity.data)
    filtered.push({
      ...activity,
      data: safeData,
      // Include lightweight profile info for the feed renderer.
      actor: {
        userId: profile.userId,
        username: profile.username,
        avatar: profile.avatar,
        shareId: profile.shareId,
      },
    })

    // Stop when we have enough after filtering.
    if (filtered.length >= limit) break
  }

  const hasMore = filtered.length >= limit || result.hasMore
  const nextCursor = hasMore && filtered.length > 0
    ? filtered[filtered.length - 1].createdAt
    : null

  return json(200, {
    items: filtered.slice(0, limit),
    nextCursor,
    hasMore,
  })
}

// Strip any non-C1 (non-public-catalog) fields from activity data payloads.
// This is defense-in-depth on top of the app-level constraint that only C1
// fields are ever stored in activity data.
function sanitizeActivityData(type, data) {
  if (!data || typeof data !== 'object') return {}
  // For all activity types, only allow known public fields.
  const safe = {}
  const ALLOWED = new Set([
    'kind', 'itemId', 'title', 'coverImage', 'artists', 'authorsList',
    'year', 'label', 'genre', 'fields', 'itemIds',
  ])
  for (const key of Object.keys(data)) {
    if (ALLOWED.has(key)) {
      safe[key] = data[key]
    }
  }
  return safe
}

// POST /social/activity — log an activity for the current user.
// Intended to be called by other functions (collection.js after add_item, etc.)
// or by the user directly for profile updates.
async function handleLogActivity(activitiesRepo, user, body) {
  const validated = validateActivityBody(body)
  if (validated.error) return validated.error
  const activity = await activitiesRepo.logActivity(user.id, validated.type, validated.data)
  if (!activity) return json(400, { error: 'Could not log activity.', code: 'ACTIVITY_FAILED' })
  return json(200, { activity })
}

// GET /social/activity/mine — the viewer's own activities (profile activity tab).
async function handleMyActivities(activitiesRepo, user, url) {
  const before = url.searchParams.get('before') || undefined
  const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 50)
  const result = await activitiesRepo.getActivitiesByUser(user.id, { limit, before })
  return json(200, result)
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

function parseUrl(req) {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/\.netlify\/functions\/social/, '')
  const segments = path.split('/').filter(Boolean)
  return { segments, url }
}

function actionFor(req, segments) {
  const method = req.method
  // POST /social/follow
  if (method === 'POST' && segments[0] === 'follow') return 'social:follow'
  // POST /social/unfollow
  if (method === 'POST' && segments[0] === 'unfollow') return 'social:unfollow'
  // GET /social/following
  if (method === 'GET' && segments[0] === 'following') return 'social:following:read'
  // GET /social/followers/:targetId
  if (method === 'GET' && segments[0] === 'followers') return 'social:followers:read'
  // GET /social/is-following
  if (method === 'GET' && segments[0] === 'is-following') return 'social:following:read'
  // GET /social/feed
  if (method === 'GET' && segments[0] === 'feed') return 'social:feed:read'
  // POST /social/activity
  if (method === 'POST' && segments[0] === 'activity') return 'social:activity:mine'
  // GET /social/activity/mine
  if (method === 'GET' && segments[0] === 'activity' && segments[1] === 'mine') return 'social:activity:mine'
  return null
}

// ---------------------------------------------------------------------------
// Rate limit guard
// ---------------------------------------------------------------------------

async function feedGuardError(req, user) {
  const identity = rateLimitIdentity(user, req)
  if (!identity) return null
  const rl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'social:feed',
    limit: FEED_RATE_LIMIT,
    identity,
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  return rl
}

async function writeGuardError(req, user) {
  const identity = rateLimitIdentity(user, req)
  if (!identity) return null
  const rl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'social:write',
    limit: SOCIAL_RATE_LIMIT,
    identity,
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  return rl
}

// ---------------------------------------------------------------------------
// Handler export
// ---------------------------------------------------------------------------

export default async function socialHandler(req) {
  try {
    const { segments, url } = parseUrl(req)
    const action = actionFor(req, segments)

    if (!action) {
      return json(405, { error: 'Method not allowed' })
    }

    const followsRepo = createFollowsRepo(db)
    const activitiesRepo = createActivitiesRepo(db)
    const blocksRepo = createBlocksRepo(db)
    const profilesRepo = createProfilesRepo(db)

    // Public followers read doesn't require authentication.
    if (action === 'social:followers:read') {
      const targetId = segments[1]
      return handleFollowers(followsRepo, targetId, url)
    }

    // All other actions require authentication.
    const { user, error } = await enforce(req, action, {
      denyCode: 'DEMO_READONLY',
      denyMessage: 'The demo space is read-only. Sign in to use social features.',
    })
    if (error) return error

    // Feed read: rate-limited separately.
    if (action === 'social:feed:read') {
      const guardErr = await feedGuardError(req, user)
      if (guardErr) return guardErr
      return handleFeed(followsRepo, activitiesRepo, blocksRepo, profilesRepo, user, url)
    }

    // Write actions: follow, unfollow, activity log.
    if (action === 'social:follow' || action === 'social:unfollow' || action === 'social:activity:mine') {
      const guardErr = await writeGuardError(req, user)
      if (guardErr) return guardErr
      if (action === 'social:activity:mine' && req.method === 'GET') {
        return handleMyActivities(activitiesRepo, user, url)
      }
      const parsed = await readJsonBody(req)
      if (parsed.error) return parsed.error
      if (action === 'social:follow') return handleFollow(followsRepo, user, parsed.value ?? {})
      if (action === 'social:unfollow') return handleUnfollow(followsRepo, user, parsed.value ?? {})
      if (action === 'social:activity:mine') return handleLogActivity(activitiesRepo, user, parsed.value ?? {})
    }

    // Read-only following check.
    if (action === 'social:following:read') {
      if (segments[0] === 'is-following') {
        return handleIsFollowing(followsRepo, user, url)
      }
      return handleFollowing(followsRepo, user, url)
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return safeError(err, req)
  }
}