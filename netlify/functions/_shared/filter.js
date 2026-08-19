// filter.js — shared property-level response filtering (SEC-7.1 #338,
// SEC-7.2 #339).
//
// A single place that applies PER-ROLE ALLOWLISTS to DTOs before they reach
// the client. The allowlist registry lives in visibility.js; this module is the
// entry point that maps an object + principal through the right allowlist, and
// it owns the nested-object handling (e.g. lending.borrower.contact) that a
// flat list can't express. It generalizes the legacy `publicUser` (user) and
// the reviews `withoutAuthorId` (review) strips.
//
// `filterFor(principal, resource, object, opts)` returns the object shaped by
// the resource's allowlist for that principal. Supported resources:
//   - 'user'     -> strips SECRET/credential fields (C12) from any user DTO —
//                   exactly `publicUser`, kept here so policy consumers share
//                   one source of truth.
//   - 'item'     -> a non-owner gets the C1 + retained allowlist (price/serial/
//                   notes/receipts/contact/location/adminNote stripped, and
//                   lending.borrower.contact + lendingHistory[].borrower.contact
//                   stripped); the owner/admin/self gets the full object.
//   - 'review'   -> strips the internal authorId (C2) unless the principal is
//                   the author (own); status only surfaces via `mine`.
//   - 'feedback' -> the AUTHOR-facing DTO never includes adminNote (admin-only,
//                   C7); the ADMIN view (`admin: true`) includes it.
//
// Enforcement invariant (SEC-7.2, #339): authorization lives in policy.js
// rules; WHAT fields appear in a DTO live in these allowlists + handler-
// controlled surfaces. A rule change never bypasses the filter; a filter
// change never bypasses the rule. Both layers are required for any shared or
// public surface.

import { publicUser } from './auth'
import { ITEM_NON_OWNER_RETAINED, ITEM_PUBLIC_FIELDS, PRIVATE_ASSET_FIELDS } from './visibility'

// The allowlisted top-level fields on a NON-OWNER item DTO: C1 public catalog
// metadata + the retained ownership-adjacent keys. Everything else (C3–C7:
// price/serial/notes/receipts/contact/location/adminNote, plus any future
// private field) is dropped — an EXPLICIT per-role allowlist, not a strip.
const ITEM_NON_OWNER_FIELDS = new Set([...ITEM_PUBLIC_FIELDS, ...ITEM_NON_OWNER_RETAINED])

// SEC-7.3 (#340): the private-assets class (assets/receipts/attachments/
// photoRefs) is NOT in the non-owner allowlist, so it is dropped by the
// allowlist above. This set is asserted here so the ownership of that strip is
// explicit and auditable — a future edit that adds a file-ref field to the
// non-owner DTO will also have to update this guard.
const PRIVATE_ASSET_SET = new Set(PRIVATE_ASSET_FIELDS)
for (const field of PRIVATE_ASSET_SET) {
  if (ITEM_NON_OWNER_FIELDS.has(field)) {
    throw new Error(`Security invariant violated: private asset field "${field}" leaked into the non-owner item allowlist`)
  }
}

// Strip the C8 borrower.contact from a single lending object while keeping the
// rest (the borrower name and timestamps stay public on an owned surface).
function stripBorrowerContact(lending) {
  if (!lending || typeof lending !== 'object') return lending
  if (lending.borrower && typeof lending.borrower === 'object') {
    const borrower = { ...lending.borrower }
    delete borrower.contact
    return { ...lending, borrower }
  }
  return lending
}

// Strip borrower.contact from every entry of a lendingHistory array (C8).
function stripHistoryContacts(history) {
  if (!Array.isArray(history)) return history
  return history.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    if (entry.borrower && typeof entry.borrower === 'object') {
      const borrower = { ...entry.borrower }
      delete borrower.contact
      return { ...entry, borrower }
    }
    return entry
  })
}

// Shape a clean NON-OWNER item DTO: only allowlisted top-level fields, with the
// lending objects present but their borrower.contact stripped. Unknown or
// private fields are dropped entirely.
function shapeNonOwnerItem(item) {
  const out = {}
  for (const key of Object.keys(item)) {
    if (!ITEM_NON_OWNER_FIELDS.has(key)) continue
    const value = item[key]
    if (key === 'lending') {
      out.lending = stripBorrowerContact(value)
    } else if (key === 'lendingHistory') {
      out.lendingHistory = stripHistoryContacts(value)
    } else {
      out[key] = value
    }
  }
  return out
}

// Filter a single object for a principal. `own` tells the filter whether the
// principal owns the object (e.g. the caller's own item / own review). `admin`
// selects the admin view where the resource differentiates it (feedback).
export function filterFor(principal, resource, object, { own = false, admin = false } = {}) {
  if (object === null || object === undefined) return object
  if (resource === 'user') return publicUser(object)
  if (resource === 'item') {
    // Owner/self sees everything; a non-owner gets the explicit C1 + retained
    // allowlist (private fields + borrower.contact stripped).
    return own ? object : shapeNonOwnerItem(object)
  }
  if (resource === 'review') {
    if (own) return object
    const rest = { ...object }
    delete rest.authorId
    return rest
  }
  if (resource === 'feedback') {
    // The ADMIN view (inbox / triage) carries the internal adminNote; the
    // AUTHOR-facing view never does — adminNote is admin-only by construction
    // (C7). This holds regardless of `own`.
    if (admin === true) return object
    const rest = { ...object }
    delete rest.adminNote
    return rest
  }
  return object
}

// Filter an ARRAY of objects for a principal, with a per-item ownership
// predicate `owns(item)`. Non-owner entries get the resource's allowlist
// applied; the caller's own entries are untouched (so the client can still
// dedupe "mine").
export function filterMany(principal, resource, objects, { owns = () => false, admin = false } = {}) {
  return objects.map((o) => filterFor(principal, resource, o, { own: owns(o), admin }))
}
