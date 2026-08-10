// Admin API — only reachable with the admin key (RUNOUT_ADMIN_KEY), sent as
// `Authorization: Bearer <key>`. Handles the "accept new users" flow:
//   - list pending requests + members
//   - approve a request (grants Records and/or Books, returns the access code)
//   - reject a request
//   - change a member's collection access / disable them
//   - delete a member (and their collection stores)

import { randomUUID } from 'node:crypto'
import { ADMIN_KEY, OWNER_ID, bearer, generateAccessCode, publicUser } from './_shared/auth'
import {
  deleteUserCollections,
  getRequest,
  getUser,
  listRequests,
  listUsers,
  removeUserRecord,
  saveRequest,
  saveUser,
} from './_shared/users'

const json = (statusCode, body) => new Response(JSON.stringify(body), {
  status: statusCode,
  headers: { 'Content-Type': 'application/json' },
})

function sanitizeCollections(collections) {
  return {
    records: !!collections?.records,
    books: !!collections?.books,
  }
}

function hasAccess(collections) {
  return !!(collections && (collections.records || collections.books))
}

async function handleApprove(body) {
  if (!body.requestId) return json(400, { error: 'Missing requestId.' })
  const request = await getRequest(body.requestId)
  if (!request) return json(404, { error: 'Request not found.' })
  if (request.status !== 'pending') return json(409, { error: 'That request was already handled.' })

  const collections = sanitizeCollections(body.collections)
  if (!hasAccess(collections)) {
    return json(400, { error: 'Grant at least one collection (Records and/or Books).' })
  }

  const user = {
    id: randomUUID(),
    name: request.name,
    email: request.email,
    collections,
    code: generateAccessCode(),
    role: 'member',
    status: 'active',
    createdAt: new Date().toISOString(),
  }
  await saveUser(user)
  await saveRequest({ ...request, status: 'approved', approvedAt: new Date().toISOString() })

  return json(201, { user: publicUser(user), code: user.code })
}

async function handleReject(body) {
  if (!body.requestId) return json(400, { error: 'Missing requestId.' })
  const request = await getRequest(body.requestId)
  if (!request) return json(404, { error: 'Request not found.' })
  if (request.status !== 'pending') return json(409, { error: 'That request was already handled.' })
  await saveRequest({ ...request, status: 'rejected', rejectedAt: new Date().toISOString() })
  return json(200, { ok: true })
}

async function handleUpdateUser(body) {
  if (!body.userId) return json(400, { error: 'Missing userId.' })
  if (body.userId === OWNER_ID) return json(400, { error: 'The owner account cannot be edited here.' })
  const user = await getUser(body.userId)
  if (!user) return json(404, { error: 'User not found.' })

  if (body.collections) {
    const collections = sanitizeCollections(body.collections)
    if (!hasAccess(collections)) {
      return json(400, { error: 'A member needs at least one collection.' })
    }
    user.collections = collections
  }
  if (body.status === 'active' || body.status === 'disabled') user.status = body.status

  await saveUser(user)
  return json(200, { user: publicUser(user) })
}

async function handleDeleteUser(body) {
  if (!body.userId) return json(400, { error: 'Missing userId.' })
  if (body.userId === OWNER_ID) return json(400, { error: 'The owner account cannot be deleted.' })
  const user = await getUser(body.userId)
  if (!user) return json(404, { error: 'User not found.' })

  await removeUserRecord(user.id)
  await deleteUserCollections(user.id)
  return json(200, { ok: true })
}

export default async (req) => {
  try {
    if (bearer(req) !== ADMIN_KEY) {
      return json(401, { error: 'Admin key required. Set RUNOUT_ADMIN_KEY and sign in as the owner.' })
    }

    if (req.method === 'GET') {
      const [requests, users] = await Promise.all([listRequests(), listUsers()])
      return json(200, { requests, users })
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      switch (body.action) {
        case 'approve': return handleApprove(body)
        case 'reject': return handleReject(body)
        case 'updateUser': return handleUpdateUser(body)
        case 'deleteUser': return handleDeleteUser(body)
        default: return json(400, { error: 'Unknown action.' })
      }
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return json(500, { error: err.message || 'Internal error' })
  }
}
