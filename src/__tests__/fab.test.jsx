import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import CollectionView from '../CollectionView'
import { recordsCatalog } from '../catalog'

vi.mock('../api/collection', () => ({
  listItems: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
}))

// The scanner is lazy + WASM-backed; stub it so choosing "Scan barcode" is safe.
vi.mock('../components/ScannerModal', () => ({
  default: () => <div role="dialog" aria-label="Scan barcode">scanner stub</div>,
}))

import * as api from '../api/collection'

const ITEMS = [
  { id: 'r1', title: 'Miles Davis - Kind of Blue', year: 1959, formatType: 'LP', label: 'Columbia', genre: ['Jazz'], dateAdded: '2026-01-01T00:00:00Z' },
]

beforeEach(() => {
  api.listItems.mockResolvedValue(ITEMS)
})

function renderCollection() {
  return render(<CollectionView catalog={recordsCatalog} onRequestSettings={() => {}} />)
}

describe('FAB add menu', () => {
  it('is a "Scan" button with a menu, closed by default', async () => {
    renderCollection()

    const fab = await screen.findByRole('button', { name: 'Scan' })
    expect(fab).toHaveAttribute('aria-haspopup', 'menu')
    expect(fab).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('expands a three-option menu and moves focus into it', async () => {
    renderCollection()

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)

    expect(fab).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Add options' })
    expect(within(menu).getByRole('menuitem', { name: 'Scan barcode' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Search by title' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Enter manually' })).toBeInTheDocument()

    // Focus moves to the first menu item on open.
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Scan barcode' }))
  })

  it('closes the menu when tapping outside and restores focus', async () => {
    const { container } = renderCollection()

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    expect(fab).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(container.querySelector('.fab-overlay'))
    expect(fab).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(fab)
  })

  it('closes the menu on Escape and restores focus to the FAB', async () => {
    renderCollection()

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(fab).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(fab)
  })

  it('choosing "Scan barcode" opens the scanner', async () => {
    renderCollection()

    const fab = await screen.findByRole('button', { name: 'Scan' })
    fireEvent.click(fab)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Scan barcode' }))

    expect(await screen.findByRole('dialog', { name: 'Scan barcode' })).toBeInTheDocument()
  })
})
