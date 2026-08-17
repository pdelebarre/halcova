// Structured, secret-safe security audit events (SEC-6.4, #218) and the shared
// redaction helpers behind the secret/PII-safe logging policy (SEC-6.5, #219).
//
// Sink decision (SEC-6.4): we emit each event as ONE structured JSON line to
// the function log with a stable `AUDIT ` prefix — the pragmatic option at
// this scale. Netlify collects function logs per deploy and they're greppable /
// alertable (Logs → a deploy hook / external drain). We deliberately do NOT
// write audit events to Netlify Blobs: retention there is unmanaged and it
// would mix security signals into a user-data store; a structured log line is
// cheap, has no PII-retention cost, and is what a future SIEM drain would
// consume anyway. See docs/technical.md § 13.5 for the policy and
// docs/security-runbook.md for how `anomaly` events drive incident response.
//
// Security rules (non-negotiable):
//   - NEVER include access codes, session tokens, the admin key, Stripe
//     secrets, magic-link tokens, passwords, or PII (raw email / name) in an
//     event. Safe: user id, request id, event type, generic status, email-hash.
//   - `redactString` scrubs known secret patterns from any free-text value,
//     and `redactFields` DROPS secret-keyed fields entirely, so a caller can't
//     accidentally leak a field by naming it `token` / `code` / `secret`.

import { createHash } from 'node:crypto'

// Field names that are never allowed into an audit/log event — dropped by
// redactFields, whatever the value. Raw email/name are PII; log `emailHash`
// instead (callers add it explicitly).
const SECRET_KEYS = new Set([
  'code', 'codeHash', 'code_hash', 'token', 'session', 'sessionToken',
  'accessToken', 'adminKey', 'admin_key', 'apiKey', 'api_key', 'secret',
  'secretKey', 'webhookSecret', 'webhook_secret', 'password', 'authorization',
  'stripeSecretKey', 'stripeWebhookSecret', 'magicLink', 'magicLinkToken',
  'devLink', 'email', 'name', 'customer_email',
])

// Known secret-like patterns, scrubbed from any free-text string value before
// it is logged (defense in depth on top of the key-dropping above).
export function redactString(value) {
  const s = String(value)
  return s
    // Access codes: RU-XXXX-XXXX-XXXX (the member's sign-in credential).
    .replace(/\bRU-[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}\b/g, 'REDACTED_CODE')
    // Stripe secret / restricted keys.
    .replace(/\bsk_(?:test|live)_[A-Za-z0-9]+/g, 'REDACTED_STRIPE')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, 'REDACTED_STRIPE')
    .replace(/\brk_(?:test|live)_[A-Za-z0-9]+/g, 'REDACTED_STRIPE')
    // Bearer tokens (session tokens are ~43-char base64url).
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer REDACTED')
    // Any long opaque token-like value (session/magic-link/API tokens).
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, 'REDACTED_TOKEN')
    // Email addresses → redacted (PII).
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, 'REDACTED_EMAIL')
}

// Recursively redact a fields object for logging: drop secret-keyed fields,
// scrub free-text values, and collapse any user object to just its safe ids.
export function redactFields(fields = {}) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return typeof fields === 'string' ? redactString(fields) : fields
  }
  const out = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.has(key)) continue // drop the field entirely
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactFields(value)
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => (item && typeof item === 'object' ? redactFields(item) : (typeof item === 'string' ? redactString(item) : item)))
    } else {
      out[key] = typeof value === 'string' ? redactString(value) : value
    }
  }
  return out
}

// A sha256 hash of a normalized email — the ONLY email-derived value allowed
// in an audit event (never the raw address). Stable across calls so signals
// can be correlated server-side without logging PII.
export function emailHash(email) {
  const e = String(email || '').trim().toLowerCase()
  return e ? createHash('sha256').update(e).digest('hex') : undefined
}

// Emit one structured security audit event as a single JSON log line.
// `eventType` is a stable machine-readable string (e.g. 'auth.login_failed',
// 'admin.approve', 'webhook.invalid_signature', 'anomaly.auth_failure_burst').
// `fields` are redacted before logging — secrets and raw PII are impossible to
// leak through here by construction.
export function logAudit(eventType, fields = {}) {
  const event = {
    ts: new Date().toISOString(),
    type: eventType,
    ...redactFields(fields),
  }
  console.log(`AUDIT ${JSON.stringify(event)}`)
}

// Secret/PII-safe general logging helper (SEC-6.5, #219): every free-text
// value and extra field is redacted before it reaches the log. Use this instead
// of bare console.log/error anywhere a value might be untrusted.
export function safeLog(level, message, extra = {}) {
  const safe = redactString(message)
  const fields = redactFields(extra)
  const line = Object.keys(fields).length ? `${safe} ${JSON.stringify(fields)}` : safe
  if (level === 'error') console.error(`[${level}] ${line}`)
  else if (level === 'warn') console.warn(`[${level}] ${line}`)
  else console.log(`[${level}] ${line}`)
}
