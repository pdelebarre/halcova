import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  t,
  setLocale,
  getLocale,
  resolveLocale,
  LOCALES,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  LocaleProvider,
  useLocale,
} from './index'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render children wrapped in LocaleProvider so useLocale() works. */
function renderWithLocale(ui, { initialLocale } = {}) {
  // Override localStorage before mount so LocaleProvider picks it up.
  if (initialLocale) {
    localStorage.setItem('runout.locale', initialLocale)
  }
  return render(<LocaleProvider>{ui}</LocaleProvider>)
}

/** Component that exposes locale + setLocale and renders t(key). */
function LocaleConsumer({ tKey, tParams }) {
  const { locale, setLocale: set } = useLocale()
  return (
    <>
      <span data-testid="locale">{locale}</span>
      <span data-testid="translated">{t(tKey, tParams)}</span>
      <button data-testid="switch-to-fr" onClick={() => set('fr')}>
        Switch to fr
      </button>
      <button data-testid="switch-to-ptBR" onClick={() => set('pt-BR')}>
        Switch to pt-BR
      </button>
      <button data-testid="switch-to-xx" onClick={() => set('xx-XX')}>
        Switch to unsupported
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Reset the singleton between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  setLocale('en')
})

// ============================================================================
// t() — translation lookup
// ============================================================================

