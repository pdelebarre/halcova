import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import CreditModal from '../components/CreditModal'

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

/**
 * Render CreditModal wrapped in LocaleProvider.
 * Pass `locale` to pre-set both the module singleton and localStorage.
 */
function renderModal(locale = 'en') {
  if (locale && locale !== 'en') {
    setLocale(locale)
    localStorage.setItem('runout.locale', locale)
  }
  return render(
    <LocaleProvider>
      <CreditModal onClose={vi.fn()} />
    </LocaleProvider>
  )
}

describe('CreditModal', () => {
  it('renders as a dialog with the credits aria-label', () => {
    renderModal()

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Credits')
  })

  it('displays the "Halcova" wordmark', () => {
    renderModal()

    expect(screen.getByText('Halcova')).toBeInTheDocument()
  })

  it('shows the Treasure Nook app mark above the wordmark', () => {
    renderModal()

    const mark = document.querySelector('.credits-mark svg')
    expect(mark).toBeInTheDocument()
    // The mark is the Gothic arch + tilted card — the app's collection-agnostic icon.
    expect(mark.querySelector('path[stroke]')).toBeInTheDocument()
    expect(mark.querySelector('rect[fill]')).toBeInTheDocument()
  })

  it('renders all section headings in English', () => {
    renderModal()

    expect(screen.getByText('About the name')).toBeInTheDocument()
    expect(screen.getByText('Built with')).toBeInTheDocument()
    expect(screen.getByText('Fonts')).toBeInTheDocument()
    expect(screen.getByText('Creator')).toBeInTheDocument()
  })

  it('renders the section headings as <h3> elements', () => {
    renderModal()

    const headings = screen.getAllByRole('heading', { level: 3 })
    expect(headings).toHaveLength(4)
    expect(headings[0]).toHaveTextContent('About the name')
    expect(headings[1]).toHaveTextContent('Built with')
    expect(headings[2]).toHaveTextContent('Fonts')
    expect(headings[3]).toHaveTextContent('Creator')
  })

  it('renders a close button with accessible label', () => {
    renderModal()

    const closeButton = screen.getByRole('button', { name: 'Close' })
    expect(closeButton).toBeInTheDocument()
    expect(closeButton).toHaveTextContent('✕')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    setLocale('en')
    render(
      <LocaleProvider>
        <CreditModal onClose={onClose} />
      </LocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  // --- i18n: translated headings ---

  it('renders section headings in French', () => {
    renderModal('fr')

    expect(screen.getByText('À propos du nom')).toBeInTheDocument()
    expect(screen.getByText('Construit avec')).toBeInTheDocument()
    // 'credits.fonts' and 'credits.creator' may or may not be translated —
    // verify they are non-empty headings
    const h3s = screen.getAllByRole('heading', { level: 3 })
    expect(h3s).toHaveLength(4)
    h3s.forEach((h) => expect(h.textContent).toBeTruthy())
  })

  it('renders section headings in Dutch', () => {
    renderModal('nl')

    expect(screen.getByText('Over de naam')).toBeInTheDocument()
    expect(screen.getByText('Gebouwd met')).toBeInTheDocument()
    const h3s = screen.getAllByRole('heading', { level: 3 })
    expect(h3s).toHaveLength(4)
    h3s.forEach((h) => expect(h.textContent).toBeTruthy())
  })

  it('renders translated close button label in French', () => {
    renderModal('fr')

    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Crédits')
  })

  it('renders translated close button label in German', () => {
    renderModal('de')

    expect(screen.getByRole('button', { name: 'Schließen' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Credits')
  })
})
