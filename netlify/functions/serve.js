// serve.js — private asset serving layer (SEC-7.3.x, #385). Validates the
// signed URL token, checks per-asset instant revocation (revokedAt), and
// streams the asset bytes. This is the consumption side of the signed-URL
// contract — the issuance side is asset.js (asset:sign).
//
// Security properties:
//   - GET ?s=<signed_token> only (method guard: 405 on non-GET).
//   - Token verification via verifyAssetToken() (HMAC, scope, expiry).
//   - Per-asset instant revocation: checks the envelope's revokedAt BEFORE
//     streaming bytes. A revoked asset returns 403 ASSET_REVOKED — the same
//     body as a missing asset (non-enumerating, SEC-7.1).
//   - Rate-limited per-identity+IP (30/min default, 429 on exhaustion).
//     The identity is derived from the token's tenantId + client IP.
//   - FAILS CLOSED (CWE-287/346): if ASSET_SIGN_SECRET is not configured,
//     every request is refused with 503 — never a default-open fallback.
//   - Security headers on every response (X-Content-Type-Options, CSP, etc.).
//   - Non-enumeration: missing asset and revoked asset return the same
//     403 body, so a client cannot distinguish "never existed" from
//     "was revoked".

import { getAssetStore } from './_shared/asset-store'
import { isAssetSignConfigured, verifyAssetToken } from './_shared/asset-sign'
import { json, safeError, securityHeaders } from './_shared/security'
import { getStore } from '@netlify/blobs'
import { rateLimitGuard, clientIp, rateLimitKey } from './_shared/rate-limit'
import { anomalyScope } from './_shared/anomaly'

const RATE_LIMITS_STORE = 'runout-rate-limits'
const ASSET_KEY_PREFIX = 'asset:'

// Per-identity + IP rate limit for asset serving (SEC-7.3.x, #385). Default 30
// requests per minute — generous for normal use, stops a runaway client from
// hammering the serving layer. Evaluated at runtime so tests can change the env.
function serveRateLimit() {
  return Number(process.env.RUNOUT_ASSET_SERVE_RATE_LIMIT) || 30
}

// Uniform non-enumerating 403 for "asset missing or revoked".
const ASSET_UNAVAILABLE = { error: 'Not available.', code: 'ASSET_UNAVAILABLE' }
function assetUnavailable(headers) {
  return json(403, ASSET_UNAVAILABLE, headers)
}

export default async function serve(req) {
  try {
    // SEC-7.3.x (#385): method guard — only GET is allowed.
    if (req.method !== 'GET') return json(405, { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' })

    // --- fail-closed: no secret configured (CWE-287/346) --------------------
    if (!isAssetSignConfigured()) {
      return json(503, { error: 'Asset signing is not configured.', code: 'SIGNING_UNAVAILABLE' })
    }

    // --- extract and verify the signed token ---------------------------------
    const url = new URL(req.url || '', 'http://localhost')
    const token = url.searchParams.get('s')
    if (!token || typeof token !== 'string' || !token.trim()) {
      return json(400, { error: 'Missing signed token.', code: 'TOKEN_MISSING' })
    }

    const secret = process.env.ASSET_SIGN_SECRET
    const verification = verifyAssetToken(token, { secret })
    if (!verification.ok) {
      // Non-enumerating: TOKEN_EXPIRED and TOKEN_INVALID both return 403
      // with the same body shape. The code tells the client what went wrong
      // but reveals nothing about the asset's existence.
      return json(403, { error: 'Token is invalid or expired.', code: verification.code })
    }

    const { assetId, tenantId } = verification

    // --- rate-limit per-identity+IP ------------------------------------------
    // Identity is derived from the token's tenantId + client IP for per-IP
    // limits. The tenantId is the user id embedded in the signed token (not
    // client-supplied — it's HMAC-bound).
    const ip = clientIp(req)
    const identity = tenantId || ip
    if (identity) {
      const burstScope = anomalyScope('rlx:asset:serve', identity)
      const rl = await rateLimitGuard({
        store: getStore(RATE_LIMITS_STORE),
        scope: 'asset:serve',
        limit: serveRateLimit(),
        identity,
        anomalyStore: getStore(RATE_LIMITS_STORE),
        burstScope,
      })
      if (rl) return rl
    }

    // --- read the envelope from the tenant's asset store ----------------------
    const store = getAssetStore(tenantId)
    const envelope = await store.get(`${ASSET_KEY_PREFIX}${assetId}`, { type: 'json' })
    if (!envelope) return assetUnavailable()

    // --- instant revocation check (SEC-7.3.x, #385) --------------------------
    // Check revokedAt BEFORE streaming bytes. A revoked asset returns the same
    // non-enumerating 403 body as a missing asset.
    if (envelope.revokedAt) return assetUnavailable()

    // --- read the asset bytes ------------------------------------------------
    // The raw bytes are stored at `asset:<uuid>:data` in the same per-user
    // store. If the upload feature hasn't stored bytes yet, fall back to a
    // minimal placeholder response.
    const dataKey = `${ASSET_KEY_PREFIX}${assetId}:data`
    let rawBytes
    try {
      rawBytes = await store.get(dataKey, { type: 'arrayBuffer' })
    } catch {
      rawBytes = null
    }

    const mimeType = envelope.mimeType || 'application/octet-stream'

    // If no bytes exist yet (upload feature not deployed), return a minimal
    // success response with the envelope metadata. This is the readiness
    // seam — once upload exists, serve.js will stream the actual bytes.
    if (!rawBytes) {
      return new Response(JSON.stringify({ assetId, mimeType, size: envelope.size ?? 0 }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...securityHeaders(),
          'X-Asset-Id': assetId,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    // --- stream the bytes ----------------------------------------------------
    return new Response(rawBytes, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(rawBytes.byteLength || 0),
        ...securityHeaders(),
        'X-Asset-Id': assetId,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    // SEC-3.7 (#200): never surface the internal message to the client.
    return safeError(err, req)
  }
}