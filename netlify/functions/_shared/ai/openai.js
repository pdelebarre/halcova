// openai.js — OpenAI-compatible provider adapter (ADMIN-3.1, #303, epic #302).
//
// Implements the Provider contract against any OpenAI-compatible chat
// completions endpoint (OpenAI, or a self-hosted / alternative base URL). The
// base URL and model are configurable at construction; the apiKey is injected
// by the caller (never read from storage here — that is #304's job).
//
// Security (ADR-0006):
//   - Provider output is UNTRUSTED: every structured response is parsed and
//     schema-validated, and malformed/oversized output is rejected fail-closed.
//   - Every request is bounded: a timeout, a response-size cap, a bounded retry
//     budget, and a bounded token ceiling.
//   - `redirect: 'manual'` is always set (SSRF control, mirroring
//     _shared/lookup-fetch.js).
//   - No credentials are ever logged or returned.

import { ProviderError, ProviderErrorCode, boundedOptions, mergeOptions } from './provider'
import { validateSchema } from './schema'

// Default OpenAI-compatible chat completions path.
const CHAT_COMPLETIONS_PATH = '/chat/completions'
const MODELS_PATH = '/models'

// Retry only 429 and 5xx. A 4xx is a caller/credential bug, never transient.
function isRetryableStatus(status) {
  return status === 429 || status >= 500
}

// Map a non-retryable HTTP status to a stable ProviderError code.
function statusErrorCode(status) {
  if (status === 401 || status === 403) return ProviderErrorCode.AUTH
  if (status === 400) return ProviderErrorCode.BAD_REQUEST
  return ProviderErrorCode.FAILURE
}

// Read a fetch Response body with a hard byte cap. On the real path the body
// is a stream, so we read in chunks and abort as soon as the cap is exceeded
// (never buffer an unbounded body). Test doubles without a stream fall back to
// `.text()` and still enforce the cap.
async function readBoundedText(response, maxBytes) {
  const body = response.body
  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks = []
    let total = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = typeof value === 'string' ? value : new TextDecoder().decode(value)
        total += Buffer.byteLength(chunk, 'utf8')
        if (total > maxBytes) {
          throw new ProviderError(
            ProviderErrorCode.OVERSIZED_OUTPUT,
            'Provider response exceeded the size limit.',
          )
        }
        chunks.push(chunk)
      }
    } finally {
      reader.release?.()
    }
    return chunks.join('')
  }
  if (typeof response.text === 'function') {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new ProviderError(
        ProviderErrorCode.OVERSIZED_OUTPUT,
        'Provider response exceeded the configured size limit.',
      )
    }
    return text
  }
  throw new ProviderError(ProviderErrorCode.FAILURE, 'Provider response is not readable.')
}

// Parse the model's `content` field as JSON and validate it against the
// requested output schema. Fail-closed: any parse or validation failure throws
// INVALID_OUTPUT.
function parseAndValidate(content, schema) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new ProviderError(ProviderErrorCode.INVALID_OUTPUT, 'Provider returned malformed JSON.')
  }
  const result = validateSchema(parsed, schema)
  if (!result.valid) {
    throw new ProviderError(
      ProviderErrorCode.INVALID_OUTPUT,
      `Provider output failed schema validation: ${result.errors.join('; ')}`,
    )
  }
  return parsed
}

export class OpenAIProvider {
  constructor({ baseUrl, apiKey, model, capabilities = [], options = {} }) {
    if (!baseUrl || typeof baseUrl !== 'string') {
      throw new ProviderError(ProviderErrorCode.BAD_REQUEST, 'OpenAIProvider requires a baseUrl.')
    }
    if (!model || typeof model !== 'string') {
      throw new ProviderError(ProviderErrorCode.BAD_REQUEST, 'OpenAIProvider requires a model.')
    }
    this.name = 'openai'
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
    this.model = model
    this.capabilities = new Set(capabilities)
    this.options = { ...boundedOptions(options) }
  }

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

