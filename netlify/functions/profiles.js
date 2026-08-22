// netlify/functions/profiles.js — Collector Profiles & Public Collections
// (FEAT-8.1, #326).
//
// Every member gets exactly ONE profile. Profile and collection visibility are
// independently configurable. Public pages expose only explicitly public fields.
// Share links use opaque UUIDs (share_id) and server-side authorization.
//
// Route surface:
//   GET    /profiles/public/:shareId
//          -> 200 { profile: { username, avatar, bio, links } }
//          404 when share id is unknown or profile is private
//
//   GET    /profiles/public/:shareId/collections?kind=<records|books>
//          -> 200 { items: [public C1 fields only] }
//          404 when share id is unknown or collection visibility is private
//
//   GET    /profiles/me
//          -> 200 { profile: { full profile with visibility settings } }
//
//   PUT    /profiles/me
//          body { username?, avatar?, bio?, links?, visibility?,
//                 collectionVisibility? }
//          -> 200 { profile }
//
//   DELETE /profiles/me
//          -> 204 (set visibility to private, revoke public access)
//
// Security:
//   - Profile visibility is enforced server-side via resolveVisibility().
//   - Collection visibility is independently configurable.
//   - Public collection items are filtered through filter.js (profileItem
//     resource) which strips price, location, serial, notes, receipts.
//   - Share links use opaque UUIDs (not sequential integers).
//   - Account deletion/privacy changes revoke public access promptly.
//   - Demo identity is read-only (deny: ['demo'] on write actions).

import { getStore } from '@netlify/blobs'
import { json } from './_shared/collection-store'
import { enforce, forbidden } from './_shared/policy'
import { filterFor } from './_shared/filter'
import { rateLimitGuard, rateLimitIdentity } from './_shared/rate-limit'
import { isPostgresConfigured, db } from './_shared/postgres'
import { createProfilesRepo } from './_shared/repositories/profiles-repo'
import { readJsonBody, safeError, str, boolean, check, rejectUnknown } from './_shared/security'
import { resolveVisibility, VISIBILITY } from './_shared/visibility'

const RATE_LIMITS_STORE = 'runout-rate-limits'
const PROFILES_RATE_LIMIT = Number(process.env.RUNOUT_PROFILES_RATE_LIMIT) || 30

// Allowed fields for profile write (mass-assignment guard).
const PROFILE_WRITE_FIELDS = new Set([
  'username', 'avatar', 'bio', 'links', 'visibility', 'collectionVisibility',
])

// Allowed visibility values.
const VISIBILITY_VALUES = new Set(['private', 'owner', 'public'])

// Validate a profile write body. Returns { ...fields } on success, or
// { error: <Response> } carrying a 400 on the first problem.
function validateProfileWrite(body) {
  const unknown = rejectUnknown(body, PROFILE_WRITE_FIELDS)
  if (unknown) return { error: json(400, { error: unknown.message, code: unknown.code }) }

  const username = str(body?.username, { max: 80 })
  const avatar = str(body?.avatar, { max: 500, rejectHtml: false })
  const bio = str(body?.bio, { max: 500 })
  const visibility = body?.visibility !== undefined
    ? (VISIBILITY_VALUES.has(body.visibility)
        ? { value: body.visibility }
        : { error: { code: 'INVALID_VISIBILITY', message: 'Visibility must be private, owner, or public.' } })
    : { value: undefined }
  const collectionVisibility = body?.collectionVisibility !== undefined
    ? (VISIBILITY_VALUES.has(body.collectionVisibility)
        ? { value: body.collectionVisibility }
        : { error: { code: 'INVALID_VISIBILITY', message: 'Collection visibility must be private, owner, or public.' } })
    : { value: undefined }

  // Validate links array if present
  let links = { value: undefined }
  if (body?.links !== undefined) {
    if (!Array.isArray(body.links)) {
      links = { error: { code: 'TYPE_ERROR', message: 'Links must be an array.' } }
    } else if (body.links.length > 10) {
      links = { error: { code: 'TOO_LONG', message: 'At most 10 links.' } }
    } else {
      const validated = []
      for (const link of body.links) {
        if (!link || typeof link !== 'object') {
          links = { error: { code: 'TYPE_ERROR', message: 'Each link must be an object with label and url.' } }
          break
        }
        const label = String(link.label || '').trim().slice(0, 50)
        const url = String(link.url || '').trim().slice(0, 500)
        validated.push({ label, url })
      }
      if (!links.error) links = { value: validated }
    }
  }

  const err = check(username, avatar, bio, visibility, collectionVisibility, links)
  if (err) return { error: json(400, { error: err.message, code: err.code }) }

  return {
    username: username.value,
    avatar: avatar.value,
    bio: bio.value,
    links: links.value,
    visibility: visibility.value,
    collectionVisibility: collectionVisibility.value,
  }
}

