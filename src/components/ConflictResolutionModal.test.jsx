// M3 #161 — ConflictResolutionModal tests (ADR-0019 Dec 8).
//
// Covers:
//   - renders when open
//   - shows "no conflicts" when none exist
//   - shows conflict details when conflicts exist
//   - resolves a conflict with USE_SERVER/USE_LOCAL
//   - navigation between multiple conflicts
//   - close button works

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ConflictResolutionModal from './ConflictResolutionModal'

// Mock the i18n module
vi.mock('../i18n', () => ({
  t: (key, params) => {
    const translations = {
      'conflict.title': 'Sync Conflict',
      'conflict.counter': params ? 'Conflict ' + params.current + ' of ' + params.total : 'Conflict',
      'conflict.none': 'No unresolved conflicts.',
      'conflict.resolvedCount': params ? 'Resolved ' + params.n + ' of ' + params.total + ' conflicts.' : 'Resolved',
      'conflict.resolved': '✓ Resolved',
      'conflict.server': 'Server',
      'conflict.local': 'Local',
      'conflict.noDifferences': 'No field differences to show.',
      'conflict.versionInfo': params ? 'Server version ' + params.server + ' · Local version ' + params.local : 'Version info',
      'conflict.chooseResolution': 'Choose which version to keep:',
      'conflict.useServer': 'Keep server version',
      'conflict.useLocal': 'Keep local version',
      'conflict.merge': 'Merge fields',
      'conflict.mergeableFields': 'Mergeable fields (pick which version to keep for each):',
      'conflict.entityType.collection': 'Collection item',
      'conflict.entityType.lending': 'Lending status',
      'common.close': 'Close',
      'common.done': 'Done',
      'common.back': 'Back',
      'common.next': 'Next',
      'common.loading': 'Loading…',
    }
    return translations[key] || key
  },
}))

const { RESOLUTION, mockResolveConflict, mockRefresh, mockConflictsObj, mockMetricsObj } = vi.hoisted(() => {
  const R = Object.freeze({
    USE_SERVER: 'resolved-server',
    USE_LOCAL: 'resolved-local',
    MERGE: 'resolved-merged',
  })
  return {
    RESOLUTION: R,
    mockResolveConflict: vi.fn(),
    mockRefresh: vi.fn(),
    mockConflictsObj: { current: [] },
    mockMetricsObj: { current: { totalConflicts: 0, unresolved: 0, resolvedServer: 0, resolvedLocal: 0, resolvedMerged: 0 } },
  }
})

vi.mock('../hooks/useConflicts', () => ({
  useConflicts: () => ({
    conflicts: mockConflictsObj.current,
    metrics: mockMetricsObj.current,
    loading: false,
    refresh: mockRefresh,
    resolveConflict: mockResolveConflict,
    RESOLUTION: RESOLUTION,
    buildResolutionPatch: vi.fn(() => null),
  }),
  RESOLUTION: RESOLUTION,
}))

const CONFLICTS = [
  {
    conflictId: 'c1',
    uuid: 'server:r1',
    entityType: 'collection',
    serverVersion: 5,
    localVersion: 2,
    serverItem: { title: 'Server Title', year: 1959, notes: 'Server notes' },
    localItem: { title: 'Local Title', year: 1959, notes: 'Local notes' },
    detectedAt: new Date().toISOString(),
    status: 'unresolved',
    policy: { requiresUserIntent: false, mergeableFields: ['notes'] },
  },
  {
    conflictId: 'c2',
    uuid: 'server:r2',
    entityType: 'lending',
    serverVersion: 3,
    localVersion: 1,
    serverItem: { lentTo: 'Alice', lentAt: '2026-08-01' },
    localItem: { lentTo: 'Bob', lentAt: '2026-08-15' },
    detectedAt: new Date().toISOString(),
    status: 'unresolved',
    policy: { requiresUserIntent: true, mergeableFields: [] },
  },
]

