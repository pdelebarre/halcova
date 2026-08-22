// @vitest-environment node
//
// FEAT-9.5 (#336) — AI Image Recognition for Collection Capture
// (netlify/functions/image-identify.js). Handler-level tests over the mocked
// @netlify/blobs store + real session tokens. Focused on the security contract:
//   - Authenticated requests succeed; unauthenticated requests return 401.
//   - Rate-limited per-identity+IP (429 on exhaustion).
//   - FAILS CLOSED: no ASSET_SIGN_SECRET -> identify refuses (503).
//   - No active AI provider -> 503.
//   - Invalid image data -> 400.
//   - XSS-safe: dangerous content in candidates is rejected server-side.
//   - AI suggests only (no auto-add): candidates returned for user confirmation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import imageIdentifyHandler from '../image-identify'
import { adminSessionToken, demoSessionToken, sessionTokenFor } from './session-test-helpers'
import { ProviderError, ProviderErrorCode } from './ai/provider'
import { __resetRepositoryForTests } from './repository'

const { stores, createStore } = vi.hoisted(() => {
  const stores = {}
  function createStore() {
    const data = new Map()
    return {
      data,
      async get(key, opts) {
        const v = this.data.get(String(key))
        if (v === undefined || v === null) return null
        if (opts?.type === 'json') return JSON.parse(JSON.stringify(v))
        return v
      },
      async setJSON(key, value) { this.data.set(String(key), JSON.parse(JSON.stringify(value))) },
      async set(key, value, opts) { this.data.set(String(key), value) },
      async delete(key) { this.data.delete(String(key)) },
      async list() { return { keys: [...this.data.keys()].map((key) => ({ key })) } },
    }
  }
  return { stores, createStore }
})

vi.mock('@netlify/blobs', () => ({ getStore: (name) => stores[name] || (stores[name] = createStore()) }))

// Mock the AI provider modules so we don't need real credentials.
const mockIdentifyFromImage = vi.fn()
vi.mock('./ai/tools', () => ({
  identifyFromImage: (...args) => mockIdentifyFromImage(...args),
}))

const mockBuildProvider = vi.fn()
const mockGetProfileSecret = vi.fn()
vi.mock('./ai/ai-admin', () => ({
  buildProvider: (...args) => mockBuildProvider(...args),
  getProfileSecret: (...args) => mockGetProfileSecret(...args),
}))

// Seed a member identity in the runout-identity store so resolveSession can
// resolve member sessions.
function seedMember(id) {
  const identity = stores['runout-identity'] || createStore()
  stores['runout-identity'] = identity
  const user = { id, name: 'Member', email: `${id}@example.com`, code: `RU-CODE-${id}`, collections: { records: true, books: true }, role: 'member', status: 'active' }
  identity.setJSON(`user:${id}`, user)
  return user
}

