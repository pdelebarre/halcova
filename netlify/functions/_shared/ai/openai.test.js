// @vitest-environment node
//
// Unit suite for the OpenAI-compatible adapter
// (netlify/functions/_shared/ai/openai.js, ADMIN-3.1 #303). Covers the full
// bounded contract: success, malformed output, oversized output, timeout,
// rate limiting, provider failure, auth, bad request, and the sacred SSRF
// `redirect: 'manual'`. No real network — global.fetch is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from './openai'
import { ProviderError, ProviderErrorCode } from './provider'

const CLASSIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'confidence'],
  properties: {
    category: { type: 'string', minLength: 1, maxLength: 100 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
}

// A bare fetch Response backing object (what the adapter examines).
function response(status, bodyText) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => bodyText,
  }
}

// A fetch Response whose body is a stream (the real Netlify path). The adapter
// must read it in chunks and enforce the byte cap while streaming.
function streamResponse(status, bodyText) {
  const chunks = bodyText.match(/.{1,8}/g) || []
  const reader = {
    index: 0,
    async read() {
      if (this.index >= chunks.length) return { done: true }
      return { done: false, value: chunks[this.index++] }
    },
    release() {},
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    body: { getReader: () => reader },
  }
}

// A chat-completions payload with the given message content.
function chatPayload(content) {
  return JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 5, completion_tokens: 7 },
  })
}

const originalFetch = global.fetch

beforeEach(() => {
  global.fetch = vi.fn()
})

afterEach(() => {
  global.fetch = originalFetch
  vi.useRealTimers()
})

function makeProvider(overrides = {}) {
  return new OpenAIProvider({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-test',
    capabilities: ['classify'],
    ...overrides,
  })
}

describe('complete — success', () => {
  it('returns the schema-validated content and usage', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"books","confidence":0.9}')))
    const result = await provider.complete({
      user: 'classify this',
      schema: CLASSIFY_SCHEMA,
    })
    expect(result.content).toEqual({ category: 'books', confidence: 0.9 })
    expect(result.model).toBe('gpt-test')
    expect(result.usage.completion_tokens).toBe(7)
  })

  it('sends the model, messages, and a JSON response_format', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"x","confidence":0.5}')))
    await provider.complete({ system: 'be concise', user: 'hi', schema: CLASSIFY_SCHEMA })
    const [, init] = global.fetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.model).toBe('gpt-test')
    expect(body.messages).toEqual([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hi' },
    ])
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(init.headers.Authorization).toBe('Bearer sk-test')
  })

  it('omits the Authorization header when no apiKey is configured', async () => {
    const provider = makeProvider({ apiKey: null })
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"x","confidence":0.5}')))
    await provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('omits the system message when none is provided', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"x","confidence":0.5}')))
    await provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    const [, init] = global.fetch.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})

describe('OpenAI — malformed output', () => {
  it('rejects a non-JSON message content', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, chatPayload('not json at all')))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects a JSON body that is not valid JSON', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, 'this is not json'))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects a payload with no message content', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, JSON.stringify({ choices: [] })))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects valid JSON that fails the output schema', async () => {
    const provider = makeProvider()
    // confidence is a string, not a number -> schema violation.
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"books","confidence":"high"}')))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })

  it('rejects JSON with an unknown property (fail-closed)', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"books","confidence":0.9,"evil":"x"}')))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.INVALID_OUTPUT })
  })
})

describe('OpenAI — oversized output', () => {
  it('rejects a response body over the bounded cap', async () => {
    const provider = makeProvider({ options: { maxResponseBytes: 16 } })
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"books","confidence":0.9}')))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.OVERSIZED_OUTPUT })
  })

  it('rejects an oversized streamed body while reading chunks', async () => {
    const provider = makeProvider({ options: { maxResponseBytes: 16 } })
    global.fetch.mockResolvedValue(streamResponse(200, chatPayload('{"category":"books","confidence":0.9}')))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.OVERSIZED_OUTPUT })
  })
})

describe('OpenAI — streamed body', () => {
  it('reads a streamed body and validates the content', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(streamResponse(200, chatPayload('{"category":"books","confidence":0.9}')))
    const result = await provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    expect(result.content).toEqual({ category: 'books', confidence: 0.9 })
  })
})

describe('OpenAI — timeout', () => {
  it('aborts a hung request and throws PROVIDER_TIMEOUT', async () => {
    vi.useFakeTimers()
    const provider = makeProvider({ options: { timeoutMs: 100, retries: 0 } })
    // A fetch that never resolves until the caller's AbortSignal fires.
    global.fetch = vi.fn((_url, init) => new Promise((resolve, reject) => {
      const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      if (init?.signal?.aborted) return onAbort()
      init.signal.addEventListener('abort', onAbort, { once: true })
    }))
    const promise = provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    promise.catch(() => {})
    const assertion = expect(promise).rejects.toMatchObject({ code: ProviderErrorCode.TIMEOUT })
    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })
})

