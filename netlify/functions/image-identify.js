// image-identify.js — AI Image Recognition for Collection Capture
// (FEAT-9.5, #336, epic #331).
//
// Flow: user uploads photo → server saves to Blobs → mints signed URL with
// short TTL → sends to AI provider → returns identification suggestions.
//
// Actions (POST; Authorization: Bearer <sessionToken>):
//   identify  { action: 'identify', image: <base64>, hints?: { collectionType? } }
//             -> 200 { candidates: [{ title, confidence, providerId?, source }] }
//
// Security (ADR-0021 §2.5, ADR-0006):
//   - Image URLs are server-signed, time-bounded (5 min TTL), and scoped to
//     the authenticated user.
//   - The image is never stored or cached by the AI provider.
//   - The model receives only the image data and public reference metadata —
//     never private collection context.
//   - AI suggests only (no auto-add): candidates require user confirmation.
//   - XSS-safe rendering: all returned string values are schema-validated.
//   - Server-authoritative ownership: the asset store is resolved from the
//     SESSION user.id, never a client-supplied owner id.
//   - Rate-limited per-identity+IP (SEC-7.3.x, #385).
//   - FAILS CLOSED (CWE-287/346): if ASSET_SIGN_SECRET is not configured,
//     identify refuses with 503 — never a default-open URL.
//
// Dependencies:
//   - #385 asset signing (asset-sign.js, asset-store.js)
//   - #303 AI provider abstraction (provider.js, capabilities.js, openai.js)
//   - #321 scan flow (ScannerModal.jsx, ScanResult.jsx)

import { randomUUID } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { getAssetStore, setAsset } from './_shared/asset-store'
import { isAssetSignConfigured, issueAssetToken, signAssetToken, ACCEPTED_ASSET_TYPES, RUNOUT_ASSET_MAX_BYTES } from './_shared/asset-sign'
import { enforce, forbidden } from './_shared/policy'
import { json, readJsonBody, safeError } from './_shared/security'
import { rateLimitGuard, rateLimitIdentity } from './_shared/rate-limit'
import { anomalyScope } from './_shared/anomaly'
import { identifyFromImage } from './_shared/ai/tools'
import { buildProvider, getProfileSecret } from './_shared/ai/ai-admin'
import { createAiConfigRepo } from './_shared/ai/ai-config-repo'
import { createAiConfigBlobStore } from './_shared/ai/ai-config-blob'
import { isPostgresConfigured, db } from './_shared/postgres'

const RATE_LIMITS_STORE = 'runout-rate-limits'
const AI_CONFIG_STORE = 'runout-ai-config'

// Per-identity + IP rate limit for image-identify (SEC-7.3.x, #385).
// Default 10 per minute — generous for normal use, stops a runaway client.
function identifyRateLimit() {
  return Number(process.env.RUNOUT_IMAGE_IDENTIFY_RATE_LIMIT) || 10
}

// Max image payload size (5 MB default, same as RUNOUT_ASSET_MAX_BYTES).
const MAX_IMAGE_BYTES = RUNOUT_ASSET_MAX_BYTES

// Signed URL TTL for AI image recognition: 5 minutes per ADR-0021 §2.5.
// This is tighter than the default asset-sign TTL (10 min) because the AI
// provider only needs a brief window to fetch the image.
const AI_IMAGE_TTL_MS = 5 * 60 * 1000

// Accepted image content types for AI identification.
const ACCEPTED_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
])

function backend() {
  if (isPostgresConfigured()) return createAiConfigRepo(db)
  return createAiConfigBlobStore({ store: getStore(AI_CONFIG_STORE) })
}

// Get the active provider profile (the one with active=true).
async function getActiveProfile() {
  const repo = backend()
  const profiles = await repo.listProfiles()
  return profiles.find((p) => p.active) || null
}

// Read + validate the JSON body (256 KB cap — an image in base64 can be large).
async function readBody(req) {
  const parsed = await readJsonBody(req, { maxBytes: MAX_IMAGE_BYTES + 64 * 1024 })
  if (parsed.error) return parsed
  return parsed.value ?? {}
}

function validateAction(body) {
  const { action } = body
  if (action !== 'identify') {
    return json(400, { error: 'Unknown action.', code: 'UNKNOWN_ACTION' })
  }
  return null
}

// Validate the image payload: must be a base64 string, within size limits,
// and match an accepted content type.
function validateImage(body) {
  const { image, mimeType } = body

  if (typeof image !== 'string' || image.trim().length === 0) {
    return json(400, { error: 'Image data is required.', code: 'IMAGE_REQUIRED' })
  }

  // Validate mimeType against accepted types
  const mt = typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : 'image/jpeg'
  if (!ACCEPTED_IMAGE_TYPES.includes(mt)) {
    return json(400, { error: 'Unsupported image type. Accepted: JPEG, PNG, WebP.', code: 'UNSUPPORTED_IMAGE_TYPE' })
  }

  // Decode base64 to check size
  let raw
  try {
    raw = Buffer.from(image, 'base64')
  } catch {
    return json(400, { error: 'Invalid image encoding.', code: 'INVALID_ENCODING' })
  }

  if (raw.length === 0) {
    return json(400, { error: 'Image data is empty.', code: 'EMPTY_IMAGE' })
  }

  if (raw.length > MAX_IMAGE_BYTES) {
    return json(413, { error: 'Image too large.', code: 'IMAGE_TOO_LARGE' })
  }

  return null
}

