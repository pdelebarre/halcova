import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import InsightsDashboard from '../components/InsightsDashboard'
import * as authApi from '../api/auth'

vi.mock('../api/auth', () => ({
  adminAiInsights: vi.fn(),
}))

const MOCK_ITEMS = [
  { id: '1', title: 'Album A', artist: 'Artist 1', genre: 'Rock', year: '1975', format: 'LP' },
  { id: '2', title: 'Album B', artist: 'Artist 2', genre: 'Jazz', year: '1980', format: 'CD' },
  { id: '3', title: 'Album C', artist: 'Artist 1', genre: 'Rock', year: '1978', format: 'LP' },
  { id: '4', title: 'Album D', artist: 'Artist 3', genre: 'Pop', year: '1990', format: 'Digital' },
  { id: '5', title: 'Album E', artist: 'Artist 4', genre: 'Classical', year: '2000', format: 'CD' },
]

const MOCK_INSIGHTS = {
  completionSuggestions: [
    { title: 'Suggested Album', artist: 'Artist 3', reason: 'Completes your collection', evidence: 'You have other albums by this artist', estimated: false },
  ],
  recommendations: [
    { title: 'Recommended Album', artist: 'Artist 4', reason: 'Similar to your taste', evidence: 'Based on your Rock collection', estimated: true },
  ],
  gaps: [
    { description: 'Missing early 80s releases', reason: 'Your collection jumps from 1978 to 1985', evidence: 'Decade gap detected', estimated: false },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  authApi.adminAiInsights.mockResolvedValue({ insights: MOCK_INSIGHTS, cached: false })
})

describe('InsightsDashboard — Stats tab (deterministic, no AI)', () => {
  it('shows total item count', () => {
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('shows genre distribution', () => {
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)
    expect(screen.getByText('Rock')).toBeInTheDocument()
    expect(screen.getByText('Jazz')).toBeInTheDocument()
    expect(screen.getByText('Pop')).toBeInTheDocument()
    expect(screen.getByText('Classical')).toBeInTheDocument()
  })

  it('shows decade spread', () => {
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)
    expect(screen.getByText('1970s')).toBeInTheDocument()
    expect(screen.getByText('1980s')).toBeInTheDocument()
    expect(screen.getByText('1990s')).toBeInTheDocument()
    expect(screen.getByText('2000s')).toBeInTheDocument()
  })

  it('shows format breakdown', () => {
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)
    expect(screen.getByText('LP')).toBeInTheDocument()
    expect(screen.getByText('CD')).toBeInTheDocument()
    expect(screen.getByText('Digital')).toBeInTheDocument()
  })

  it('shows empty state when no items', () => {
    render(<InsightsDashboard items={[]} collectionType="records" onClose={() => {}} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('shows "no genre data" when items have no genre', () => {
    const noGenreItems = [
      { id: '1', title: 'Album A', year: '1975' },
      { id: '2', title: 'Album B', year: '1980' },
    ]
    render(<InsightsDashboard items={noGenreItems} collectionType="records" onClose={() => {}} />)
    expect(screen.getByText('No genre data yet.')).toBeInTheDocument()
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('InsightsDashboard — AI Insights tab', () => {
  async function openAiTab(user) {
    const tab = screen.getByRole('tab', { name: 'Collection insights' })
    await user.click(tab)
    return tab
  }

  it('shows generate button when no insights loaded', async () => {
    const user = userEvent.setup()
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)
    // Switch to AI tab
    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))
    // Should show generate button
    expect(screen.getByText('Generate insights')).toBeInTheDocument()
  })

  it('generates and displays insights', async () => {
    const user = userEvent.setup()
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)

    // Switch to AI tab
    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))

    // Click generate
    await user.click(screen.getByText('Generate insights'))

    // Wait for insights to appear
    await waitFor(() => {
      expect(screen.getByText('Suggested Album')).toBeInTheDocument()
    })

    expect(screen.getByText('Recommended Album')).toBeInTheDocument()
    expect(screen.getByText('Missing early 80s releases')).toBeInTheDocument()
    expect(authApi.adminAiInsights).toHaveBeenCalledWith({
      collectionType: 'records',
      items: expect.arrayContaining([
        expect.objectContaining({ id: '1', title: 'Album A' }),
      ]),
    })
  })

  it('shows estimated badge for estimated items', async () => {
    const user = userEvent.setup()
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)

    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))
    await user.click(screen.getByText('Generate insights'))

    await waitFor(() => {
      expect(screen.getByText('Estimated')).toBeInTheDocument()
    })
  })

  it('shows error state and retry button on failure', async () => {
    authApi.adminAiInsights.mockRejectedValue(new Error('AI provider unavailable'))
    const user = userEvent.setup()
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)

    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))
    await user.click(screen.getByText('Generate insights'))

    await waitFor(() => {
      expect(screen.getByText('AI provider unavailable')).toBeInTheDocument()
    })

    // Retry button should be present
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('shows empty state when no items in collection', async () => {
    const user = userEvent.setup()
    render(<InsightsDashboard items={[]} collectionType="records" onClose={() => {}} />)
    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))
    expect(screen.getByText('Add some items to your collection to see insights.')).toBeInTheDocument()
  })

  it('shows cached indicator when insights are cached', async () => {
    authApi.adminAiInsights.mockResolvedValue({ insights: MOCK_INSIGHTS, cached: true })
    const user = userEvent.setup()
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)

    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))
    await user.click(screen.getByText('Generate insights'))

    await waitFor(() => {
      expect(screen.getByText(/Cached/)).toBeInTheDocument()
    })
  })

  it('shows AI disclaimer when insights are displayed', async () => {
    const user = userEvent.setup()
    render(<InsightsDashboard items={MOCK_ITEMS} collectionType="records" onClose={() => {}} />)

    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))
    await user.click(screen.getByText('Generate insights'))

    await waitFor(() => {
      expect(screen.getByText(/AI suggests; you decide/)).toBeInTheDocument()
    })
  })

  it('data-minimization: sends only canonical fields to API', async () => {
    const itemsWithPrivate = [
      ...MOCK_ITEMS,
      {
        id: '6',
        title: 'Album F',
        notes: 'My private note',
        grading: 'Mint',
        wishlist: true,
      },
    ]
    const user = userEvent.setup()
    render(<InsightsDashboard items={itemsWithPrivate} collectionType="records" onClose={() => {}} />)

    await user.click(screen.getByRole('tab', { name: 'Collection insights' }))
    await user.click(screen.getByText('Generate insights'))

    await waitFor(() => {
      expect(authApi.adminAiInsights).toHaveBeenCalled()
    })

    const callArg = authApi.adminAiInsights.mock.calls[0][0]
    for (const item of callArg.items) {
      expect(item.notes).toBeUndefined()
      expect(item.grading).toBeUndefined()
      expect(item.wishlist).toBeUndefined()
    }
  })
})