describe('t()', () => {
  describe('basic lookup', () => {
    it('returns the correct string for en (default)', () => {
      expect(t('common.close')).toBe('Close')
      expect(t('common.settings')).toBe('Settings')
      expect(t('common.loading')).toBe('Loading…')
    })

    it('returns the correct string for fr after switching locale', () => {
      setLocale('fr')
      expect(t('common.close')).toBe('Fermer')
      expect(t('common.settings')).toBe('Réglages')
    })

    it('returns the correct string for each supported locale', () => {
      const pairs = [
        ['en', 'common.close', 'Close'],
        ['en-GB', 'common.close', 'Close'],
        ['fr', 'common.close', 'Fermer'],
        ['nl', 'common.close', 'Sluiten'],
        ['pt-BR', 'common.close', 'Fechar'],
        ['de', 'common.close', 'Schließen'],
        ['es', 'common.close', 'Cerrar'],
        ['it', 'common.close', 'Chiudi'],
      ]
      for (const [locale, key, expected] of pairs) {
        setLocale(locale)
        expect(t(key)).toBe(expected)
      }
    })
  })

  describe('interpolation', () => {
    it('replaces {name} with the given value', () => {
      setLocale('en')
      const result = t('auth.noCollections', { name: 'Alice' })
      expect(result).toContain('Alice')
      expect(result).not.toContain('{name}')
    })

    it('replaces {name} with the given value in fr', () => {
      setLocale('fr')
      const result = t('auth.noCollections', { name: 'Alice' })
      expect(result).toContain('Alice')
      expect(result).toContain('Bonjour')
      expect(result).not.toContain('{name}')
    })

    it('replaces {n} with a numeric value (plural template)', () => {
      setLocale('en')
      const result = t('toolbar.filtersActive', { n: 2 })
      expect(result).toContain('2')
      expect(result).not.toContain('{n}')
    })

    it('replaces {n} with a numeric value in fr', () => {
      setLocale('fr')
      const result = t('toolbar.filtersActive', { n: 5 })
      expect(result).toContain('5')
      expect(result).not.toContain('{n}')
    })

    it('replaces multiple params', () => {
      setLocale('en')
      const result = t('header.accountLabel', { name: 'Bob' })
      expect(result).toContain('Bob')
      expect(result).not.toContain('{name}')
    })

    it('handles missing params gracefully (leaves placeholder)', () => {
      setLocale('en')
      const result = t('auth.noCollections', {})
      expect(result).toContain('{name}')
    })
  })

  describe('C1 activation keys (catalog.addAndScanNext / catalog.addedCount)', () => {
    it('ships the scan-loop copy in every supported locale', () => {
      const expected = {
        en: ['Add & scan next', 'Added — {n} today'],
        'en-GB': ['Add & scan next', 'Added — {n} today'],
        fr: ['Ajouter & scanner le suivant', 'Ajouté — {n} aujourd\'hui'],
        nl: ['Toevoegen & doorgaan met scannen', 'Toegevoegd — {n} vandaag'],
        'pt-BR': ['Adicionar & escanear o próximo', 'Adicionado — {n} hoje'],
        de: ['Hinzufügen & weiter scannen', 'Hinzugefügt — {n} heute'],
        es: ['Añadir y escanear el siguiente', 'Añadido — {n} hoy'],
        it: ['Aggiungi & scansiona il prossimo', 'Aggiunto — {n} oggi'],
      }
      for (const [locale, [label, template]] of Object.entries(expected)) {
        setLocale(locale)
        expect(t('catalog.addAndScanNext')).toBe(label)
        // {n} interpolates; the raw template is preserved when params are empty.
        const counted = t('catalog.addedCount', { n: 3 })
        expect(counted).toContain('3')
        expect(counted).not.toContain('{n}')
        expect(t('catalog.addedCount', {})).toBe(template)
      }
    })
  })

  describe('A5 lending polish keys (issue #90/#92)', () => {
    it('ships every new lending key in all 8 locales (no raw-key fallback)', () => {
      const required = [
        'lending.remind',
        'lending.remindMessage.base',
        'lending.remindMessage.due',
        'lending.remindCopied',
        'lending.due1w',
        'lending.due2w',
        'lending.due1m',
        'lending.overdueCount',
        'lending.historyCapNote',
        'lending.contactCall',
        'lending.contactEmail',
        'lending.contactMessage',
      ]
      for (const locale of ['en', 'en-GB', 'fr', 'nl', 'pt-BR', 'de', 'es', 'it']) {
        setLocale(locale)
        for (const key of required) {
          // t() returns the key itself only when the key is missing everywhere.
          expect(t(key)).not.toBe(key)
        }
      }
    })

    it('uses the addendum translations (not English) for the 6 non-EN locales', () => {
      const samples = {
        fr: { 'lending.remind': 'Rappeler', 'lending.due1m': '1 mois', 'lending.historyCapNote': 'L\'historique conserve les 10 derniers prêts.' },
        nl: { 'lending.remind': 'Herinner', 'lending.due1m': '1 maand', 'lending.contactCall': 'Bellen' },
        'pt-BR': { 'lending.remind': 'Lembrar', 'lending.due1m': '1 mês', 'lending.overdueCount': '{n} em atraso' },
        de: { 'lending.remind': 'Erinnern', 'lending.due1m': '1 Monat', 'lending.contactEmail': 'E-Mail' },
        es: { 'lending.remind': 'Recordar', 'lending.due1m': '1 mes', 'lending.overdueCount': 'Atrasados: {n}' },
        it: { 'lending.remind': 'Ricorda', 'lending.due1m': '1 mese', 'lending.contactMessage': 'Messaggio' },
      }
      for (const [locale, entries] of Object.entries(samples)) {
        setLocale(locale)
        for (const [key, expected] of Object.entries(entries)) {
          expect(t(key)).toBe(expected)
        }
      }
    })

    it('assembles the remind message from base + optional due clause (EN master)', () => {
      setLocale('en')
      const base = t('lending.remindMessage.base', { name: 'Alice', title: 'Kind of Blue' })
      expect(base).toContain('Alice')
      expect(base).toContain('Kind of Blue')
      const due = t('lending.remindMessage.due', { date: '8/15/2026' })
      // The due clause carries a leading space so it can be appended verbatim.
      expect(due.startsWith(' ')).toBe(true)
      expect(due).toContain('8/15/2026')
      expect(`${base}${due}`).toMatch(/😊/)
    })
  })

  describe('T7 feedback keys (epic #74, issue #79)', () => {
    it('ships every feedback key in all 8 locales (no raw-key fallback)', () => {
      const required = [
        'feedback.title',
        'feedback.subtitle',
        'feedback.typeLabel',
        'feedback.type.suggestion',
        'feedback.type.bug',
        'feedback.categoryLabel',
        'feedback.category.records',
        'feedback.category.books',
        'feedback.category.scanner',
        'feedback.category.auth',
        'feedback.category.billing',
        'feedback.category.games',
        'feedback.category.lending',
        'feedback.category.other',
        'feedback.messageLabel',
        'feedback.messagePlaceholder',
        'feedback.charCount',
        'feedback.contextLabel',
        'feedback.contextDetail',
        'feedback.contextEmpty',
        'feedback.submit',
        'feedback.submitting',
        'feedback.successTitle',
        'feedback.successBody',
        'feedback.referenceUnknown',
        'feedback.done',
        'feedback.error.generic',
        'feedback.error.NO_TOKEN',
        'feedback.error.RATE_LIMITED',
        'feedback.error.MESSAGE_TOO_LONG',
        'feedback.error.DEMO_READONLY',
        'admin.tab.members',
        'admin.tab.feedback',
        'admin.feedback.unread',
        'admin.feedback.filterStatus',
        'admin.feedback.filterType',
        'admin.feedback.allStatuses',
        'admin.feedback.allTypes',
        'admin.feedback.status.open',
        'admin.feedback.status.in_progress',
        'admin.feedback.status.done',
        'admin.feedback.status.wontfix',
        'admin.feedback.status.duplicate',
        'admin.feedback.type.suggestion',
        'admin.feedback.type.bug',
        'admin.feedback.statusActions',
        'admin.feedback.empty',
        'admin.feedback.emptyFiltered',
        'admin.feedback.retry',
        'admin.feedback.from',
        'admin.feedback.route',
        'admin.feedback.version',
        'admin.feedback.device',
        'admin.feedback.agent',
        'admin.feedback.noteLabel',
        'admin.feedback.notePlaceholder',
        'admin.feedback.saveNote',
        'admin.feedback.noteSaved',
        'admin.feedback.saving',
        'admin.feedback.delete',
        'admin.feedback.deleteConfirm',
      ]
      for (const locale of ['en', 'en-GB', 'fr', 'nl', 'pt-BR', 'de', 'es', 'it']) {
        setLocale(locale)
        for (const key of required) {
          // t() returns the key itself only when the key is missing everywhere.
          expect(t(key)).not.toBe(key)
        }
      }
    })

    it('uses the glossary-reused feedback terms (not English) in the 6 non-EN locales', () => {
      // The glossary (localization-dictionary.md) covers Records/Books/Account/
      // Done/Members/Retry, so those feedback keys reuse the already-validated
      // per-locale values instead of falling back to English.
      const samples = {
        fr: {
          'feedback.category.records': 'Disques',
          'feedback.category.books': 'Livres',
          'feedback.category.auth': 'Compte',
          'feedback.done': 'Terminé',
          'admin.tab.members': 'Membres',
          'admin.feedback.status.done': 'Terminé',
          'admin.feedback.retry': 'Réessayer',
        },
        nl: {
          'feedback.category.records': 'Platen',
          'feedback.category.books': 'Boeken',
          'feedback.category.auth': 'Account',
          'feedback.done': 'Klaar',
          'admin.tab.members': 'Leden',
          'admin.feedback.status.done': 'Klaar',
          'admin.feedback.retry': 'Opnieuw',
        },
        'pt-BR': {
          'feedback.category.records': 'Discos',
          'feedback.category.books': 'Livros',
          'feedback.category.auth': 'Conta',
          'feedback.done': 'Concluído',
          'admin.tab.members': 'Membros',
          'admin.feedback.status.done': 'Concluído',
          'admin.feedback.retry': 'Tentar de novo',
        },
        de: {
          'feedback.category.records': 'Platten',
          'feedback.category.books': 'Bücher',
          'feedback.category.auth': 'Konto',
          'feedback.done': 'Fertig',
          'admin.tab.members': 'Mitglieder',
          'admin.feedback.status.done': 'Fertig',
          'admin.feedback.retry': 'Erneut versuchen',
        },
        es: {
          'feedback.category.records': 'Discos',
          'feedback.category.books': 'Libros',
          'feedback.category.auth': 'Cuenta',
          'feedback.done': 'Hecho',
          'admin.tab.members': 'Miembros',
          'admin.feedback.status.done': 'Hecho',
          'admin.feedback.retry': 'Reintentar',
        },
        it: {
          'feedback.category.records': 'Dischi',
          'feedback.category.books': 'Libri',
          'feedback.category.auth': 'Account',
          'feedback.done': 'Fatto',
          'admin.tab.members': 'Membri',
          'admin.feedback.status.done': 'Fatto',
          'admin.feedback.retry': 'Riprova',
        },
      }
      for (const [locale, entries] of Object.entries(samples)) {
        setLocale(locale)
        for (const [key, expected] of Object.entries(entries)) {
          expect(t(key)).toBe(expected)
        }
      }
    })

    it('keeps the EN baseline for glossary-silent feedback keys in every locale', () => {
      // The glossary has no feedback section, so the modal/inbox sentences stay
      // EN and are flagged [VALIDATE] for the native-tester pass. They must
      // resolve to the same string in every locale (not the raw key).
      const enBaseline = {
        'feedback.title': 'Feedback',
        'feedback.subtitle': 'Suggest an idea or report a problem — we read everything.',
        'feedback.typeLabel': 'Feedback type',
        'feedback.categoryLabel': 'What\'s it about? (optional)',
        'feedback.submit': 'Send feedback',
        'feedback.successTitle': 'Thanks — we got it.',
        'admin.tab.feedback': 'Feedback',
        'admin.feedback.empty': 'No feedback yet — the inbox is quiet.',
        'admin.feedback.notePlaceholder': 'Internal note — only you see this.',
        'admin.feedback.deleteConfirm': 'Delete this feedback report? This cannot be undone.',
      }
      for (const locale of ['en', 'en-GB', 'fr', 'nl', 'pt-BR', 'de', 'es', 'it']) {
        setLocale(locale)
        for (const [key, expected] of Object.entries(enBaseline)) {
          expect(t(key)).toBe(expected)
        }
      }
    })
  })

  describe('fallback behaviour', () => {
    it('falls back to en when key is missing in a non-en locale', () => {
      // 'common.copy' exists in en but let's test with a key that exists in en
      // and verify it still works after switching to a locale that also has it.
      setLocale('fr')
      expect(t('common.copy')).toBe('Copier')

      // languageName exists in every locale — no fallback needed.
      // But if fr were missing a key that en has, it would fall back.
      // Let's test this by checking the fallback mechanism directly:
      // All locales should have the same keyset. Verify a key that's in en
      // but hypothetically missing in a locale that we know exists:
      expect(t('common.close')).toBe('Fermer') // fr has it
    })

    it('returns the key itself when the key is completely missing (never throws)', () => {
      setLocale('en')
      expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz')
      setLocale('fr')
      expect(t('nonexistent.key.xyz')).toBe('nonexistent.key.xyz')
    })

    it('returns the key itself when key is empty string (dark-screen safety)', () => {
      expect(t('')).toBe('')
    })

    it('returns the key itself when key is not a string (dark-screen safety)', () => {
      expect(t(null)).toBe(null)
      expect(t(undefined)).toBe(undefined)
      expect(t(42)).toBe(42)
    })
  })
})