// Validate optional hints
function validateHints(body) {
  const { hints } = body
  if (hints === undefined || hints === null) return null
  if (typeof hints !== 'object' || Array.isArray(hints)) {
    return json(400, { error: 'Hints must be an object.', code: 'INVALID_HINTS' })
  }
  if (hints.collectionType !== undefined && typeof hints.collectionType !== 'string') {
    return json(400, { error: 'collectionType must be a string.', code: 'INVALID_HINTS' })
  }
  return null
}

export default async function imageIdentify(req) {
  try {
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

    const body = await readBody(req)
    if (body.error) return body.error

    const invalid = validateAction(body)
    if (invalid) return invalid

    const imageErr = validateImage(body)
    if (imageErr) return imageErr

    const hintsErr = validateHints(body)
    if (hintsErr) return hintsErr

    return await identifyAction(req, body)
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}

// image:identify — authenticated, rate-limited, server-authoritative.
async function identifyAction(req, body) {
  const auth = await enforce(req, 'asset:sign')
  if (auth.error) return auth.error
  const user = auth.user

  // Rate-limit per-identity+IP (SEC-7.3.x, #385).
  const identity = rateLimitIdentity(user, req)
  if (identity) {
    const burstScope = user.role === 'demo' ? anomalyScope('rlx:image:identify', identity) : undefined
    const rl = await rateLimitGuard({
      store: getStore(RATE_LIMITS_STORE),
      scope: 'image:identify',
      limit: identifyRateLimit(),
      identity,
      anomalyStore: getStore(RATE_LIMITS_STORE),
      burstScope,
    })
    if (rl) return rl
  }

  // 1. Save the image to the user's private asset store.
  const assetId = randomUUID()
  const raw = Buffer.from(body.image, 'base64')
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : 'image/jpeg'

  await setAsset(user.id, `asset:${assetId}`, new Uint8Array(raw), { contentType: mimeType })

  // Also store the envelope metadata so the asset endpoint can serve it.
  const store = getAssetStore(user.id)
  await store.setJSON(`asset:${assetId}`, {
    assetId,
    ownerId: user.id,
    mimeType,
    size: raw.length,
    createdAt: new Date().toISOString(),
  })

  // 2. Mint a signed URL with short TTL (5 min per ADR-0021 §2.5).
  if (!isAssetSignConfigured()) {
    return json(503, { error: 'Asset signing is not configured.', code: 'SIGNING_UNAVAILABLE' })
  }
  const secret = process.env.ASSET_SIGN_SECRET
  const expiresAt = Date.now() + AI_IMAGE_TTL_MS
  const { signed } = issueAssetToken({
    assetId,
    tenantId: user.id,
    secret,
    now: Date.now(),
  })
  // Override the default TTL with the tighter AI image TTL.
  // issueAssetToken uses assetSignTtlMs() which defaults to 10 min.
  // We sign with our own expiry.
  const aiSigned = signAssetToken({ assetId, tenantId: user.id, expiresAt, secret })

  // 3. Get the active AI provider.
  const activeProfile = await getActiveProfile()
  if (!activeProfile) {
    return json(503, { error: 'No active AI provider is configured.', code: 'AI_UNAVAILABLE' })
  }

  const apiKey = await getProfileSecret(activeProfile.id)
  if (!apiKey) {
    return json(503, { error: 'Active AI provider has no API key configured.', code: 'AI_UNAVAILABLE' })
  }

  const provider = buildProvider(activeProfile, apiKey)
  if (!provider) {
    return json(503, { error: 'Could not build AI provider from configuration.', code: 'AI_UNAVAILABLE' })
  }

  // 4. Call the AI provider via the identifyFromImage tool.
  const hints = body.hints && typeof body.hints === 'object' ? body.hints : undefined
  try {
    const result = await identifyFromImage(provider, {
      imageUrl: aiSigned,
      hints,
    })

    // 5. Return the identification suggestions.
    // AI suggests only (no auto-add): candidates require user confirmation.
    return json(200, {
      candidates: result.candidates,
      assetId,
      expiresAt,
    })
  } catch (err) {
    // Provider errors (timeout, rate-limit, invalid output) are safe to surface
    // as they contain no sensitive data — only stable error codes.
    const code = err?.code || 'PROVIDER_FAILURE'
    return json(502, {
      error: 'Image identification failed.',
      code,
    })
  }
}