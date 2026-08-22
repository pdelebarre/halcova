// @vitest-environment node
//
// Tests for the AI dry-run module (ADMIN-3.8, #310). Covers the dry-run
// execution path with mocked provider and feedback stores.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dryRunFeedback } from './ai-dryrun'

// Shared mutable mock state — these are set up in vi.hoisted so they are
// available in the vi.mock factory callbacks.
const { mockConfigProfiles, mockFeedbackItems, mockBuildProvider, mockGetProfileSecret } = vi.hoisted(() => {
  const mockConfigProfiles = vi.fn()
  const mockFeedbackItems = vi.fn()
  const mockBuildProvider = vi.fn()
  const mockGetProfileSecret = vi.fn()
  return { mockConfigProfiles, mockFeedbackItems, mockBuildProvider, mockGetProfileSecret }
})

vi.mock('../postgres', () => ({
  isPostgresConfigured: () => false,
  db: {},
}))

vi.mock('@netlify/blobs', () => ({
  getStore: () => ({
    get: vi.fn().mockResolvedValue(null),
    setJSON: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../repositories/feedback-repo', () => ({
  createFeedbackRepo: () => ({
    listAll: mockFeedbackItems,
  }),
}))

vi.mock('../feedback-blob', () => ({
  createFeedbackBlobStore: () => ({
    listAll: mockFeedbackItems,
  }),
}))

vi.mock('./ai-config-repo', () => ({
  createAiConfigRepo: () => ({
    listProfiles: mockConfigProfiles,
  }),
}))

vi.mock('./ai-config-blob', () => ({
  createAiConfigBlobStore: () => ({
    listProfiles: mockConfigProfiles,
  }),
}))

vi.mock('./ai-admin', () => ({
  buildProvider: mockBuildProvider,
  getProfileSecret: mockGetProfileSecret,
}))

vi.mock('./ai-cost-tracker', () => ({
  estimateCost: vi.fn().mockReturnValue(0.00045),
}))

describe('dryRunFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when no active provider', async () => {
    mockConfigProfiles.mockResolvedValue([])
    const result = await dryRunFeedback({ limit: 10 })
    expect(result.error).toBeTruthy()
    expect(result.error.code).toBe('NO_ACTIVE_PROVIDER')
  })

  it('returns error when no feedback items', async () => {
    mockConfigProfiles.mockResolvedValue([{
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Provider',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      capabilities: ['classify'],
      active: true,
      secretSet: true,
    }])

    mockGetProfileSecret.mockResolvedValue('sk-test')
    mockBuildProvider.mockReturnValue({
      name: 'openai',
      model: 'gpt-4o-mini',
      complete: vi.fn(),
    })
    mockFeedbackItems.mockResolvedValue([])

    const result = await dryRunFeedback({ limit: 10 })
    expect(result.error).toBeTruthy()
    expect(result.error.code).toBe('NO_FEEDBACK')
  })

  it('evaluates feedback items and returns results', async () => {
    mockConfigProfiles.mockResolvedValue([{
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Provider',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      capabilities: ['classify'],
      active: true,
      secretSet: true,
    }])

    mockFeedbackItems.mockResolvedValue([
      { id: 'fb-1', message: 'This app is great!', type: 'suggestion', category: 'other' },
      { id: 'fb-2', message: 'Search is broken', type: 'bug', category: 'records' },
    ])

    mockGetProfileSecret.mockResolvedValue('sk-test')
    const mockComplete = vi.fn()
      .mockResolvedValueOnce({
        content: { classification: 'enhancement', summary: 'User likes the app', confidence: 0.9 },
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      })
      .mockResolvedValueOnce({
        content: { classification: 'bug', summary: 'Search feature is broken', confidence: 0.95 },
        usage: { prompt_tokens: 120, completion_tokens: 25 },
      })
    mockBuildProvider.mockReturnValue({
      name: 'openai',
      model: 'gpt-4o-mini',
      complete: mockComplete,
    })

    const result = await dryRunFeedback({ limit: 10 })
    expect(result.error).toBeUndefined()
    expect(result.results).toHaveLength(2)
    expect(result.summary.total).toBe(2)
    expect(result.summary.ok).toBe(2)
    expect(result.summary.fail).toBe(0)
    expect(result.results[0].classification).toBe('enhancement')
    expect(result.results[1].classification).toBe('bug')
  })

  it('handles provider failures gracefully', async () => {
    mockConfigProfiles.mockResolvedValue([{
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Provider',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      capabilities: ['classify'],
      active: true,
      secretSet: true,
    }])

    mockFeedbackItems.mockResolvedValue([
      { id: 'fb-1', message: 'Test', type: 'suggestion', category: 'other' },
    ])

    mockGetProfileSecret.mockResolvedValue('sk-test')
    mockBuildProvider.mockReturnValue({
      name: 'openai',
      model: 'gpt-4o-mini',
      complete: vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'PROVIDER_TIMEOUT' })),
    })

    const result = await dryRunFeedback({ limit: 10 })
    expect(result.error).toBeUndefined()
    expect(result.results).toHaveLength(1)
    expect(result.results[0].ok).toBe(false)
    expect(result.results[0].errorCode).toBe('PROVIDER_TIMEOUT')
    expect(result.summary.ok).toBe(0)
    expect(result.summary.fail).toBe(1)
  })
})