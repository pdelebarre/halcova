// export.js — Self-serve member data export (GDPR portability, SEC-7.2.x #380).
//
// Two modes:
//   1. GET /export (with session token) — Authorize, gather the member's own
//      data (collection items, reviews, feedback, profile), store the export
//      payload in a temporary blob, and return a signed short-lived download
//      URL. The signed URL is the only way to retrieve the export data.
//   2. GET /export?token=<signed>       — Verify the signed token, read the
//      stored export payload, and serve it as a downloadable JSON file. No
//      session token required — the HMAC signature IS the authorization.
//
// Security properties:
//   - Authorization-before-signed-access: the signed token is only issued to a
//     live, authenticated session (enforce('export:mine')). The download path
//     verifies the HMAC signature, NOT the session.
//   - Owner-scoped: the exported data is exclusively the requesting member's
//     own data (collection items, reviews, feedback). Cross-user data is never
//     gathered.
//   - Short-lived: the signed URL expires in 5 minutes (configurable, hard-
//     capped at 10 minutes). An expired token returns 403 TOKEN_EXPIRED.
//   - Single-use: the export blob is deleted after the first successful download
//     (best-effort — the short TTL bounds the window regardless).
//   - Fail-closed: when EXPORT_SIGN_SECRET is not configured, the function
//     returns 503 — no export can be issued or consumed.
//   - Audit: every export request logs an AUDIT event.
//   - C12 credentials (code/code_hash/Stripe ids) are NEVER included in the
//     export payload — the user profile is stripped through publicUser().

import { getStore } from '@netlify/blobs'
import { logAudit } from './_shared/audit'
import { publicUser } from './_shared/auth'
import { enforce, forbidden } from './_shared/policy'
import { json, safeError } from './_shared/security'
import { securityHeaders } from './_shared/security'
import { storeNameFor } from './_shared/users'
import { COLLECTIONS, readIndex } from './_shared/collection-store'
import { createReviewsBlobStore } from './_shared/reviews-blob'
import { createFeedbackBlobStore } from './_shared/feedback-blob'
import {
  exportSignSecret,
  isExportSignConfigured,
  issueExportToken,
  verifyExportToken,
} from './_shared/export-sign'

const EXPORT_STORE = 'runout-export'
// The max age of an export blob before it is eligible for GC (5 min default).
// The signed-token TTL (EXPORT_SIGN_TTL_MS) is the authoritative bound — this
// is a best-effort cleanup window.
const EXPORT_BLOB_KEY_PREFIX = 'export:'

function exportBlobKey(userId) {
  return `${EXPORT_BLOB_KEY_PREFIX}${userId}`
}

// ---------------------------------------------------------------------------
// Mode 2: download via signed token
// ---------------------------------------------------------------------------
async function handleDownload(req, url) {
  const token = url.searchParams.get('token')
  if (!token) return json(400, { error: 'Missing token parameter.', code: 'MISSING_TOKEN' })

  const secret = exportSignSecret()
  if (!secret) {
    return json(503, {
      error: 'Export service is not configured. Please contact support.',
      code: 'EXPORT_NOT_CONFIGURED',
    })
  }

  const verified = verifyExportToken(token, { secret })
  if (!verified.ok) {
    if (verified.code === 'TOKEN_EXPIRED') {
      return json(403, { error: 'This download link has expired. Request a new export.', code: 'TOKEN_EXPIRED' })
    }
    return forbidden()
  }

  // Read the export blob for the verified user.
  const store = getStore(EXPORT_STORE)
  const data = await store.get(exportBlobKey(verified.userId), { type: 'json' })
  if (!data) {
    // The blob was already consumed or never existed — the token is single-use.
    return json(404, { error: 'Export data not found. It may have already been downloaded.', code: 'EXPORT_CONSUMED' })
  }

  // Best-effort single-use: delete the blob after reading. If the delete fails
  // the short TTL still bounds the window.
  try {
    await store.delete(exportBlobKey(verified.userId))
  } catch { /* best-effort */ }

  const body = JSON.stringify(data, null, 2)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="runout-export-${verified.userId}.json"`,
      'Content-Length': String(Buffer.byteLength(body, 'utf8')),
      ...securityHeaders(),
    },
  })
}

// ---------------------------------------------------------------------------
// Mode 1: authorized export request
// ---------------------------------------------------------------------------
async function handleRequestExport(req) {
  const secret = exportSignSecret()
  if (!secret) {
    return json(503, {
      error: 'Export service is not configured. Please contact support.',
      code: 'EXPORT_NOT_CONFIGURED',
    })
  }

  // SEC-7.1 (#338): route authorization through the shared policy layer.
  // The 'export:mine' action gates on owner: 'self' — the principal is always
  // the resolved session user, never a browser-supplied id.
  const { user, error } = await enforce(req, 'export:mine', {
    denyCode: 'DEMO_READONLY',
    denyMessage: 'Demo accounts cannot export data. Sign in with your own account.',
  })
  if (error) return error

  const userId = user.id

  // Gather the member's own data from all stores.
  const exportData = await gatherExportData(user)

  // Store the export payload in a temporary blob.
  const store = getStore(EXPORT_STORE)
  await store.setJSON(exportBlobKey(userId), exportData)

  // Issue a signed short-lived download token.
  const { signed, expiresAt } = issueExportToken({ userId, secret })

  // Audit the export request.
  logAudit('export.requested', { userId, role: user.role, expiresAt: new Date(expiresAt).toISOString() })

  return json(200, {
    url: `?token=${signed}`,
    expiresAt: new Date(expiresAt).toISOString(),
    expiresAtMs: expiresAt,
    message: 'Your export is ready. Use the URL below to download within the expiration window.',
  })
}

// ---------------------------------------------------------------------------
// Data gathering (scoped to the member's own data only)
// ---------------------------------------------------------------------------
async function gatherExportData(user) {
  const userId = user.id

  // 1. Collection items — all kinds, all fields (including private C3–C8).
  const collections = {}
  for (const kind of Object.keys(COLLECTIONS)) {
    try {
      const store = getStore(storeNameFor(userId, kind))
      const ids = await readIndex(store)
      const items = (await Promise.all(
        ids.map((itemId) => store.get(`item:${itemId}`, { type: 'json' })),
      )).filter(Boolean)
      if (items.length > 0) collections[kind] = items
    } catch { /* best-effort per collection */ }
  }

  // 2. Reviews — the member's own reviews across all releases.
  let reviews = []
  try {
    const reviewsStore = createReviewsBlobStore()
    // listAll() returns every review; filter to the member's own.
    const allReviews = await reviewsStore.listAll()
    reviews = allReviews.filter((r) => r.authorId === userId)
  } catch { /* best-effort */ }

  // 3. Feedback — the member's own feedback entries.
  let feedback = []
  try {
    const feedbackStore = createFeedbackBlobStore()
    const allFeedback = await feedbackStore.listFeedback()
    feedback = allFeedback.filter((f) => f.authorId === userId)
  } catch { /* best-effort */ }

  // 4. User profile — without C12 credentials (code/code_hash/Stripe ids).
  //    publicUser() strips the known secret fields.
  const profile = publicUser(user)

  return {
    exportedAt: new Date().toISOString(),
    userId,
    profile,
    collections,
    reviews,
    feedback,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export default async (req) => {
  try {
    const url = new URL(req.url)

    // Route: token present → download path; otherwise → authorized request path.
    if (url.searchParams.has('token')) {
      return handleDownload(req, url)
    }

    return handleRequestExport(req)
  } catch (err) {
    return safeError(err, req)
  }
}