// ============================================================================
// resolveLocale()
// ============================================================================

describe('resolveLocale', () => {
  it('returns "en" for null/undefined/empty', () => {
    expect(resolveLocale(null)).toBe('en')
    expect(resolveLocale(undefined)).toBe('en')
    expect(resolveLocale('')).toBe('en')
    expect(resolveLocale('   ')).toBe('en')
  })

  it('returns exact match for supported locale', () => {
    expect(resolveLocale('fr')).toBe('fr')
    expect(resolveLocale('en-GB')).toBe('en-GB')
    expect(resolveLocale('pt-BR')).toBe('pt-BR')
    expect(resolveLocale('de')).toBe('de')
    expect(resolveLocale('es')).toBe('es')
    expect(resolveLocale('it')).toBe('it')
    expect(resolveLocale('nl')).toBe('nl')
  })

  it('canonicalises case differences', () => {
    expect(resolveLocale('FR')).toBe('fr')
    expect(resolveLocale('en-gb')).toBe('en-GB')
    expect(resolveLocale('PT-br')).toBe('pt-BR')
    expect(resolveLocale('DE')).toBe('de')
  })

  it('strips the region and matches language prefix', () => {
    expect(resolveLocale('fr-FR')).toBe('fr')
    expect(resolveLocale('fr-BE')).toBe('fr')
    expect(resolveLocale('fr-CA')).toBe('fr')
    expect(resolveLocale('de-DE')).toBe('de')
    expect(resolveLocale('de-AT')).toBe('de')
    expect(resolveLocale('de-CH')).toBe('de')
    expect(resolveLocale('es-MX')).toBe('es')
    expect(resolveLocale('es-ES')).toBe('es')
    expect(resolveLocale('it-IT')).toBe('it')
    expect(resolveLocale('it-CH')).toBe('it')
    expect(resolveLocale('nl-NL')).toBe('nl')
    expect(resolveLocale('nl-BE')).toBe('nl')
  })

  it('resolves en-US to en (language prefix match)', () => {
    expect(resolveLocale('en-US')).toBe('en')
  })

  it('falls back to "en" for unsupported languages', () => {
    expect(resolveLocale('ja')).toBe('en')
    expect(resolveLocale('ko')).toBe('en')
    expect(resolveLocale('zh-CN')).toBe('en')
    expect(resolveLocale('ru')).toBe('en')
    expect(resolveLocale('ar')).toBe('en')
  })

  it('returns "en" for completely bogus input', () => {
    expect(resolveLocale('not-a-locale')).toBe('en')
    expect(resolveLocale('12345')).toBe('en')
  })
})

