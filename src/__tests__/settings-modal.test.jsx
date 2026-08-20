import { describe, expect, it, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale } from '../i18n'
import SettingsModal from '../components/SettingsModal'

beforeEach(() => {
  localStorage.clear()
  setLocale('en')
})

/**
 * Render SettingsModal wrapped in LocaleProvider.
 * Pass `locale` to pre-set both the module singleton and localStorage.
 */
function renderModal(locale = 'en') {
  if (locale && locale !== 'en') {
    setLocale(locale)
    localStorage.setItem('runout.locale', locale)
  }
  return render(
    <LocaleProvider>
      <SettingsModal onClose={vi.fn()} />
    </LocaleProvider>
  )
}

describe('SettingsModal — i18n', () => {
  it('renders translated headings and labels in the default locale (en)', () => {
    renderModal()

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('renders translated headings and labels in French', () => {
    renderModal('fr')

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Réglages')
    expect(screen.getByRole('heading', { name: 'Réglages' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument()
  })

  it('renders translated headings and labels in Dutch', () => {
    renderModal('nl')

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Instellingen')
    expect(screen.getByRole('heading', { name: 'Instellingen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sluiten' })).toBeInTheDocument()
  })

  it('renders translated headings and labels in German', () => {
    renderModal('de')

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Einstellungen')
    expect(screen.getByRole('heading', { name: 'Einstellungen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schließen' })).toBeInTheDocument()
  })

  it('contains a language <select> with all supported locales', () => {
    renderModal()

    const select = screen.getByRole('combobox')
    expect(select).toBeInTheDocument()
    expect(select.value).toBe('en')

    const options = Array.from(select.querySelectorAll('option'))
    expect(options).toHaveLength(8)
    expect(options.map((o) => o.value)).toEqual([
      'en', 'en-GB', 'fr', 'nl', 'pt-BR', 'de', 'es', 'it',
    ])
    // Endonyms displayed
    expect(options[0].textContent).toBe('English')
    expect(options[2].textContent).toBe('Français')
    expect(options[4].textContent).toBe('Português (Brasil)')
  })

  it('select reflects the current locale from localStorage', () => {
    renderModal('pt-BR')

    const select = screen.getByRole('combobox')
    expect(select.value).toBe('pt-BR')
  })

  it('switches the select value when user changes locale', () => {
    renderModal()

    const select = screen.getByRole('combobox')
    expect(select.value).toBe('en')

    fireEvent.change(select, { target: { value: 'fr' } })
    expect(select.value).toBe('fr')

    fireEvent.change(select, { target: { value: 'nl' } })
    expect(select.value).toBe('nl')
  })

  it('persists the locale choice to localStorage', () => {
    renderModal()

    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'fr' } })

    expect(localStorage.getItem('runout.locale')).toBe('fr')
  })

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn()
    setLocale('en')
    render(
      <LocaleProvider>
        <SettingsModal onClose={onClose} />
      </LocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens the feedback modal from the Feedback card (feat/feedback #82)', () => {
    const onOpenFeedback = vi.fn()
    setLocale('en')
    render(
      <LocaleProvider>
        <SettingsModal onClose={vi.fn()} onOpenFeedback={onOpenFeedback} />
      </LocaleProvider>
    )

    const card = screen.getByRole('button', { name: /Feedback/ })
    expect(card).toBeInTheDocument()
    fireEvent.click(card)
    expect(onOpenFeedback).toHaveBeenCalledTimes(1)
  })
})

describe('SettingsModal — offline-data management (#159)', () => {
  it('does not render the offline-data section when no signed-in userId is provided', () => {
    renderModal()
    expect(screen.queryByText('Clear offline data')).toBeNull()
    expect(screen.queryByText(/Offline data/i)).toBeNull()
  })

  it('renders the offline-data section for a signed-in user', () => {
    render(
      <LocaleProvider>
        <SettingsModal onClose={vi.fn()} userId="u1" />
      </LocaleProvider>
    )
    // The section label and the action button are present.
    expect(screen.getAllByText(/Offline data/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Clear offline data/i })).toBeInTheDocument()
  })

  it('shows a confirmation before clearing, then reports done', async () => {
    render(
      <LocaleProvider>
        <SettingsModal onClose={vi.fn()} userId="u1" />
      </LocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Clear offline data/i }))
    // Confirmation copy shown before the destructive action.
    expect(screen.getByText(/Your online collection is not affected/i)).toBeInTheDocument()

    // The destructive confirm button.
    const confirm = screen.getAllByRole('button', { name: /Clear offline data/i }).at(-1)
    fireEvent.click(confirm)

    expect(await screen.findByText('Offline data cleared')).toBeInTheDocument()
  })

  it('can cancel the confirmation without clearing data', () => {
    render(
      <LocaleProvider>
        <SettingsModal onClose={vi.fn()} userId="u1" />
      </LocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Clear offline data/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Offline data cleared')).toBeNull()
  })

  it('moves focus to the destructive confirm button when confirming clear', () => {
    render(
      <LocaleProvider>
        <SettingsModal onClose={vi.fn()} userId="u1" />
      </LocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Clear offline data/i }))
    const confirm = screen.getAllByRole('button', { name: /Clear offline data/i }).at(-1)
    expect(confirm).toBe(document.activeElement)
  })

  it('moves focus to the status line after clearing completes', async () => {
    render(
      <LocaleProvider>
        <SettingsModal onClose={vi.fn()} userId="u1" />
      </LocaleProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Clear offline data/i }))
    const confirm = screen.getAllByRole('button', { name: /Clear offline data/i }).at(-1)
    fireEvent.click(confirm)

    const done = await screen.findByText('Offline data cleared')
    // The done line is a live-region status announcement and receives focus.
    expect(done).toHaveAttribute('role', 'status')
    expect(done).toBe(document.activeElement)
  })
})
