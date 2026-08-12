import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import SortMenu from '../components/SortMenu'
import { recordsCatalog } from '../catalog'

const options = recordsCatalog.sortOptions

function renderMenu(overrides = {}) {
  const props = {
    options,
    value: 'added',
    onSelect: vi.fn(),
    onClose: vi.fn(),
    anchorRef: { current: null },
    copy: recordsCatalog.copy,
    ...overrides,
  }
  return render(<SortMenu {...props} />)
}

describe('SortMenu', () => {
  it('renders every sort option as a radio item with the current one checked', () => {
    renderMenu()

    const menu = screen.getByRole('menu', { name: 'Sort by' })
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(options.length)

    expect(screen.getByRole('menuitemradio', { name: 'Recently added' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Artist A–Z' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('menuitemradio', { name: 'Year' })).toHaveAttribute('aria-checked', 'false')
  })

  it('applies a selection', () => {
    const onSelect = vi.fn()
    renderMenu({ onSelect })

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Year' }))
    expect(onSelect).toHaveBeenCalledWith('year')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderMenu({ onClose })

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('moves between options with arrow keys and selects with Enter', () => {
    const onSelect = vi.fn()
    renderMenu({ onSelect })

    const menu = screen.getByRole('menu', { name: 'Sort by' })
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('artist')
  })
})
