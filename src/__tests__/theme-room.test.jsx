import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { ThemeProvider } from '../theme'
import { recordsCatalog, booksCatalog } from '../catalog'

// Same CollectionView harness as collection-view-refresh.test.jsx: the real
// useCollection hook runs against a mocked collection API. These tests are the
// no-dark-screen guard for T2 (issue #110): the shared flow must render BOTH
// rooms (records + books) without throwing, with the room's accent scope on
// the container. T5 (#102) will expand this later — keep it small on purpose.

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

import * as api from '../api/collection'

const ITEM = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  dateAdded: '2026-01-01T00:00:00Z',
}

function renderRoom(catalog) {
  return render(
    <ThemeProvider theme={catalog.theme}>
      <CollectionView catalog={catalog} onRequestSettings={() => {}} refreshTick={0} />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.removeItem('runout.view.records')
  localStorage.removeItem('runout.view.books')
  api.listItems.mockReset().mockResolvedValue([ITEM])
})

describe('Theme room scope (epic #95, T2 #110)', () => {
  it('renders the Records room with the gold accent scope without throwing', async () => {
    const { container } = renderRoom(recordsCatalog)
    await waitFor(() => expect(api.listItems).toHaveBeenCalledWith('records'))

    const scope = container.querySelector('.collection-view')
    expect(scope).not.toBeNull()
    expect(scope.dataset.kind).toBe('records')
    expect(scope.style.getPropertyValue('--theme-accent')).toBe('var(--kind-records-accent)')
    expect(scope.style.getPropertyValue('--theme-accent-text')).toBe('var(--color-bg)')
  })

  it('renders the Books room with the neutral placeholder accent scope without throwing', async () => {
    const { container } = renderRoom(booksCatalog)
    await waitFor(() => expect(api.listItems).toHaveBeenCalledWith('books'))

    const scope = container.querySelector('.collection-view')
    expect(scope).not.toBeNull()
    expect(scope.dataset.kind).toBe('books')
    expect(scope.style.getPropertyValue('--theme-accent')).toBe('var(--kind-books-accent)')
    expect(scope.style.getPropertyValue('--theme-accent-text')).toBe('var(--color-bg)')
  })

  it('degrades safely when no theme provider is present (no dark screen)', () => {
    // A collection rendered without ThemeProvider (e.g. a test, or a future
    // entry point) must still mount — useTheme() returns {} and no CSS
    // variables are set, but nothing throws.
    const { container } = render(
      <CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} refreshTick={0} />,
    )

    const scope = container.querySelector('.collection-view')
    expect(scope).not.toBeNull()
    expect(scope.dataset.kind).toBe('records')
    expect(scope.style.getPropertyValue('--theme-accent')).toBe('')
  })
})
