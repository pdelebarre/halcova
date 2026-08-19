// filter.js — shared property-level response filtering (SEC-7.1, #338).
//
// A single place that strips private/ownership fields from DTOs before they
// reach the client, generalized from the legacy `publicUser` (which strips the
// access code / hashes / Stripe billing ids from a user object) and the
// reviews `withoutAuthorId` strip.
//
// `filterFor(principal, resource, object)` returns the object with the
// resource's private fields removed UNLESS the principal owns the object.
//
// Two resources:
//   - 'user'   -> strips SECRET_FIELDS (code, code_hash, Stripe ids) from any
//                 user DTO (owner or not) — this is exactly `publicUser`, kept
//                 here so policy consumers share one source of truth.
//   - 'item'   -> strips the private COLLECTION-ITEM fields (price, serial,
//                 notes, receipts, contact, location, adminNote, and
//                 lending.borrower.contact) unless the principal owns the item.
//                 `adminNote` is BOTH unwritable (see ITEM_PROTECTED_FIELDS)
//                 and now non-leakable here too.
//   - 'review' -> strips the internal authorId unless the principal wrote it
//                 (generalizes the old reviews `withoutAuthorId`).
//
// The collection item store is per-user (a member only ever lists their OWN
// items), so in practice item DTOs are always owned — the filter is a
// defense-in-depth guarantee that any future shared/exposed item DTO cannot
// leak the private fields. Reviews are shared, so the authorId strip matters.

import { publicUser } from './auth'

// Private fields on a collection item that must never reach a NON-OWNER's
// DTO. These are stripped regardless of whether the field exists (optional
// field). `notes` is user's private notes; `adminNote` is the internal
// moderation note; `lending.borrower.contact` is the borrower's private phone/
// email. Some (price/serial/receipts/contact/location) are not currently
// client-writable but are enumerated here so a future schema addition can't
// silently leak.
const ITEM_PRIVATE_FIELDS = new Set([
  'price', 'serial', 'notes', 'receipts', 'contact', 'location', 'adminNote',
])

// Strip the private fields from one item object. Deep-copies just the affected
// keys (the rest of the object is returned unchanged).
function stripItemPrivate(item) {
  if (!item || typeof item !== 'object') return item
  const rest = {}
  for (const key of Object.keys(item)) {
    if (ITEM_PRIVATE_FIELDS.has(key)) continue
    if (key === 'lending' && item.lending && typeof item.lending === 'object') {
      if (item.lending.borrower && typeof item.lending.borrower === 'object') {
        rest.lending = { ...item.lending, borrower: { ...item.lending.borrower } }
        delete rest.lending.borrower.contact
      } else {
        rest.lending = item.lending
      }
      continue
    }
    rest[key] = item[key]
  }
  return rest
}

// Filter a single object for a principal. `own` tells the filter whether the
// principal owns the object (e.g. the caller's own item / own review / the
// owner-admin acting on any object). Returns the (possibly stripped) object.
export function filterFor(principal, resource, object, { own = false } = {}) {
  if (object === null || object === undefined) return object
  if (resource === 'user') return publicUser(object)
  if (resource === 'item') {
    // Owner/admin sees everything; a non-owner gets the private fields stripped.
    return own ? object : stripItemPrivate(object)
  }
  if (resource === 'review') {
    if (own) return object
    const rest = { ...object }
    delete rest.authorId
    return rest
  }
  return object
}

// Filter an ARRAY of objects for a principal, with a per-item ownership
// predicate `owns(item)`. Non-owner entries get the resource's private fields
// stripped; the caller's own entries are untouched (so the client can still
// dedupe "mine").
export function filterMany(principal, resource, objects, { owns = () => false } = {}) {
  return objects.map((o) => filterFor(principal, resource, o, { own: owns(o) }))
}
