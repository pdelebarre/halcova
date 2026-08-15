import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ReviewsSection from './ReviewsSection'
import { recordsCatalog } from '../catalog'

// The section is a thin shell over useReviews — mock the hook so tests control
// the data and can assert the render + submit/delete behaviour deterministically.
vi.mock('../hooks/useReviews', () => ({ useReviews: vi.fn() }))

import { useReviews } from '../hooks/useReviews'

const MINE = {
  id: 'r1', kind: 'records', sourceId: '101', authorId: 'u1', authorName: 'Miles',
  rating: 5, body: 'Classic', status: 'published',
  createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z',
}
const OTHER = {
  id: 'r2', kind: 'records', sourceId: '101', authorId: 'u2', authorName: 'Alice',
  rating: 4, body: 'Great pressing', status: 'published',
  createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
}

function baseState(overrides = {}) {
  return {
    reviews: [],
    mine: null,
    allReviews: [],
    aggregate: { avg: 0, count: 0 },
    status: 'ready',
    error: null,
    addOrUpdate: vi.fn().mockResolvedValue({ review: {} }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    refresh: vi.fn().mockResolvedValue(undefined),
    signedIn: false,
    ...overrides,
  }
}

function renderSection(state, props = {}) {
  useReviews.mockReturnValue(state)
  return render(<ReviewsSection kind="records" sourceId="101" catalog={recordsCatalog} {...props} />)
}

describe('ReviewsSection', () => {
  beforeEach(() => {
    useReviews.mockReset()
  })

  it('renders the aggregate line and the published reviews', () => {
    renderSection(baseState({
      allReviews: [MINE, OTHER],
      aggregate: { avg: 4.5, count: 2 },
      mine: MINE,
    }))

    expect(screen.getByText('Community reviews')).toBeInTheDocument()
    expect(screen.getByText('4.5 out of 5 · 2 reviews')).toBeInTheDocument()
    expect(screen.getByText('Miles')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Classic')).toBeInTheDocument()
    expect(screen.getByText('Great pressing')).toBeInTheDocument()
    // Display stars carry accessible labels.
    expect(screen.getAllByRole('img', { name: 'Rated 5 out of 5' }).length).toBeGreaterThan(0)
  })

  it('renders a minimal empty state when there are no reviews and no aggregate', () => {
    renderSection(baseState())
    expect(screen.getByText('No reviews yet')).toBeInTheDocument()
    expect(screen.getByText('Be the first to review this record.')).toBeInTheDocument()
  })

  it('renders a composer with an accessible 1–5 star selector for signed-in members', () => {
    renderSection(baseState({ signedIn: true }))

    // fieldset + legend labels the group; each star is a 44px-toggleable button.
    const fieldset = document.querySelector('fieldset')
    expect(fieldset).not.toBeNull()
    expect(screen.getByText('Your rating')).toBeInTheDocument()
    for (let n = 1; n <= 5; n += 1) {
      expect(screen.getByRole('button', { name: `Rate ${n} out of 5` })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Post review' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('does not render a composer when not signed in, but still shows reviews', () => {
    renderSection(baseState({ allReviews: [OTHER], aggregate: { avg: 4, count: 1 } }))
    expect(screen.getByText('Great pressing')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post review' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Rate \d out of 5/ })).not.toBeInTheDocument()
  })

  it('prefills the composer from the caller review and labels the button Update', () => {
    renderSection(baseState({ signedIn: true, mine: MINE, allReviews: [MINE] }))

    expect(screen.getByRole('textbox')).toHaveValue('Classic')
    // The star for the caller's rating is pressed.
    expect(screen.getByRole('button', { name: 'Rate 5 out of 5' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Update review' })).toBeInTheDocument()
    // Owned review gets Edit/Delete.
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('posts a review via addOrUpdate with the picked rating and body', async () => {
    const addOrUpdate = vi.fn().mockResolvedValue({ review: { id: 'r9' } })
    renderSection(baseState({ signedIn: true, addOrUpdate }))

    fireEvent.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fantastic' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

    expect(addOrUpdate).toHaveBeenCalledWith(5, 'Fantastic')
  })

  it('requires a rating before submitting', () => {
    const addOrUpdate = vi.fn().mockResolvedValue({ review: {} })
    renderSection(baseState({ signedIn: true, addOrUpdate }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No stars' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

    expect(addOrUpdate).not.toHaveBeenCalled()
    expect(screen.getByText('Pick a star rating first.')).toBeInTheDocument()
  })

  it('shows an inline, code-mapped error when the upsert rejects', async () => {
    const err = Object.assign(new Error('Nope'), { code: 'PLAN_FORBIDDEN' })
    const addOrUpdate = vi.fn().mockRejectedValue(err)
    renderSection(baseState({ signedIn: true, addOrUpdate }))

    fireEvent.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

    expect(addOrUpdate).toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent("Your plan doesn't include reviews.")
  })

  it('falls back to a generic inline message for unknown errors', async () => {
    const addOrUpdate = vi.fn().mockRejectedValue(new Error('boom'))
    renderSection(baseState({ signedIn: true, addOrUpdate }))

    fireEvent.click(screen.getByRole('button', { name: 'Rate 3 out of 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })

  it('shows a quiet loading line instead of a misleading empty state while loading', () => {
    renderSection(baseState({ status: 'loading' }))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.queryByText('No reviews yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Be the first to review this record.')).not.toBeInTheDocument()
  })

  it('shows a quiet load-error fallback with a working Retry when loading fails', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    renderSection(baseState({ status: 'error', error: 'network', refresh }))

    expect(screen.getByText("Couldn't load reviews.")).toBeInTheDocument()
    const retry = screen.getByRole('button', { name: 'Retry' })
    fireEvent.click(retry)
    expect(refresh).toHaveBeenCalledTimes(1)
    // Signed-out visitors see no composer, but the section stays recoverable.
    expect(screen.queryByRole('button', { name: 'Post review' })).not.toBeInTheDocument()
  })

  it('keeps the composer usable on the error branch for signed-in members', () => {
    renderSection(baseState({ status: 'error', error: 'network', signedIn: true }))
    expect(screen.getByText("Couldn't load reviews.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    // A write doesn't need the list — the composer stays available.
    expect(screen.getByRole('button', { name: 'Post review' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('does not clobber in-progress composer input when a slow load resolves', () => {
    const { rerender } = renderSection(baseState({ signedIn: true, status: 'loading' }))

    fireEvent.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My draft' } })

    useReviews.mockReturnValue(baseState({ signedIn: true, status: 'ready', mine: MINE, allReviews: [MINE] }))
    rerender(<ReviewsSection kind="records" sourceId="101" catalog={recordsCatalog} />)

    // The member's draft survives; prefill never runs over it.
    expect(screen.getByRole('textbox')).toHaveValue('My draft')
    expect(screen.getByRole('button', { name: 'Rate 4 out of 5' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('fires a success toast when a new review is posted', async () => {
    const showToast = vi.fn()
    const addOrUpdate = vi.fn().mockResolvedValue({ review: { id: 'r9' } })
    renderSection(baseState({ signedIn: true, addOrUpdate }), { showToast })

    fireEvent.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fantastic' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

    expect(addOrUpdate).toHaveBeenCalledWith(5, 'Fantastic')
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Review posted'))
  })

  it('fires a success toast when an existing review is updated', async () => {
    const showToast = vi.fn()
    renderSection(baseState({ signedIn: true, mine: MINE, allReviews: [MINE] }), { showToast })

    fireEvent.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Update review' }))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Review updated'))
  })

  it('marks only the rating fieldset invalid when a rating is missing', () => {
    renderSection(baseState({ signedIn: true }))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'No stars' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

    expect(screen.getByText('Pick a star rating first.')).toBeInTheDocument()
    const fieldset = document.querySelector('fieldset')
    expect(fieldset).toHaveAttribute('aria-invalid', 'true')
    expect(fieldset).toHaveAttribute('aria-describedby', 'reviews-submit-error')
    // The optional textarea is never the culprit — it must not claim an error.
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-invalid')
  })

  it('does not pin a general submit error to a control', async () => {
    const err = Object.assign(new Error('Nope'), { code: 'PLAN_FORBIDDEN' })
    const addOrUpdate = vi.fn().mockRejectedValue(err)
    renderSection(baseState({ signedIn: true, addOrUpdate }))

    fireEvent.click(screen.getByRole('button', { name: 'Rate 5 out of 5' }))
    fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

    expect(await screen.findByRole('alert')).toHaveTextContent("Your plan doesn't include reviews.")
    const fieldset = document.querySelector('fieldset')
    expect(fieldset).not.toHaveAttribute('aria-invalid')
  })

  it('moves focus back to the section heading after a confirmed delete', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true })
    renderSection(baseState({ signedIn: true, mine: MINE, allReviews: [MINE], remove }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete review?' }))

    await waitFor(() => expect(document.activeElement).toHaveClass('detail-section-label'))
    expect(document.activeElement).toHaveTextContent('Community reviews')
  })

  it('never crashes on weird review shapes (dark-screen safety)', () => {
    renderSection(baseState({
      allReviews: [null, { body: undefined }, { rating: 'abc', authorName: 42 }],
      aggregate: { avg: 'x', count: null },
    }))
    // Renders without throwing; the anonymous fallback shows for entries with
    // no name (the null entry and the missing-author entry both render it).
    expect(screen.getAllByText('A member').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders nothing for an item with no provider id (manual entry)', () => {
    useReviews.mockReturnValue(baseState())
    const { container } = render(<ReviewsSection kind="records" sourceId={null} catalog={recordsCatalog} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('deletes the caller review via remove after the confirm step', async () => {
    const remove = vi.fn().mockResolvedValue({ ok: true })
    renderSection(baseState({ signedIn: true, mine: MINE, allReviews: [MINE], remove }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // First tap arms the confirm label.
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete review?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete review?' }))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('maps every known server error code to its i18n message', async () => {
    const cases = [
      ['RATE_LIMITED', 'Too many reviews right now — wait a moment and try again.'],
      ['NOT_FOUND', 'That review is gone. Refresh to see the latest.'],
      ['BAD_REQUEST', "Couldn't save your review — check the details."],
    ]
    for (const [code, message] of cases) {
      const err = Object.assign(new Error('raw'), { code })
      const addOrUpdate = vi.fn().mockRejectedValue(err)
      const { unmount } = renderSection(baseState({ signedIn: true, addOrUpdate }))

      fireEvent.click(screen.getByRole('button', { name: 'Rate 4 out of 5' }))
      fireEvent.click(screen.getByRole('button', { name: 'Post review' }))

      // eslint-disable-next-line no-await-in-loop
      expect(await screen.findByRole('alert')).toHaveTextContent(message)
      unmount()
    }
  })
})