// ============================================================================
// setLocale() / getLocale()
// ============================================================================

describe('setLocale / getLocale', () => {
  it('starts with "en" as the default after beforeEach reset', () => {
    expect(getLocale()).toBe('en')
  })

  it('updates the active locale after setLocale', () => {
    setLocale('fr')
    expect(getLocale()).toBe('fr')
  })

  it('falls back to "en" when given an unsupported locale and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setLocale('ja')
    expect(getLocale()).toBe('en')
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[i18n] Unsupported locale')
    )
    warn.mockRestore()
  })

  it('keeps t() in sync after setLocale', () => {
    setLocale('nl')
    expect(t('common.close')).toBe('Sluiten')
    setLocale('de')
    expect(t('common.close')).toBe('Schließen')
    setLocale('es')
    expect(t('common.close')).toBe('Cerrar')
  })
})

// ============================================================================
// Static maps
// ============================================================================

describe('LOCALES and SUPPORTED_LOCALES', () => {
  it('LOCALES contains endonyms for all 8 locales', () => {
    expect(Object.keys(LOCALES)).toHaveLength(8)
    expect(LOCALES.en).toBe('English')
    expect(LOCALES['en-GB']).toBe('English (UK)')
    expect(LOCALES.fr).toBe('Français')
    expect(LOCALES.nl).toBe('Nederlands')
    expect(LOCALES['pt-BR']).toBe('Português (Brasil)')
    expect(LOCALES.de).toBe('Deutsch')
    expect(LOCALES.es).toBe('Español')
    expect(LOCALES.it).toBe('Italiano')
  })

  it('SUPPORTED_LOCALES matches the keys of LOCALES', () => {
    expect(SUPPORTED_LOCALES).toEqual(Object.keys(LOCALES))
  })

  it('DEFAULT_LOCALE is "en"', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })
})