// GET /profiles/public/:shareId — public profile page
async function handlePublicProfile(store, shareId) {
  if (!shareId) return json(400, { error: 'Missing shareId', code: 'MISSING_SHARE_ID' })
  const profile = await store.getByShareId(shareId)
  if (!profile) return json(404, { error: 'Not found' })
  // Filter to public fields only (username, avatar, bio, links)
  const visible = filterFor(null, 'profile', profile, { own: false })
  return json(200, { profile: visible })
}

// GET /profiles/public/:shareId/collections — public collection items
async function handlePublicCollections(store, shareId, kind) {
  if (!shareId) return json(400, { error: 'Missing shareId', code: 'MISSING_SHARE_ID' })
  if (!kind) return json(400, { error: 'Missing kind', code: 'MISSING_KIND' })
  const profile = await store.getByShareId(shareId)
  if (!profile) return json(404, { error: 'Not found' })
  // Check collection visibility
  if (resolveVisibility(profile.collectionVisibility) !== VISIBILITY.PUBLIC) {
    return json(404, { error: 'Not found' })
  }
  // Fetch public collection items — only C1 public catalog metadata
  // Items are fetched from the user's collection store
  const items = await fetchPublicItems(profile.userId, kind)
  const visible = items.map((item) => filterFor(null, 'profileItem', item))
  return json(200, { items: visible })
}

// Fetch items from a user's collection store, returning only public-safe fields
async function fetchPublicItems(userId, kind) {
  try {
    const store = getStore(`runout-${kind}`)
    const all = []
    const list = await store.list()
    for (const entry of list.blobs || []) {
      try {
        const item = await store.get(entry.key, { type: 'json' })
        if (item && item.owner === userId) {
          all.push(item)
        }
      } catch { /* skip unreadable entries */ }
    }
    return all
  } catch {
    return []
  }
}

// GET /profiles/me — own profile (authenticated)
async function handleMyProfile(store, user) {
  const profile = await store.getByUserId(user.id)
  if (!profile) return json(200, { profile: null })
  // Own view: everything including visibility settings
  const visible = filterFor(user, 'profile', profile, { own: true })
  return json(200, { profile: visible })
}

// PUT /profiles/me — upsert own profile
async function handleUpsertProfile(store, user, body) {
  const validated = validateProfileWrite(body)
  if (validated.error) return validated.error
  const profile = await store.upsertProfile({
    userId: user.id,
    username: validated.username,
    avatar: validated.avatar,
    bio: validated.bio,
    links: validated.links,
    visibility: validated.visibility,
    collectionVisibility: validated.collectionVisibility,
  })
  const visible = filterFor(user, 'profile', profile, { own: true })
  return json(200, { profile: visible })
}

// DELETE /profiles/me — revoke public access (set visibility to private)
async function handleDeleteProfile(store, user) {
  await store.revokePublicAccess(user.id)
  return new Response(null, { status: 204 })
}

// Rate-limit guard for profile writes
async function writeGuardError(req, user) {
  const identity = rateLimitIdentity(user, req)
  if (!identity) return null
  const rl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: 'profiles:write',
    limit: PROFILES_RATE_LIMIT,
    identity,
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  return rl
}

// Parse the URL to extract shareId and kind
function parseUrl(req) {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/\.netlify\/functions\/profiles/, '')
  const segments = path.split('/').filter(Boolean)
  const kind = url.searchParams.get('kind')
  return { segments, kind }
}

// Map the HTTP method + path to the policy action
function actionFor(req, segments) {
  const isPublic = segments[0] === 'public'
  const isMe = segments[0] === 'me'
  const method = req.method

  if (isPublic) {
    if (method === 'GET' && segments.length === 2) return 'profile:read:public'
    if (method === 'GET' && segments.length === 3 && segments[2] === 'collections') return 'profile:collection:read:public'
  }
  if (isMe) {
    if (method === 'GET') return 'profile:read:own'
    if (method === 'PUT') return 'profile:write'
    if (method === 'DELETE') return 'profile:delete'
  }
  return null
}

export default async function profilesHandler(req) {
  try {
    const { segments, kind } = parseUrl(req)
    const action = actionFor(req, segments)

    if (!action) {
      return json(405, { error: 'Method not allowed' })
    }

    // Public reads don't require authentication
    if (action === 'profile:read:public' || action === 'profile:collection:read:public') {
      const store = createProfilesRepo(db)
      if (action === 'profile:read:public') {
        return handlePublicProfile(store, segments[1])
      }
      return handlePublicCollections(store, segments[1], kind)
    }

    // Authenticated routes
    const { user, error } = await enforce(req, action, {
      denyCode: 'DEMO_READONLY',
      denyMessage: 'The demo space is read-only. Sign in to manage your profile.',
    })
    if (error) return error

    const store = createProfilesRepo(db)

    if (action === 'profile:read:own') {
      return handleMyProfile(store, user)
    }

    if (action === 'profile:write') {
      const guardErr = await writeGuardError(req, user)
      if (guardErr) return guardErr
      const parsed = await readJsonBody(req)
      if (parsed.error) return parsed.error
      return handleUpsertProfile(store, user, parsed.value ?? {})
    }

    if (action === 'profile:delete') {
      return handleDeleteProfile(store, user)
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return safeError(err, req)
  }
}