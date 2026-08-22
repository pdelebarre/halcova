// netlify/functions/moderation.js — Social Moderation, Privacy & Abuse Controls
// (FEAT-8.5, #330).
//
// Route surface:
//   Block/mute:
//     GET    /moderation/blocks          -> 200 { blocks: [...] }
//     POST   /moderation/blocks          body { blockedId, reason? } -> 201 { block }
//     DELETE /moderation/blocks?blockedId=... -> 204
//
//   Reports:
//     POST   /moderation/reports         body { targetType, targetId, reason } -> 201 { report }
//     GET    /moderation/reports         ?status=... (moderator) -> 200 { reports: [...] }
//     GET    /moderation/reports/:id     (moderator) -> 200 { report }
//     PATCH  /moderation/reports/:id     body { status?, actionTaken?, moderatorNote? } (moderator) -> 200 { report }
//
// Security:
//   - Blocked users are filtered server-side at the query/display layer.
//   - Reports are private and auditable.
//   - Comment/post creation is rate-limited.
//   - Moderators have least-privilege permissions (separate from admin).
//   - Abuse actions are logged without storing unnecessary sensitive content.
//   - Structured JSON logging, no sensitive PII in logs.

import { getStore } from '@netlify/blobs'
import { json } from './_shared/collection-store'
import { enforce, forbidden } from './_shared/policy'
import { rateLimitGuard, rateLimitIdentity } from './_shared/rate-limit'
import { isPostgresConfigured, db } from './_shared/postgres'
import { createBlocksRepo } from './_shared/repositories/blocks-repo'
import { createReportsRepo } from './_shared/repositories/reports-repo'
import { readJsonBody, safeError, str, check } from './_shared/security'
import { logAudit } from './_shared/audit'

const RATE_LIMITS_STORE = 'runout-rate-limits'
const BLOCKS_RATE_LIMIT = Number(process.env.RUNOUT_BLOCKS_RATE_LIMIT) || 20
const REPORTS_RATE_LIMIT = Number(process.env.RUNOUT_REPORTS_RATE_LIMIT) || 10

// Allowed target types for reports.
const TARGET_TYPES = new Set(['profile', 'item', 'review', 'comment'])

// Parse the URL to extract path segments and report id.
function parseUrl(req) {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/\.netlify\/functions\/moderation/, '')
  const segments = path.split('/').filter(Boolean)
  const params = Object.fromEntries(url.searchParams.entries())
  return { segments, params }
}

// Map the HTTP method + path to the policy action.
function actionFor(req, segments) {
  const method = req.method
  const resource = segments[0] // 'blocks' or 'reports'

  if (resource === 'blocks') {
    if (method === 'GET') return 'block:list'
    if (method === 'POST') return 'block:create'
    if (method === 'DELETE') return 'block:delete'
  }
  if (resource === 'reports') {
    if (method === 'POST' && segments.length === 1) return 'report:create'
    if (method === 'GET' && segments.length === 1) return 'report:list'
    if (method === 'GET' && segments.length === 2) return 'report:read'
    if (method === 'PATCH' && segments.length === 2) return 'report:moderate'
  }
  return null
}

// ---------------------------------------------------------------------------
// Block handlers
// ---------------------------------------------------------------------------

async function handleListBlocks(blocksRepo, user) {
  const blocks = await blocksRepo.listBlocked(user.id)
  return json(200, { blocks })
}

async function handleCreateBlock(blocksRepo, user, body) {
  const blockedId = str(body?.blockedId, { required: true })
  const reason = str(body?.reason, { max: 500 })
  const err = check(blockedId)
  if (err) return json(400, { error: err.message, code: err.code })

  if (blockedId.value === user.id) {
    return json(400, { error: 'Cannot block yourself.', code: 'SELF_BLOCK' })
  }

  const block = await blocksRepo.createBlock(user.id, blockedId.value, reason.value)
  if (!block) return json(400, { error: 'Could not create block.', code: 'BLOCK_FAILED' })

  logAudit('block.created', { blockerId: user.id, blockedId: blockedId.value })
  return json(201, { block })
}

async function handleDeleteBlock(blocksRepo, user, params) {
  const blockedId = params.blockedId
  if (!blockedId) return json(400, { error: 'Missing blockedId', code: 'MISSING_BLOCKED_ID' })
  const ok = await blocksRepo.deleteBlock(user.id, blockedId)
  if (!ok) return json(404, { error: 'Not found' })
  logAudit('block.deleted', { blockerId: user.id, blockedId })
  return new Response(null, { status: 204 })
}

// ---------------------------------------------------------------------------
// Report handlers
// ---------------------------------------------------------------------------

