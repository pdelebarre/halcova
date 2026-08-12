import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ManualAddModal from '../components/ManualAddModal'
import BookManualAddModal from '../components/BookManualAddModal'
import { booksCatalog, recordsCatalog } from '../catalog'

describe('ManualAddModal (records)', () => {
  function renderManual() {
    return render(<ManualAddModal onPick={vi.fn()} onClose={vi.fn()} copy={recordsCatalog.copy} />)
  }

  it('requires a title before a manual record can be added', () => {
    const onPick = vi.fn()
    render(<ManualAddModal onPick={onPick} onClose={vi.fn()} copy={recordsCatalog.copy} />)

    // Skip the Discogs search — go straight to the manual form.
    fireEvent.click(screen.getByText('Skip search — add it by hand'))

    const title = screen.getByLabelText('Title *')
    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))

    const error = screen.getByText('Add a title — give this record a name first.')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveAttribute('id', 'manual-title-error')
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAttribute('aria-describedby', 'manual-title-error')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('clears the title error on the next keystroke', () => {
    renderManual()
    fireEvent.click(screen.getByText('Skip search — add it by hand'))

    const title = screen.getByLabelText('Title *')
    fireEvent.click(screen.getByRole('button', { name: 'Add to crate' }))
    expect(screen.getByText(/Add a title/)).toBeInTheDocument()

    fireEvent.change(title, { target: { value: 'Kind of Blue' } })
    expect(screen.queryByText(/Add a title/)).not.toBeInTheDocument()
    expect(title).toHaveAttribute('aria-invalid', 'false')
    expect(title).not.toHaveAttribute('aria-describedby')
  })
})

describe('BookManualAddModal (books)', () => {
  it('requires a title before a manual book can be added', () => {
    render(<BookManualAddModal onPick={vi.fn()} onClose={vi.fn()} copy={booksCatalog.copy} />)

    fireEvent.click(screen.getByText('Skip search — add it by hand'))

    const title = screen.getByLabelText('Title *')
    fireEvent.click(screen.getByRole('button', { name: 'Add to shelf' }))

    const error = screen.getByText('Add a title — give this book a name first.')
    expect(error).toHaveAttribute('id', 'manual-title-error')
    expect(title).toHaveAttribute('aria-invalid', 'true')
    expect(title).toHaveAttribute('aria-describedby', 'manual-title-error')
  })
})
