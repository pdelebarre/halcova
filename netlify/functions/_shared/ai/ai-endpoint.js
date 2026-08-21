// ai-endpoint.js — SSRF-safe AI provider endpoint (base URL) validation
// (ADMIN-3.2, #304, epic #302).
//
// The owner configures an OpenAI-compatible base URL at runtime. A
// user-configurable URL is a real SSRF surface (the server fetches it to run a
// connection test / health check / completion), so activation and every test
// path MUST reject an unsafe endpoint BEFORE the server ever fetches it. This
// module is the single gate; admin.js runs it on create/update/test/activate.
//
// Enforced, fail-closed:
//   - HTTPS only (a plaintext endpoint could leak the credential).
//   - The host must be a public DNS hostname — IP-literal targets (v4/v6),
//     localhost, private, link-local, CGNAT, reserved and loopback ranges are
//     all rejected. A DNS name is still resolved at fetch time by the
//     OpenAIProvider, which additionally never follows redirects (#303).
//   - Optional `RUNOUT_AI_ENDPOINT_ALLOWLIST` (comma-separated host suffixes):
//     when set, only matching hosts are permitted (defense in depth for a
//     locked-down deployment).

const HOSTNAME_RE = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(?:\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/

export const AI_ENDPOINT_ALLOWLIST_ENV = 'RUNOUT_AI_ENDPOINT_ALLOWLIST'

function endpointHost(raw) {
  try {
    const u = new URL(String(raw))
    if (u.protocol !== 'https:') return null
    return u.hostname.toLowerCase()
  } catch {
    return null
  }
}

function isIpv4Literal(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
}

function isReservedIpv6(host) {
  if (host === '::' || host === '::1') return true
  if (host === '::ffff:127.0.0.1') return true
  return /^fe80:/i.test(host) // link-local
    || /^fc/i.test(host) || /^fd/i.test(host) // ULA fc00::/7
    || /^ff/i.test(host) // multicast
}

// Reserved/non-public hostnames (localhost + mDNS/local-suffix names resolve
// to loopback/link-local and are never legitimate external LLM endpoints).
const RESERVED_HOSTNAME_RE = /(^|\.)localhost$/i
const LOCAL_SUFFIX_RE = /(^|\.)(local|localdomain|internal|home|lan|localdomain)$/i

function isReservedHostname(host) {
  return RESERVED_HOSTNAME_RE.test(host) || LOCAL_SUFFIX_RE.test(host)
}

function allowlistMatches(host, allowlist) {
  if (!allowlist || allowlist.length === 0) return true
  return allowlist.some((h) => h === host || host.endsWith(`.${h}`))
}

// Parse the host allowlist from the environment (comma-separated host suffixes,
// lowercased, trimmed, empties dropped). Shared by the config-time gate and the
// OpenAIProvider's fetch-time defense-in-depth check.
export function endpointAllowlistFromEnv(env = process.env) {
  return String(env[AI_ENDPOINT_ALLOWLIST_ENV] || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
}

// Validate a base URL for the AI provider. Returns
//   { value: <normalizedUrl> } on success, or
//   { error: { code, message } } fail-closed.
export function validateAiEndpoint(raw, env = process.env) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { error: { code: 'INVALID_ENDPOINT', message: 'A base URL is required.' } }
  }
  const s = raw.trim().replace(/\/+$/, '')
  const host = endpointHost(s)
  if (!host) {
    return { error: { code: 'INSECURE_ENDPOINT', message: 'Only HTTPS endpoints are allowed.' } }
  }
  if (isIpv4Literal(host) || isReservedIpv6(host) || isReservedHostname(host)) {
    return { error: { code: 'UNSAFE_ENDPOINT', message: 'That endpoint host is not allowed.' } }
  }
  if (!HOSTNAME_RE.test(host)) {
    return { error: { code: 'UNSAFE_ENDPOINT', message: 'That endpoint host is not a valid public hostname.' } }
  }
  const allowlist = endpointAllowlistFromEnv(env)
  if (!allowlistMatches(host, allowlist)) {
    return { error: { code: 'ENDPOINT_NOT_ALLOWED', message: 'That endpoint host is not allowlisted.' } }
  }
  return { value: s }
}