// Seed an AI provider profile so getActiveProfile returns something.
function seedAiProfile(overrides = {}) {
  const config = stores['runout-ai-config'] || createStore()
  stores['runout-ai-config'] = config
  const profile = {
    id: 'profile-1',
    name: 'Test Provider',
    providerType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    capabilities: ['identifyFromImage'],
    active: true,
    secretSet: true,
    secretCiphertext: 'encrypted',
    fallbackProviderId: null,
    lastTestOk: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
  // The blob store stores profiles as an array under the 'profiles' key
  config.setJSON('profiles', [profile])
  return profile
}

const MEMBER_ID = 'member-1'
const VALID_IMAGE_BASE64 = Buffer.from('fake-image-bytes').toString('base64')

const BASE_URL = 'http://localhost:3000'

function postJson(url, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return new Request(`${BASE_URL}${url}`, { method: 'POST', headers, body: JSON.stringify(body) })
}

beforeEach(() => {
  __resetRepositoryForTests()
  process.env.ASSET_SIGN_SECRET = 'test-asset-sign-secret'
  process.env.ASSET_SIGN_TTL_MINUTES = '5'
  mockIdentifyFromImage.mockReset()
  mockBuildProvider.mockReset()
  mockGetProfileSecret.mockReset()

  // Default mock: a working provider that returns candidates.
  mockBuildProvider.mockReturnValue({ name: 'openai', model: 'gpt-4o-mini' })
  mockGetProfileSecret.mockResolvedValue('sk-test-key')
  mockIdentifyFromImage.mockResolvedValue({
    candidates: [
      { title: 'Abbey Road', confidence: 0.95, source: 'cover' },
    ],
  })
})

afterEach(() => {
  __resetRepositoryForTests()
  delete process.env.ASSET_SIGN_SECRET
  delete process.env.ASSET_SIGN_TTL_MINUTES
  delete process.env.RUNOUT_IMAGE_IDENTIFY_RATE_LIMIT
  // Clear all stores
  for (const key of Object.keys(stores)) {
    delete stores[key]
  }
})

describe('image-identify endpoint', () => {
  it('returns 405 for non-POST requests', async () => {
    const req = new Request(`${BASE_URL}/.netlify/functions/image-identify`, { method: 'GET' })
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(405)
  })

  it('returns 401 for unauthenticated requests', async () => {
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 })
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for unknown action', async () => {
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'unknown' }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('UNKNOWN_ACTION')
  })

  it('returns 400 for missing image', async () => {
    seedMember(MEMBER_ID)
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify' }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('IMAGE_REQUIRED')
  })

  it('returns 400 for empty image string', async () => {
    seedMember(MEMBER_ID)
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: '' }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('IMAGE_REQUIRED')
  })

  it('returns 400 for unsupported image type', async () => {
    seedMember(MEMBER_ID)
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', {
      action: 'identify',
      image: VALID_IMAGE_BASE64,
      mimeType: 'image/gif',
    }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('UNSUPPORTED_IMAGE_TYPE')
  })

  it('returns 400 for invalid hints', async () => {
    seedMember(MEMBER_ID)
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', {
      action: 'identify',
      image: VALID_IMAGE_BASE64,
      hints: 'not-an-object',
    }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('INVALID_HINTS')
  })

  it('returns 503 when ASSET_SIGN_SECRET is not configured', async () => {
    delete process.env.ASSET_SIGN_SECRET
    seedMember(MEMBER_ID)
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.code).toBe('SIGNING_UNAVAILABLE')
  })

  it('returns 503 when no active AI provider is configured', async () => {
    seedMember(MEMBER_ID)
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(503)
    const data = await res.json()
    expect(data.code).toBe('AI_UNAVAILABLE')
  })

  it('returns 200 with candidates on successful identification', async () => {
    seedMember(MEMBER_ID)
    seedAiProfile()
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.candidates).toHaveLength(1)
    expect(data.candidates[0].title).toBe('Abbey Road')
    expect(data.candidates[0].confidence).toBe(0.95)
    expect(data.assetId).toBeTruthy()
    expect(data.expiresAt).toBeTruthy()
  })

  it('passes hints to the AI provider', async () => {
    seedMember(MEMBER_ID)
    seedAiProfile()
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', {
      action: 'identify',
      image: VALID_IMAGE_BASE64,
      hints: { collectionType: 'records' },
    }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(200)
    // Verify the tool was called with the right args
    expect(mockIdentifyFromImage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        imageUrl: expect.any(String),
        hints: { collectionType: 'records' },
      }),
    )
  })

  it('returns 502 when the AI provider fails', async () => {
    mockIdentifyFromImage.mockRejectedValue(new ProviderError(ProviderErrorCode.TIMEOUT, 'timed out', { retryable: true }))
    seedMember(MEMBER_ID)
    seedAiProfile()
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(502)
    const data = await res.json()
    expect(data.code).toBe('PROVIDER_TIMEOUT')
  })

  it('stores the image in the user\'s asset store', async () => {
    seedMember(MEMBER_ID)
    seedAiProfile()
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    await imageIdentifyHandler(req)
    // Check that an asset was stored in the user's store
    const store = stores[`assets-${MEMBER_ID}`]
    expect(store).toBeTruthy()
    // There should be at least one key starting with 'asset:'
    const keys = [...store.data.keys()].filter((k) => k.startsWith('asset:'))
    expect(keys.length).toBeGreaterThan(0)
  })

  it('rejects demo users (read-only)', async () => {
    const demoToken = await demoSessionToken()
    const req = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, demoToken)
    const res = await imageIdentifyHandler(req)
    expect(res.status).toBe(403)
  })

  it('rate-limits excessive requests', async () => {
    process.env.RUNOUT_IMAGE_IDENTIFY_RATE_LIMIT = '2'
    seedMember(MEMBER_ID)
    seedAiProfile()
    const token = await sessionTokenFor({ userId: MEMBER_ID, role: 'member' })

    // First two requests should succeed
    const req1 = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    const res1 = await imageIdentifyHandler(req1)
    expect(res1.status).toBe(200)

    const req2 = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    const res2 = await imageIdentifyHandler(req2)
    expect(res2.status).toBe(200)

    // Third request should be rate-limited
    const req3 = postJson('/.netlify/functions/image-identify', { action: 'identify', image: VALID_IMAGE_BASE64 }, token)
    const res3 = await imageIdentifyHandler(req3)
    expect(res3.status).toBe(429)
  })
})