describe('OpenAI — rate limiting', () => {
  it('retries a 429 then succeeds', async () => {
    const provider = makeProvider({ options: { retries: 1 } })
    global.fetch
      .mockResolvedValueOnce(response(429, '{}'))
      .mockResolvedValue(response(200, chatPayload('{"category":"books","confidence":0.9}')))
    const result = await provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    expect(result.content.category).toBe('books')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws PROVIDER_RATE_LIMIT when 429 persists across retries', async () => {
    const provider = makeProvider({ options: { retries: 2 } })
    global.fetch.mockResolvedValue(response(429, '{}'))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.RATE_LIMIT })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })
})

describe('OpenAI — provider failure', () => {
  it('retries a 5xx then succeeds', async () => {
    const provider = makeProvider({ options: { retries: 1 } })
    global.fetch
      .mockResolvedValueOnce(response(503, '{}'))
      .mockResolvedValue(response(200, chatPayload('{"category":"books","confidence":0.9}')))
    const result = await provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    expect(result.content.category).toBe('books')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('throws PROVIDER_FAILURE when 5xx persists across retries', async () => {
    const provider = makeProvider({ options: { retries: 2 } })
    global.fetch.mockResolvedValue(response(503, '{}'))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.FAILURE })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('throws PROVIDER_FAILURE on a persistent network error', async () => {
    const provider = makeProvider({ options: { retries: 2 } })
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.FAILURE })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('retries a network error then succeeds', async () => {
    const provider = makeProvider({ options: { retries: 2 } })
    global.fetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(response(200, chatPayload('{"category":"books","confidence":0.9}')))
    const result = await provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    expect(result.content.category).toBe('books')
  })
})

describe('OpenAI — auth and bad request', () => {
  it('throws PROVIDER_AUTH on 401 without retrying', async () => {
    const provider = makeProvider({ options: { retries: 2 } })
    global.fetch.mockResolvedValue(response(401, '{}'))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.AUTH })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('throws PROVIDER_BAD_REQUEST on 400 without retrying', async () => {
    const provider = makeProvider({ options: { retries: 2 } })
    global.fetch.mockResolvedValue(response(400, '{}'))
    await expect(provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.BAD_REQUEST })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('OpenAI — request validation', () => {
  it('rejects a missing user prompt', async () => {
    const provider = makeProvider()
    await expect(provider.complete({ schema: CLASSIFY_SCHEMA }))
      .rejects.toMatchObject({ code: ProviderErrorCode.BAD_REQUEST })
  })

  it('rejects a missing output schema', async () => {
    const provider = makeProvider()
    await expect(provider.complete({ user: 'hi' }))
      .rejects.toMatchObject({ code: ProviderErrorCode.BAD_REQUEST })
  })

  it('rejects construction without a baseUrl or model', () => {
    expect(() => new OpenAIProvider({ apiKey: 'k', model: 'm' }))
      .toThrowError(ProviderError)
    expect(() => new OpenAIProvider({ baseUrl: 'https://x', apiKey: 'k' }))
      .toThrowError(ProviderError)
  })
})

describe('OpenAI — SSRF control', () => {
  it('always sets redirect: manual', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, chatPayload('{"category":"x","confidence":0.5}')))
    await provider.complete({ user: 'hi', schema: CLASSIFY_SCHEMA })
    const [, init] = global.fetch.mock.calls[0]
    expect(init.redirect).toBe('manual')
  })
})

describe('OpenAI — health', () => {
  it('returns ok with latency on a healthy provider', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(200, '{}'))
    const h = await provider.health()
    expect(h.ok).toBe(true)
    expect(h.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('throws PROVIDER_AUTH on a 401 health check', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(401, '{}'))
    await expect(provider.health()).rejects.toMatchObject({ code: ProviderErrorCode.AUTH })
  })

  it('throws PROVIDER_FAILURE on a 5xx health check', async () => {
    const provider = makeProvider()
    global.fetch.mockResolvedValue(response(503, '{}'))
    await expect(provider.health()).rejects.toMatchObject({ code: ProviderErrorCode.FAILURE })
  })

  it('omits the Authorization header on a health check without an apiKey', async () => {
    const provider = makeProvider({ apiKey: null })
    global.fetch.mockResolvedValue(response(200, '{}'))
    await provider.health()
    const [, init] = global.fetch.mock.calls[0]
    expect(init.headers.Authorization).toBeUndefined()
  })
})

describe('OpenAI — model metadata', () => {
  it('exposes provider, model, and capabilities without credentials', () => {
    const provider = makeProvider()
    expect(provider.modelMetadata()).toEqual({
      provider: 'openai',
      model: 'gpt-test',
      capabilities: ['classify'],
    })
    expect(provider.supports('classify')).toBe(true)
    expect(provider.supports('deduplicate')).toBe(false)
  })
})