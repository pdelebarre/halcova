import { describe, expect, it, beforeEach } from 'vitest'
import { getLocalePreference, setLocalePreference } from './locale-pref'

const PREFIX = 'runout.locale.'

beforeEach(() => {
  localStorage.clear()
})

describe('getLocalePreference', () => {
  it('returns null when nothing is stored', () => {
    expect(getLocalePreference('user1')).toBeNull()
  })

  it('returns null when userId is falsy', () => {
    expect(getLocalePreference(null)).toBeNull()
    expect(getLocalePreference(undefined)).toBeNull()
    expect(getLocalePreference('')).toBeNull()
  })
})

describe('setLocalePreference', () => {
  it('stores a value and getLocalePreference returns it', () => {
    setLocalePreference('user1', 'fr')
    expect(getLocalePreference('user1')).toBe('fr')
  })

  it('overwrites a previously stored value', () => {
    setLocalePreference('user1', 'fr')
    setLocalePreference('user1', 'nl')
    expect(getLocalePreference('user1')).toBe('nl')
  })

  it('is a no-op when userId is falsy', () => {
    setLocalePreference(null, 'fr')
    setLocalePreference(undefined, 'fr')
    setLocalePreference('', 'fr')
    // Nothing should be stored
    expect(localStorage.length).toBe(0)
  })
})

describe('per-user scoping', () => {
  it('scopes values per userId — different users get different preferences', () => {
    setLocalePreference('alice', 'fr')
    setLocalePreference('bob', 'nl')

    expect(getLocalePreference('alice')).toBe('fr')
    expect(getLocalePreference('bob')).toBe('nl')
  })

  it('uses the correct key prefix for storage', () => {
    setLocalePreference('user42', 'de')
    expect(localStorage.getItem('runout.locale.user42')).toBe('de')
  })

  it('does not leak between users after clearing one user', () => {
    setLocalePreference('alice', 'fr')
    setLocalePreference('bob', 'nl')

    localStorage.removeItem('runout.locale.alice')

    expect(getLocalePreference('alice')).toBeNull()
    expect(getLocalePreference('bob')).toBe('nl')
  })
})