async function handleCreateReport(reportsRepo, user, body) {
  const targetType = str(body?.targetType, { required: true })
  const targetId = str(body?.targetId, { required: true })
  const reason = str(body?.reason, { required: true, max: 2000 })
  const err = check(targetType, targetId, reason)
  if (err) return json(400, { error: err.message, code: err.code })

  if (!TARGET_TYPES.has(targetType.value)) {
    return json(400, { error: 'Unknown target type.', code: 'INVALID_TARGET_TYPE' })
  }

  const report = await reportsRepo.createReport({
    reporterId: user.id,
    targetType: targetType.value,
    targetId: targetId.value,
    reason: reason.value,
  })
  if (!report) return json(400, { error: 'Could not create report.', code: 'REPORT_FAILED' })

  logAudit('report.created', { reportId: report.id, targetType: targetType.value })
  return json(201, { report })
}

async function handleListReports(reportsRepo, params) {
  const reports = await reportsRepo.listReports({
    status: params.status || undefined,
  })
  return json(200, { reports })
}

async function handleGetReport(reportsRepo, id) {
  if (!id) return json(400, { error: 'Missing report id', code: 'MISSING_ID' })
  const report = await reportsRepo.getReport(id)
  if (!report) return json(404, { error: 'Not found' })
  return json(200, { report })
}

async function handleModerateReport(reportsRepo, id, body, user) {
  if (!id) return json(400, { error: 'Missing report id', code: 'MISSING_ID' })
  const report = await reportsRepo.moderateReport(id, {
    status: body?.status,
    actionTaken: body?.actionTaken,
    moderatorId: user.id,
    moderatorNote: body?.moderatorNote,
  })
  if (!report) return json(404, { error: 'Not found or already resolved' })
  logAudit('report.moderated', { reportId: id, status: report.status, actionTaken: report.actionTaken, moderatorId: user.id })
  return json(200, { report })
}

// ---------------------------------------------------------------------------
// Rate-limit guards
// ---------------------------------------------------------------------------

async function writeGuardError(req, user, scope) {
  const identity = rateLimitIdentity(user, req)
  if (!identity) return null
  const rl = await rateLimitGuard({
    store: getStore(RATE_LIMITS_STORE),
    scope: `moderation:${scope}`,
    limit: scope === 'reports' ? REPORTS_RATE_LIMIT : BLOCKS_RATE_LIMIT,
    identity,
    anomalyStore: getStore(RATE_LIMITS_STORE),
  })
  return rl
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default async function moderationHandler(req) {
  try {
    const { segments, params } = parseUrl(req)
    const action = actionFor(req, segments)

    if (!action) {
      return json(405, { error: 'Method not allowed' })
    }

    const resource = segments[0]
    const isModeratorAction = action === 'report:list' || action === 'report:read' || action === 'report:moderate'

    // Authenticate
    const { user, error } = await enforce(req, action, {
      denyCode: 'DEMO_READONLY',
      denyMessage: 'The demo space is read-only. Sign in to use moderation features.',
    })
    if (error) return error

    const blocksRepo = createBlocksRepo(db)
    const reportsRepo = createReportsRepo(db)

    // Block routes
    if (resource === 'blocks') {
      if (req.method === 'GET') return handleListBlocks(blocksRepo, user)
      if (req.method === 'POST') {
        const guardErr = await writeGuardError(req, user, 'blocks')
        if (guardErr) return guardErr
        const parsed = await readJsonBody(req)
        if (parsed.error) return parsed.error
        return handleCreateBlock(blocksRepo, user, parsed.value ?? {})
      }
      if (req.method === 'DELETE') return handleDeleteBlock(blocksRepo, user, params)
    }

    // Report routes
    if (resource === 'reports') {
      if (req.method === 'POST') {
        const guardErr = await writeGuardError(req, user, 'reports')
        if (guardErr) return guardErr
        const parsed = await readJsonBody(req)
        if (parsed.error) return parsed.error
        return handleCreateReport(reportsRepo, user, parsed.value ?? {})
      }
      if (req.method === 'GET' && segments.length === 1) {
        return handleListReports(reportsRepo, params)
      }
      if (req.method === 'GET' && segments.length === 2) {
        return handleGetReport(reportsRepo, segments[1])
      }
      if (req.method === 'PATCH' && segments.length === 2) {
        const parsed = await readJsonBody(req)
        if (parsed.error) return parsed.error
        return handleModerateReport(reportsRepo, segments[1], parsed.value ?? {}, user)
      }
    }

    return json(405, { error: 'Method not allowed' })
  } catch (err) {
    return safeError(err, req)
  }
}