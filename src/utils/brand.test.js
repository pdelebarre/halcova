import { describe, expect, it } from 'vitest'
import { APP_NAME, BRAND } from './brand.js'

describe('brand', () => {
  it('uses Halcova as the public application name', () => {
    expect(APP_NAME).toBe('Halcova')
    expect(BRAND.name).toBe('Halcova')
    expect(BRAND.shortName).toBe('Halcova')
  })
})
