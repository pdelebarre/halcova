import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from './locales/en'
import enGB from './locales/en-GB'
import fr from './locales/fr'
import nl from './locales/nl'
import ptBR from './locales/pt-BR'
import de from './locales/de'
import es from './locales/es'
import it from './locales/it'

// ============================================================================
// Static maps
// ============================================================================

/** Endonyms — used in the language switcher UI. */
export const LOCALES = {
  en: 'English',
  'en-GB': 'English (UK)',
  fr: 'Français',
  nl: 'Nederlands',
  'pt-BR': 'Português (Brasil)',
  de: 'Deutsch',
  es: 'Español',
  it: 'Italiano',
}

/** Ordered list of supported locale codes. */
export const SUPPORTED_LOCALES = Object.keys(LOCALES)

/** The default (fallback) locale. */
export const DEFAULT_LOCALE = 'en'

// ============================================================================
// Dictionary lookup — all locales loaded statically (tree-shakeable).
// ============================================================================

const DICTIONARIES = {
  en,
  'en-GB': enGB,
  fr,
  nl,
  'pt-BR': ptBR,
  de,
  es,
  it,
}

/** The fallback dictionary (always en). */
const FALLBACK = DICTIONARIES.en

// ============================================================================
// Module-level singleton — mutable so non-component code can call t().
// ============================================================================

let currentLocale = DEFAULT_LOCALE

/**
 * Set the active locale on the singleton. Intended to be called by
 * `<LocaleProvider>` on mount and by the language switcher on change.
 */
export function setLocale(locale) {
  if (!DICTIONARIES[locale]) {
    console.warn(`[i18n] Unsupported locale "${locale}", falling back to "${DEFAULT_LOCALE}"`)
    currentLocale = DEFAULT_LOCALE
    return
  }
  currentLocale = locale
}

/**
 * The active locale (read-only for consumers that need locale-aware formatting).
 */
export function getLocale() {
  return currentLocale
}

// ============================================================================
// Interpolation helpers
// ============================================================================

const PLURAL_RULES = {}

function getPluralRule(locale) {
  if (!PLURAL_RULES[locale]) {
    try {
      PLURAL_RULES[locale] = new Intl.PluralRules(locale)
    } catch {
      PLURAL_RULES[locale] = new Intl.PluralRules('en')
    }
  }
  return PLURAL_RULES[locale]
}

/**
 * Simple plural form for `{n}` — some locales need different forms.
 * For now, just use the same template for all. `Intl.PluralRules` is used
 * to select the right form when different plurals exist in the locale.
 */
function resolvePlural(template, count) {
  // If the template doesn't look like it has plural variants, just interpolate.
  if (typeof template === 'string') return template.replace(/\{n\}/g, String(count))
  return String(count)
}

// ============================================================================
// t() — the main translation function
// ============================================================================

/**
 * Look up a translation key in the active locale dictionary.
 *
 * - Looks up the key in the current locale's dictionary
 * - Falls back to the en dictionary
 * - Falls back to the key itself (never throws — dark-screen safety)
 * - Supports ICU-lite interpolation: `{name}`, `{n}`, `{date}`, `{status}`,
 *   `{error}`, `{lookupName}`, `{artistLabel}`, `{collectionLabel}`,
 *   `{album}`, `{artist}`, `{status}`
 *
 * @param {string} key - The translation key (e.g., 'common.loading')
 * @param {Record<string, string|number>} [params] - Interpolation values
 * @returns {string}
 */
export function t(key, params = {}) {
  if (typeof key !== 'string' || !key) return key

  const dict = DICTIONARIES[currentLocale]
  let value = (dict && dict[key]) ?? FALLBACK[key] ?? key

  // If the resolved value is not a string, it's the key itself — bail.
  if (typeof value !== 'string') return key

  // Interpolate params
  for (const [p, v] of Object.entries(params)) {
    value = value.replace(new RegExp(`\\{${p}\\}`, 'g'), String(v ?? ''))
  }

  return value
}

// ============================================================================
// resolveLocale — map browser language to the nearest supported locale
// ============================================================================

/**
 * Map a raw language tag (e.g. "fr-FR", "pt", "nl-BE") to the nearest
 * supported locale in our set. Returns DEFAULT_LOCALE on no match.
 */
export function resolveLocale(preference) {
  if (!preference) return DEFAULT_LOCALE
  const raw = String(preference).trim()
  if (!raw) return DEFAULT_LOCALE

  // Exact match first
  if (DICTIONARIES[raw]) return raw

  // Try canonicalizing: "en-gb" → "en-GB", "PT-br" → "pt-BR"
  const canonical = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === raw.toLowerCase())
  if (canonical) return canonical

  // Try language-only prefix: "fr-FR" → "fr", "pt-PT" → "pt"
  const lang = raw.split('-')[0].toLowerCase()
  const langOnly = SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(lang))
  if (langOnly) return langOnly

  return DEFAULT_LOCALE
}

// ============================================================================
// React integration — LocaleContext + LocaleProvider + useLocale
// ============================================================================

export const LocaleContext = createContext({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
})

/**
 * Hook: access the current locale and a setter from within any React component.
 */
export function useLocale() {
  return useContext(LocaleContext)
}

/**
 * Provider that resolves the initial locale from localStorage →
 * navigator.language → 'en', sets the module-level singleton, and
 * provides the locale + setter to the React tree via context.
 */
export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    // Resolution order: saved preference → browser language → 'en'
    try {
      const saved = localStorage.getItem('runout.locale')
      if (saved && DICTIONARIES[saved]) return saved
    } catch { /* localStorage unavailable */ }

    const browser = typeof navigator !== 'undefined' ? navigator.language : ''
    return resolveLocale(browser)
  })

  // Keep the module-level singleton in sync so non-component code can use t().
  useEffect(() => {
    setLocale(locale)
    document.documentElement.lang = locale
    try {
      localStorage.setItem('runout.locale', locale)
    } catch { /* ignore */ }
  }, [locale])

  const changeLocale = useCallback((newLocale) => {
    const resolved = resolveLocale(newLocale)
    setLocaleState(resolved)
  }, [])

  const value = useMemo(() => ({ locale, setLocale: changeLocale }), [locale, changeLocale])

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  )
}
