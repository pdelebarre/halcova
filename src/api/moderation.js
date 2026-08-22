import { getSessionToken } from '../utils/session'

// Client for the moderation Netlify function (FEAT-8.5, #330).
// Mirrors src/api/reviews.js conventions.

const FN_BASE = '/.netlify/functions/moderation'

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

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

// GET /moderation/blocks — list all users blocked by the caller
export async function listBlocks() {
  const res = await fetch(`${FN_BASE}/blocks`, { headers: authHeaders() })
  const data = await handle(res)
  return Array.isArray(data.blocks) ? data.blocks : []
}

// POST /moderation/blocks — block a user
export async function createBlock(blockedId, reason = '') {
  const res = await fetch(`${FN_BASE}/blocks`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ blockedId, reason }),
  })
  const data = await handle(res)
  return data.block
}

// DELETE /moderation/blocks?blockedId=... — unblock a user
export async function deleteBlock(blockedId) {
  const res = await fetch(`${FN_BASE}/blocks?blockedId=${encodeURIComponent(blockedId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return true
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

// POST /moderation/reports — report content
export async function createReport(targetType, targetId, reason) {
  const res = await fetch(`${FN_BASE}/reports`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType, targetId, reason }),
  })
  const data = await handle(res)
  return data.report
}

// GET /moderation/reports — list reports (moderator only)
export async function listReports(status) {
  const params = status ? `?status=${encodeURIComponent(status)}` : ''
  const res = await fetch(`${FN_BASE}/reports${params}`, { headers: authHeaders() })
  const data = await handle(res)
  return Array.isArray(data.reports) ? data.reports : []
}

// GET /moderation/reports/:id — get a single report (moderator only)
export async function getReport(id) {
  const res = await fetch(`${FN_BASE}/reports/${encodeURIComponent(id)}`, { headers: authHeaders() })
  const data = await handle(res)
  return data.report || null
}

// PATCH /moderation/reports/:id — moderate a report (moderator only)
export async function moderateReport(id, { status, actionTaken, moderatorNote } = {}) {
  const res = await fetch(`${FN_BASE}/reports/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, actionTaken, moderatorNote }),
  })
  const data = await handle(res)
  return data.report
}