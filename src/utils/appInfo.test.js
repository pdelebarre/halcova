import { describe, expect, it } from 'vitest'
import { APP_VERSION, deviceLabel } from './appInfo'

describe('appInfo — feedback auto-context helpers (feat/feedback #82)', () => {
  it('exposes a non-empty app version for the auto-context line', () => {
    expect(typeof APP_VERSION).toBe('string')
    expect(APP_VERSION.length).toBeGreaterThan(0)
  })

  it('maps common user-agents to a short device label', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit')).toBe('iOS')
    expect(deviceLabel('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)')).toBe('iOS')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit')).toBe('Android')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit')).toBe('Windows')
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit')).toBe('macOS')
  })

  it('returns an empty label for an absent or unclassifiable user-agent', () => {
    expect(deviceLabel('')).toBe('')
    expect(deviceLabel('totally unknown')).toBe('')
  })
})
