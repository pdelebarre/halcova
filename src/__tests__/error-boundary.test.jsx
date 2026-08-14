import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ErrorBoundary from '../components/ErrorBoundary'

// A child that always throws while rendering — what a missing `?.` guard or a
// weird item shape would do to the tree.
function Bomb() {
  throw new Error('kaboom')
}

// A stable child so the "no error" path is covered.
function Calm() {
  return <div>all good</div>
}

beforeEach(() => {
  // React logs caught boundary errors to console.error — silence it so a
  // passing test doesn't print a stack trace.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary — no more dark blank screen (T7)', () => {
  it('renders children normally when nothing throws', () => {
    render(<ErrorBoundary><Calm /></ErrorBoundary>)
    expect(screen.getByText('all good')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the fallback card instead of blanking when a child throws', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)

    // The app "doesn't blank": a real, on-theme card is rendered and announces
    // the failure to assistive tech.
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument()
    expect(screen.getByText(/unexpected error/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.queryByText('all good')).not.toBeInTheDocument()
  })

  it('reloads the page when Reload is clicked', () => {
    // The component defaults to window.location.reload(); the onReload prop is
    // the test seam (jsdom's Location#reload is non-configurable).
    const reload = vi.fn()
    render(<ErrorBoundary onReload={reload}><Bomb /></ErrorBoundary>)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
