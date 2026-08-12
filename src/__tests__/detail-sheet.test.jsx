import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import AlbumDetail from '../components/AlbumDetail'
import BookDetail from '../components/BookDetail'
import { booksCatalog, recordsCatalog } from '../catalog'

// AlbumDetail fetches a tracklist for items with a discogsId — stub it out.
vi.mock('../api/discogs', () => ({
  getReleaseDetail: vi.fn().mockResolvedValue({ tracklist: [] }),
}))

const RECORD = {
  id: 'r1',
  title: 'Miles Davis - Kind of Blue',
  year: 1959,
  formatType: 'LP',
  formatRaw: 'LP',
  label: 'Columbia',
  catno: 'CL 1355',
  country: 'US',
  genre: ['Jazz'],
  discogsId: 101,
  barcode: '0767325734129',
  notes: '',
}

function renderDetail(item = RECORD, overrides = {}) {
  const props = {
    item,
    catalog: recordsCatalog,
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onSaveNotes: vi.fn(),
    ...overrides,
  }
  return render(<AlbumDetail {...props} />)
}

describe('Detail sheet (records)', () => {
  it('saves notes via onSaveNotes and shows the saved state', async () => {
    const onSaveNotes = vi.fn().mockResolvedValue()
    renderDetail(RECORD, { onSaveNotes })

    const saveBtn = screen.getByRole('button', { name: 'Save' })
    expect(saveBtn).toBeDisabled() // nothing to save yet

    fireEvent.change(screen.getByPlaceholderText(/Condition/), { target: { value: 'Original pressing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaveNotes).toHaveBeenCalledWith('Original pressing'))
    expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeInTheDocument()
  })

  it('asks for confirmation before removing, then deletes', () => {
    const onDelete = vi.fn()
    renderDetail(RECORD, { onDelete })

    fireEvent.click(screen.getByRole('button', { name: 'Remove from crate' }))
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm remove?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove?' }))
    expect(onDelete).toHaveBeenCalledWith('r1')
  })

  it('shows the external Discogs link for items with an id', () => {
    renderDetail(RECORD)

    const link = screen.getByRole('link', { name: 'View on Discogs ↗' })
    expect(link).toHaveAttribute('href', 'https://www.discogs.com/release/101')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('omits the external link for manually added items', () => {
    renderDetail({ ...RECORD, discogsId: null })
    expect(screen.queryByRole('link', { name: /View on Discogs/ })).not.toBeInTheDocument()
  })
})

describe('Detail sheet (books)', () => {
  const BOOK = {
    id: 'b1',
    title: 'Ursula K. Le Guin - A Wizard of Earthsea',
    year: 1968,
    label: 'Parnassus Press',
    googleBooksId: 'abc123',
    infoLink: 'https://books.google.com/books?id=abc123',
    description: 'First Earthsea novel',
    notes: '',
  }

  it('shows a Google Books link for items with an id and none for manual items', () => {
    const { unmount } = render(
      <BookDetail item={BOOK} catalog={booksCatalog} onClose={() => {}} onDelete={() => {}} onSaveNotes={() => {}} />
    )
    expect(screen.getByRole('link', { name: 'View on Google Books ↗' })).toBeInTheDocument()
    unmount()

    render(
      <BookDetail
        item={{ id: 'b2', title: 'Manual - Book', googleBooksId: null, infoLink: '', notes: '' }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={() => {}}
      />
    )
    expect(screen.queryByRole('link', { name: /View on Google Books/ })).not.toBeInTheDocument()
  })

  it('saves notes via onSaveNotes', async () => {
    const onSaveNotes = vi.fn().mockResolvedValue()
    render(
      <BookDetail
        item={{ id: 'b2', title: 'Manual - Book', notes: '' }}
        catalog={booksCatalog}
        onClose={() => {}}
        onDelete={() => {}}
        onSaveNotes={onSaveNotes}
      />
    )

    fireEvent.change(screen.getByPlaceholderText(/Condition/), { target: { value: 'Signed copy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaveNotes).toHaveBeenCalledWith('Signed copy'))
  })
})