const CONFLICT_METRICS = { totalConflicts: 2, unresolved: 2, resolvedServer: 0, resolvedLocal: 0, resolvedMerged: 0 }

const onClose = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockConflictsObj.current = []
  mockMetricsObj.current = { totalConflicts: 0, unresolved: 0, resolvedServer: 0, resolvedLocal: 0, resolvedMerged: 0 }
  mockResolveConflict.mockResolvedValue(true)
})

describe('ConflictResolutionModal', () => {
  it('renders nothing when not open', () => {
    const { container } = render(
      <ConflictResolutionModal open={false} onClose={onClose} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows "no conflicts" when no unresolved conflicts', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('No unresolved conflicts.')).toBeInTheDocument()
    })
  })

  it('renders the dialog with correct aria attributes', () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Sync Conflict')
  })

  it('closes when close button is clicked', () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    const closeBtn = screen.getByLabelText('Close')
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when overlay is clicked', () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    const overlay = document.querySelector('.conflict-modal-overlay')
    if (overlay) {
      fireEvent.click(overlay)
      expect(onClose).toHaveBeenCalled()
    }
  })
})

describe('ConflictResolutionModal with conflicts', () => {
  beforeEach(() => {
    mockConflictsObj.current = CONFLICTS
    mockMetricsObj.current = CONFLICT_METRICS
  })

  it('shows conflict details', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Collection item')).toBeInTheDocument()
    })

    expect(screen.getByText(/Server version 5/)).toBeInTheDocument()
    expect(screen.getByText('Server Title')).toBeInTheDocument()
    expect(screen.getByText('Local Title')).toBeInTheDocument()
  })

  it('shows resolution buttons', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Keep server version')).toBeInTheDocument()
    })

    expect(screen.getByText('Keep local version')).toBeInTheDocument()
  })

  it('resolves conflict with USE_SERVER', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Keep server version')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Keep server version'))

    await waitFor(() => {
      expect(mockResolveConflict).toHaveBeenCalledWith('c1', 'resolved-server', undefined)
    })
  })

  it('resolves conflict with USE_LOCAL', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Keep local version')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Keep local version'))

    await waitFor(() => {
      expect(mockResolveConflict).toHaveBeenCalledWith('c1', 'resolved-local', undefined)
    })
  })

  it('shows conflict counter for multiple conflicts', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Conflict 1 of 2')).toBeInTheDocument()
    })
  })

  it('shows Done button', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument()
    })
  })

  it('navigates to next conflict', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Conflict 1 of 2')).toBeInTheDocument()
    })

    // Click next
    fireEvent.click(screen.getByText(/Next/))

    await waitFor(() => {
      expect(screen.getByText('Conflict 2 of 2')).toBeInTheDocument()
    })
  })

  it('navigates to previous conflict', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Conflict 1 of 2')).toBeInTheDocument()
    })

    // Go to next, then back
    fireEvent.click(screen.getByText(/Next/))
    await waitFor(() => {
      expect(screen.getByText('Conflict 2 of 2')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText(/Back/))
    await waitFor(() => {
      expect(screen.getByText('Conflict 1 of 2')).toBeInTheDocument()
    })
  })

  it('shows merge fields section', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Merge fields')).toBeInTheDocument()
    })

    // Check mergeable fields section is visible
    expect(screen.getByText(/Mergeable fields/)).toBeInTheDocument()
    expect(screen.getAllByText('notes').length).toBeGreaterThanOrEqual(1)
  })

  it('resolves conflict with MERGE', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Merge fields')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Merge fields'))

    await waitFor(() => {
      expect(mockResolveConflict).toHaveBeenCalledWith('c1', 'resolved-merged', undefined)
    })
  })

  it('shows different entity type for second conflict', async () => {
    render(<ConflictResolutionModal open={true} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('Collection item')).toBeInTheDocument()
    })

    // Navigate to the second conflict
    fireEvent.click(screen.getByText(/Next/))

    await waitFor(() => {
      expect(screen.getByText('Lending status')).toBeInTheDocument()
    })
  })
})