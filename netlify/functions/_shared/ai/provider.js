// provider.js — provider-neutral LLM contract (ADMIN-3.1, #303, epic #302).
//
// This is the FOUNDATIONAL AI ticket. It defines the server-side provider
// interface that every LLM adapter implements, the bounded request options that
// every call must respect, and the typed error surface that callers (the
// capability layer, then #304 config and #305 feedback intelligence) rely on.
//
// Security boundary (ADR-0006): provider output is UNTRUSTED. The adapter must
// schema-validate every structured response and reject malformed/oversized
// output fail-closed. This module carries NO credentials and performs NO
// browser-side calls — credential storage/retrieval is #304's job, and the
// adapter receives its apiKey via constructor injection only.
//
// Contract stability: #304 (secure LLM config storage) and #305 (feedback
// intelligence) consume this interface. Do not rename the exported symbols or
// change the error codes without a coordinated change.

// ---------------------------------------------------------------------------
// Error taxonomy.
//
// Every provider failure surfaces as a ProviderError with a stable `code` so
// the capability layer and downstream consumers can map to a safe outcome
// without depending on a vendor's message text. `retryable` tells the caller
// whether a bounded retry is worth attempting.
// ---------------------------------------------------------------------------
export const ProviderErrorCode = Object.freeze({
  // The provider did not respond within the bounded timeout.
  TIMEOUT: 'PROVIDER_TIMEOUT',
  // The provider returned 429 (rate limited) and retries were exhausted.
  RATE_LIMIT: 'PROVIDER_RATE_LIMIT',
  // A transient provider failure (5xx / network) that retries did not clear.
  FAILURE: 'PROVIDER_FAILURE',
  // The provider returned a body that is not valid JSON / not the expected
  // shape. Fail-closed: never trust unvalidated model output.
  INVALID_OUTPUT: 'PROVIDER_INVALID_OUTPUT',
  // The provider returned a body larger than the bounded response-size cap.
  OVERSIZED_OUTPUT: 'PROVIDER_OVERSIZED_OUTPUT',
  // The provider rejected the configured credential (401/403).
  AUTH: 'PROVIDER_AUTH',
  // The provider rejected the request as malformed (400) — a caller bug.
  BAD_REQUEST: 'PROVIDER_BAD_REQUEST',
  // The provider does not support the requested capability/model.
  UNSUPPORTED: 'PROVIDER_UNSUPPORTED',
  // The configured base-URL host is not on the provider's host allowlist
  // (SSRF control, ADR-0006). Fail-closed before any fetch.
  ENDPOINT_NOT_ALLOWED: 'PROVIDER_ENDPOINT_NOT_ALLOWED',
})

export class ProviderError extends Error {
  constructor(code, message, { retryable = false, cause } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.retryable = retryable
    this.cause = cause
  }
}

// ---------------------------------------------------------------------------
// Bounded request options.
//
// Every provider call is bounded: a timeout, a response-size cap, a bounded
// retry budget, and a bounded token ceiling. These defaults are the floor; an
// adapter may tighten them per capability but never loosen them past the
// caller-supplied bounds.
// ---------------------------------------------------------------------------
export const DEFAULT_TIMEOUT_MS = 15_000
export const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024
export const DEFAULT_RETRIES = 2 // 3 attempts total
export const DEFAULT_MAX_TOKENS = 2048

export const DEFAULT_REQUEST_OPTIONS = Object.freeze({
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
  retries: DEFAULT_RETRIES,
  maxTokens: DEFAULT_MAX_TOKENS,
  temperature: 0,
})

// Clamp a caller-supplied option into a safe bounded range. Never lets a
// caller disable a bound (e.g. a 0 timeout or an unbounded response cap).
export function boundedOptions(overrides = {}) {
  const timeoutMs = Number.isFinite(overrides.timeoutMs) && overrides.timeoutMs > 0
    ? Math.min(overrides.timeoutMs, DEFAULT_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS
  const maxResponseBytes = Number.isFinite(overrides.maxResponseBytes) && overrides.maxResponseBytes > 0
    ? Math.min(overrides.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES)
    : DEFAULT_MAX_RESPONSE_BYTES
  const retries = Number.isInteger(overrides.retries) && overrides.retries >= 0
    ? Math.min(overrides.retries, DEFAULT_RETRIES)
    : DEFAULT_RETRIES
  const maxTokens = Number.isInteger(overrides.maxTokens) && overrides.maxTokens > 0
    ? Math.min(overrides.maxTokens, DEFAULT_MAX_TOKENS)
    : DEFAULT_MAX_TOKENS
  const temperature = Number.isFinite(overrides.temperature)
    ? Math.min(Math.max(overrides.temperature, 0), 2)
    : 0
  return { timeoutMs, maxResponseBytes, retries, maxTokens, temperature }
}

// Merge per-call overrides onto a base (constructor) options object. Only the
// fields the caller actually provided are applied, each clamped into its safe
// bounded range — so a per-call override can tighten a bound but never loosen
// the constructor's configured bound back to a default.
export function mergeOptions(base = {}, overrides = {}) {
  const merged = { ...base }
  const clamped = boundedOptions(overrides)
  for (const key of ['timeoutMs', 'maxResponseBytes', 'retries', 'maxTokens', 'temperature']) {
    // Apply an override only when it is a real finite number — a junk override
    // (NaN / Infinity / string) must never clobber the configured base bound.
    if (overrides[key] !== undefined && Number.isFinite(overrides[key])) {
      merged[key] = clamped[key]
    }
  }
  return merged
}

// ---------------------------------------------------------------------------
// Provider interface (abstract base).
//
// Adapters extend this and implement `complete` and `health`. `modelMetadata`
// and `supports` have default implementations derived from the constructor
// config. The base class deliberately throws on the abstract methods so a
// half-implemented adapter fails loudly rather than silently degrading.
// ---------------------------------------------------------------------------
export class Provider {
  constructor({ name, model, capabilities = [], options = {} } = {}) {
    this.name = name
    this.model = model
    this.capabilities = new Set(capabilities)
    this.options = { ...DEFAULT_REQUEST_OPTIONS, ...boundedOptions(options) }
  }

  // Run a structured completion. `request` is a ProviderRequest:
  //   { system?, user, schema, options? }
  // Returns a ProviderResult: { content, model, usage? } where `content` is
  // the schema-validated parsed JSON value. Throws ProviderError on any
  // failure (timeout / rate limit / provider failure / invalid output).
  async complete(_request) {
    throw new ProviderError(ProviderErrorCode.UNSUPPORTED, `${this.name} does not implement complete()`)
  }

  // Health check. Returns { ok: true, latencyMs } or throws ProviderError.
  async health() {
    throw new ProviderError(ProviderErrorCode.UNSUPPORTED, `${this.name} does not implement health()`)
  }

  // Model metadata: the configured model id, the provider name, and the
  // capabilities it advertises. Never includes credentials.
  modelMetadata() {
    return {
      provider: this.name,
      model: this.model,
      capabilities: [...this.capabilities],
    }
  }

  supports(capability) {
    return this.capabilities.has(capability)
  }
}