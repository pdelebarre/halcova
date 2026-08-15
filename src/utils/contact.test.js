import { describe, expect, it } from 'vitest'
import { classifyContact } from './contact'

describe('classifyContact', () => {
  it('classifies a plain phone number (digits / + / spaces) as tel', () => {
    expect(classifyContact('+33 6 12 34 56 78')).toEqual({ type: 'tel', href: 'tel:+33 6 12 34 56 78' })
    expect(classifyContact('0612345678')).toEqual({ type: 'tel', href: 'tel:0612345678' })
    expect(classifyContact('  06 12 34 56 78  ')).toEqual({ type: 'tel', href: 'tel:06 12 34 56 78' })
  })

  it('classifies anything containing @ as email (never tel)', () => {
    expect(classifyContact('alice@example.com')).toEqual({ type: 'email', href: 'mailto:alice@example.com' })
    expect(classifyContact('  alice+work@example.co.uk ')).toEqual({ type: 'email', href: 'mailto:alice+work@example.co.uk' })
  })

  it('treats a non-plain-phone string that parses as a phone as a wa message target', () => {
    expect(classifyContact('WhatsApp 06 12 34 56 78')).toEqual({ type: 'wa', href: 'https://wa.me/0612345678' })
    expect(classifyContact('+1 (555) 123-4567')).toEqual({ type: 'wa', href: 'https://wa.me/15551234567' })
  })

  it('hides the target for missing, empty, or non-phone strings', () => {
    expect(classifyContact('')).toEqual({ type: null, href: null })
    expect(classifyContact('   ')).toEqual({ type: null, href: null })
    expect(classifyContact(undefined)).toEqual({ type: null, href: null })
    expect(classifyContact(null)).toEqual({ type: null, href: null })
    expect(classifyContact('call me')).toEqual({ type: null, href: null })
    // Too few digits to be a phone number — don't misroute.
    expect(classifyContact('12')).toEqual({ type: null, href: null })
  })
})
