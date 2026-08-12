/**
 * Per-user locale preference stored in localStorage.
 *
 * Key: `runout.locale.<userId>`
 *
 * Resolution order (consumed by LocaleProvider):
 *   1. Saved preference in `localStorage.runout.locale.<userId>`
 *   2. `navigator.language`
 *   3. `'en'`
 */

const PREFIX = 'runout.locale.'

/**
 * Get the saved locale preference for a user. Returns null if not set.
 */
export function getLocalePreference(userId) {
  if (!userId) return null
  try {
    return localStorage.getItem(PREFIX + userId) || null
  } catch {
    return null
  }
}

/**
 * Save a locale preference for a user.
 */
export function setLocalePreference(userId, locale) {
  if (!userId) return
  try {
    localStorage.setItem(PREFIX + userId, locale)
  } catch {
    // localStorage unavailable — silently ignore
  }
}
