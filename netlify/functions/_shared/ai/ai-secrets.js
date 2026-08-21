// ai-secrets.js — server-side secret protection for AI provider credentials
// (ADMIN-3.2, #304, epic #302).
//
// The admin stores an LLM provider apiKey (and any other secret) with the
// profile, but it is NEVER persisted as plaintext. It is encrypted at rest
// with AES-256-GCM under a server-side key derived from the
// `RUNOUT_AI_SECRET_KEY` environment variable, and only ever decrypted in
// memory when a connection test or a real call needs it (constructor-injected,
// matching #303's provider.js contract: "credential storage/retrieval is
// #304's job, and the adapter receives its apiKey via constructor injection
// only").
//
// Security rules (non-negotiable):
//   - Plaintext secrets are never written to storage — only the ciphertext
//     payload (iv + auth tag + encrypted bytes, base64).
//   - Without `RUNOUT_AI_SECRET_KEY` configured, `encryptSecret` FAILS rather
//     than persisting a weakly-protected secret — we never degrade to a
//     hard-coded key.
//   - `decryptSecret` surfaces a tampered/forged payload as a thrown error
//     (GCM auth tag) — a corrupt or forged blob never yields plaintext.
//   - `maskSecret` renders a value for the UI showing only the tail; the full
//     secret is never returned by any read path (see ai-admin.js).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const AI_SECRET_KEY_ENV = 'RUNOUT_AI_SECRET_KEY'
const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16

// Derive the 32-byte AES key from the env secret. Returns null (not a weak
// default) when the env var is absent — callers must fail rather than persist
// a secret they cannot protect.
export function secretKeyFromEnv(env = process.env) {
  const raw = env && env[AI_SECRET_KEY_ENV]
  if (!raw || String(raw).trim() === '') return null
  return createHash('sha256').update(String(raw)).digest()
}

// Encrypt a plaintext secret into a single base64 payload
// (iv | authTag | ciphertext). Throws when no key is configured or the input
// is not a non-empty string — never write an empty/unprotected secret.
export function encryptSecret(plaintext, key = secretKeyFromEnv()) {
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new Error('A non-empty secret value is required.')
  }
  if (!key) {
    throw new Error(`AI secret key not configured (${AI_SECRET_KEY_ENV}).`)
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

// Decrypt a base64 payload back to plaintext. GCM authenticates the payload,
// so a tampered/forged blob throws (never yields plaintext). Throws when the
// key is absent or the payload is malformed.
export function decryptSecret(payload, key = secretKeyFromEnv()) {
  if (!key) {
    throw new Error(`AI secret key not configured (${AI_SECRET_KEY_ENV}).`)
  }
  let buf
  try {
    buf = Buffer.from(String(payload), 'base64')
  } catch {
    throw new Error('Invalid secret payload.')
  }
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Invalid secret payload.')
  }
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const data = buf.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

// Render a secret for display, showing only the last `showTail` characters.
// Never returns the full value; an empty value renders as an empty string so
// the UI can distinguish "no secret set" from a masked one.
export function maskSecret(value, { showTail = 4 } = {}) {
  if (!value || typeof value !== 'string' || value === '') return ''
  if (value.length <= showTail + 1) return '••••••'
  return `••••••${value.slice(-showTail)}`
}