  // Run a structured completion.
  //   request: { system?, user, schema, options? }
  // Returns { content, model, usage? } where `content` is the schema-validated
  // parsed JSON value.
  async complete(request) {
    const { system, user, schema, options = {} } = request
    if (typeof user !== 'string' || user.length === 0) {
      throw new ProviderError(ProviderErrorCode.BAD_REQUEST, 'A user prompt is required.')
    }
    if (!schema || typeof schema !== 'object') {
      throw new ProviderError(ProviderErrorCode.BAD_REQUEST, 'An output schema is required.')
    }
    const opts = mergeOptions(this.options, options)

    const messages = []
    if (system) messages.push({ role: 'system', content: system })
    messages.push({ role: 'user', content: user })

    const body = {
      model: this.model,
      messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      // Ask the provider for a JSON object so we can schema-validate it.
      response_format: { type: 'json_object' },
    }

    const url = `${this.baseUrl}${CHAT_COMPLETIONS_PATH}`
    const res = await this.#fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      opts,
    })

    const text = await readBoundedText(res, opts.maxResponseBytes)
    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ProviderError(ProviderErrorCode.INVALID_OUTPUT, 'Provider returned malformed JSON.')
    }

    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      throw new ProviderError(ProviderErrorCode.INVALID_OUTPUT, 'Provider returned no message content.')
    }

    const parsed = parseAndValidate(content, schema)
    return {
      provider: this.name,
      model: this.model,
      content: parsed,
      usage: payload?.usage ?? null,
    }
  }

  // Health check against the provider's models endpoint. Returns
  // { ok: true, latencyMs } or throws ProviderError.
  async health() {
    const started = Date.now()
    const url = `${this.baseUrl}${MODELS_PATH}`
    const res = await this.#fetchWithRetry(url, {
      method: 'GET',
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      opts: { ...this.options, retries: 0 },
    })
    if (!res.ok) {
      throw new ProviderError(statusErrorCode(res.status), `Provider health check failed (${res.status}).`)
    }
    return { ok: true, latencyMs: Date.now() - started }
  }

  // Bounded fetch with per-attempt timeout, overall deadline, and bounded
  // retries on 429/5xx/network. Never follows redirects (SSRF control).
  async #fetchWithRetry(url, { method, headers, body, opts }) {
    const overall = new AbortController()
    let deadlineReached = false
    const overallTimer = setTimeout(() => {
      deadlineReached = true
      overall.abort()
    }, opts.timeoutMs)
    const clearAll = () => clearTimeout(overallTimer)

    let lastStatus = null
    let lastError = null

    try {
      for (let attempt = 0; attempt <= opts.retries; attempt += 1) {
        const attemptController = new AbortController()
        const onAbort = () => attemptController.abort()
        overall.signal.addEventListener('abort', onAbort)
        const attemptTimer = setTimeout(() => attemptController.abort(), opts.timeoutMs)

        let res
        try {
          res = await fetch(url, {
            method,
            headers,
            body,
            redirect: 'manual',
            signal: attemptController.signal,
          })
        } catch (err) {
          if (deadlineReached) {
            lastError = new ProviderError(ProviderErrorCode.TIMEOUT, 'Provider request timed out.', { cause: err })
            break
          }
          lastError = err
          if (attempt < opts.retries) {
            await sleepBounded(attempt, opts.timeoutMs, Date.now(), overall)
          }
          continue
        } finally {
          clearTimeout(attemptTimer)
          overall.signal.removeEventListener('abort', onAbort)
        }

        lastStatus = res.status
        lastError = null
        if (res.ok) return res
        if (!isRetryableStatus(res.status)) {
          // 4xx (auth / bad request) is final — surface it immediately.
          throw new ProviderError(statusErrorCode(res.status), `Provider rejected the request (${res.status}).`)
        }
        if (attempt < opts.retries) {
          await sleepBounded(attempt, opts.timeoutMs, Date.now(), overall)
        }
      }

      if (deadlineReached) throw new ProviderError(ProviderErrorCode.TIMEOUT, 'Provider timed out.')
      if (lastError) {
        throw new ProviderError(ProviderErrorCode.FAILURE, 'Provider network failure.', { cause: lastError })
      }
      // Persistent retryable HTTP status.
      if (lastStatus === 429) {
        throw new ProviderError(ProviderErrorCode.RATE_LIMIT, 'Provider rate limited.')
      }
      throw new ProviderError(ProviderErrorCode.FAILURE, `Provider failed (${lastStatus}).`)
    } finally {
      clearAll()
    }
  }
}

// Full-jitter backoff capped by the remaining overall budget. `attempt` is the
// zero-based index that just failed.
function sleepBounded(attempt, timeoutMs, startedAt, overall) {
  const base = Math.min(200 * 2 ** attempt, 1000)
  const delayMs = Math.floor(Math.random() * base)
  const remaining = timeoutMs - (Date.now() - startedAt)
  const wait = Math.min(delayMs, Math.max(0, remaining))
  if (wait <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, wait)
    const onAbort = () => done()
    function done() {
      clearTimeout(timer)
      overall.signal.removeEventListener('abort', onAbort)
      resolve()
    }
    overall.signal.addEventListener('abort', onAbort)
  })
}