// A5.1 contact classifier (lending polish) — turn a borrower's stored
// contact string into a one-tap action. Pure function, unit-testable; no DOM
// or navigator here, so the classification rules live in one place.
//
//   classifyContact('+33 6 12 34 56 78')  → { type: 'tel',  href: 'tel:+33 6 12 34 56 78' }
//   classifyContact('0612345678')         → { type: 'tel',  href: 'tel:0612345678' }
//   classifyContact('alice@example.com')  → { type: 'email', href: 'mailto:alice@example.com' }
//   classifyContact('wa: 06 12 34 56 78') → { type: 'wa',   href: 'https://wa.me/0612345678' }
//   classifyContact('call me')            → { type: null,  href: null }
//
// Rules (from marketing/specs/lending-polish-and-reminders.md A5.1):
//   - contains '@'            → email (mailto:) — an email must never be
//                               misrouted to a tel: link.
//   - digits / '+' / spaces   → phone (tel:) — native click-to-call.
//   - otherwise               → generic message target (WhatsApp) via
//                               https://wa.me/<digits> when the digits parse
//                               as a phone number; otherwise hide the target.

/** Minimum digit count before a string is treated as a phone number. */
const MIN_DIGITS = 7

/**
 * Classify a contact string into an actionable one-tap target.
 *
 * @param {string|undefined|null} contact - The stored borrower contact.
 * @returns {{ type: 'tel'|'email'|'wa'|null, href: string|null }}
 */
export function classifyContact(contact) {
  const raw = String(contact ?? '').trim()
  if (!raw) return { type: null, href: null }

  // Email: anything containing '@' is a mailto target. Checked first so an
  // email address is never misrouted to tel: or wa.me.
  if (raw.includes('@')) return { type: 'email', href: `mailto:${raw}` }

  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length < MIN_DIGITS) return { type: null, href: null }

  // A plain phone number — only digits, an optional leading '+' and spaces —
  // is a native click-to-call target.
  if (/^\+?[\d\s]+$/.test(raw)) return { type: 'tel', href: `tel:${raw}` }

  // Otherwise it's a generic message target (WhatsApp) on the parsed digits.
  return { type: 'wa', href: `https://wa.me/${digits}` }
}
