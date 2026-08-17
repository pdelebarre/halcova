import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocaleProvider, setLocale, getLocale } from '../i18n'
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