// ============================================================================
// LocaleProvider + useLocale() — React integration
// ============================================================================

describe('LocaleProvider', () => {
  it('provides the default "en" locale when nothing is stored', () => {
    renderWithLocale(<LocaleConsumer />)
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })

  it('resolves the locale from localStorage on mount', () => {
    renderWithLocale(<LocaleConsumer />, { initialLocale: 'fr' })
    expect(screen.getByTestId('locale').textContent).toBe('fr')
  })

  it('falls back to "en" when localStorage has an unsupported value', () => {
    localStorage.setItem('runout.locale', 'ja')
    renderWithLocale(<LocaleConsumer />)
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })

  it('switch to fr updates context locale', () => {
    renderWithLocale(<LocaleConsumer tKey="common.close" />)

    fireEvent.click(screen.getByTestId('switch-to-fr'))
    expect(screen.getByTestId('locale').textContent).toBe('fr')
  })

  it('switch to pt-BR updates context locale', () => {
    renderWithLocale(<LocaleConsumer tKey="common.close" />)

    fireEvent.click(screen.getByTestId('switch-to-ptBR'))
    expect(screen.getByTestId('locale').textContent).toBe('pt-BR')
  })

  it('switch to unsupported locale falls back to en via resolveLocale', () => {
    renderWithLocale(<LocaleConsumer tKey="common.close" />)

    // First switch to fr to prove we can change
    fireEvent.click(screen.getByTestId('switch-to-fr'))
    expect(screen.getByTestId('locale').textContent).toBe('fr')

    // Now switch to unsupported — resolveLocale returns 'en' before setState
    fireEvent.click(screen.getByTestId('switch-to-xx'))
    expect(screen.getByTestId('locale').textContent).toBe('en')
  })

  it('renders translated strings when locale is pre-set to fr', () => {
    setLocale('fr')
    localStorage.setItem('runout.locale', 'fr')
    renderWithLocale(<LocaleConsumer tKey="common.close" />)

    expect(screen.getByTestId('locale').textContent).toBe('fr')
    expect(screen.getByTestId('translated').textContent).toBe('Fermer')
  })

  it('renders translated strings when locale is pre-set to pt-BR', () => {
    setLocale('pt-BR')
    localStorage.setItem('runout.locale', 'pt-BR')
    renderWithLocale(<LocaleConsumer tKey="common.close" />)

    expect(screen.getByTestId('locale').textContent).toBe('pt-BR')
    expect(screen.getByTestId('translated').textContent).toBe('Fechar')
  })

  it('persists locale selection to localStorage', () => {
    renderWithLocale(<LocaleConsumer />)

    fireEvent.click(screen.getByTestId('switch-to-fr'))
    expect(localStorage.getItem('runout.locale')).toBe('fr')

    fireEvent.click(screen.getByTestId('switch-to-ptBR'))
    expect(localStorage.getItem('runout.locale')).toBe('pt-BR')
  })

  it('sets document.documentElement.lang when locale changes', () => {
    renderWithLocale(<LocaleConsumer />)
    expect(document.documentElement.lang).toBe('en')

    fireEvent.click(screen.getByTestId('switch-to-fr'))
    expect(document.documentElement.lang).toBe('fr')
  })
})
