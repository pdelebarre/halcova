// visibility.js — privacy, visibility & data-classification model (SEC-7.2,
// #339). The companion to policy.js / filter.js: while policy.js decides WHO
// may act (authorization rules) and filter.js shapes WHAT a DTO carries, this
// module owns the SINGLE explicit per-role ALLOWLIST registry and the
// server-side visibility-state model that both build on.
//
// Enforcement invariant (stated here so it is guaranteed in one place):
//   - Authorization decisions (can a principal read/write object X?) live in
//     policy.js rules only.
//   - The FIELDS that appear in a DTO live in THIS allowlist registry +
//     handler-controlled surfaces (filter.js routes through it).
//   - A rule change never bypasses the filter; a filter change never bypasses
//     the rule. BOTH layers are required before any shared/public surface.
//   - The client NEVER supplies its own visibility. Effective visibility is
//     computed server-side ONLY (resolveVisibility below).
//
// Visibility-state model:
//   enum PRIVATE / OWNER / FOLLOWERS / GROUP / PUBLIC. Today only PRIVATE /
//   OWNER / PUBLIC-to-authenticated are reachable. FOLLOWERS/GROUP are
//   reserved enum values that FAIL CLOSED (resolveVisibility maps them to
//   PRIVATE) until a future social milestone ships — a reserved value can
//   never widen an object's exposure.
//
// Classification matrix (data classes per ADR-0004/0007). Default-private for
// all sensitive ownership info. Each resource maps its fields to a class; the
// allowlists below are the per-role expression of that matrix:
//   C1  public catalog metadata                — may reach public surfaces
//   C2  ownership (id, dateAdded, wishlist)    — owner/admin
//   C3  price                                  — PRIVATE (strip non-owner)
//   C4  location                               — PRIVATE (strip)
//   C5  serial                                 — PRIVATE (strip)
//   C6  receipts                               — PRIVATE (strip)
//   C7  notes (owner+admin) / adminNote (admin)  — both non-public
//   C8  lending/lendingHistory + borrower.contact — owner/admin (contact stripped)
//   C9  review rating/body/authorName          — public to authenticated
//   C10 feedback                               — author + admin only
//   C11 account identity (name, email)         — private self+admin
//   C12 credentials (code/code_hash/tokens/admin key/Stripe ids) — NEVER exported
//   C13 telemetry/audit                        — internal, redacted
//   C14 demo curated data                      — demo identity only, read-only

// The visibility-state enum. Reserved values FOLLOWERS / GROUP are documented
// and fail closed to PRIVATE until a future milestone.
export const VISIBILITY = Object.freeze({
  PRIVATE: 'private',
  OWNER: 'owner',
  FOLLOWERS: 'followers', // reserved — resolves to PRIVATE
  GROUP: 'group',         // reserved — resolves to PRIVATE
  PUBLIC: 'public',
})

// Roles that see EVERYTHING on an owned object (the owner/admin bypass).
export const OWNER_ROLES = new Set(['admin', 'owner'])

// Resolve an effective visibility value server-side. A reserved value
// (FOLLOWERS/GROUP) or an unknown value FAILS CLOSED to PRIVATE — it can never
// widen exposure. The client never supplies visibility; this is called with the
// stored/server-computed value only.
export function resolveVisibility(value) {
  if (value === VISIBILITY.PUBLIC) return VISIBILITY.PUBLIC
  if (value === VISIBILITY.OWNER) return VISIBILITY.OWNER
  return VISIBILITY.PRIVATE // PRIVATE, FOLLOWERS, GROUP, or unknown -> PRIVATE
}

// ---------------------------------------------------------------------------
// Per-resource per-role ALLOWLIST registry.
//
// Each resource exposes the fields an UNAUTHORIZED/other principal may see on
// a DTO. Show the full set for an authorized principal (owner/admin/self). The
// `filterFor` entry point in filter.js consumes these and additionally handles
// nested objects (e.g. lending.borrower.contact) that a flat allowlist can't
// express. Honouring the invariant above: these lists are the ONLY field rules;
// policy.js decides whether a principal reaches the owned surface at all.
// ---------------------------------------------------------------------------

// --- item (records/books collection item) -----------------------------------
// C1 public catalog metadata — may reach public surfaces.
export const ITEM_PUBLIC_FIELDS = Object.freeze([
  'id',
  'title', 'year', 'label', 'genre', 'style', 'country', 'formatType',
  'coverImage', 'barcode', 'discogsId', 'googleBooksId',
  'artists', 'masterId', 'tracklist', 'released',
  'authorsList', 'subtitle', 'series', 'mainCategory', 'snippet', 'pageCount',
  'description', 'catno', 'formatRaw', 'isbn',
  // (RES-1.2 T2, #288) additive fallback id for records — public catalog
  // metadata (C1), same class as discogsId/googleBooksId. MusicBrainz MBID.
  'mbid',
])

// Retained on a non-owner item DTO for parity with #338 (#338 kept them; a
// per-user store means every real item DTO is owner-owned anyway, so these are
// defense-in-depth). `lending` / `lendingHistory` are retained but their
// borrower.contact is stripped (C8) — handled by filter.js.
export const ITEM_NON_OWNER_RETAINED = Object.freeze([
  'dateAdded', 'wishlist', 'lending', 'lendingHistory',
])

// The PRIVATE item fields (C3–C7) that a NON-OWNER must never see. Kept for
// the negative tests (#339 N3) and to document the classification; the 
// allowlist logic in filter.js is what actually enforces the strip.
export const ITEM_PRIVATE_FIELDS = Object.freeze([
  'price', 'serial', 'notes', 'receipts', 'contact', 'location', 'adminNote',
])

// The private-assets / file-ref class (C6-private-assets, SEC-7.3 #340). Any
// field that references stored user files/photos on an item. A NON-OWNER item
// DTO must NEVER carry these — they are stripped by the allowlist in
// filter.js, and asset ids/signed URLs only ever surface via the owner DTO
// and the dedicated asset:sign endpoint. Exported so the negative test can
// assert the strip and future refs can be added here in one place.
export const PRIVATE_ASSET_FIELDS = Object.freeze([
  'assets', 'receipts', 'attachments', 'photoRefs',
])

// --- review ----------------------------------------------------------------
// C9 — public to authenticated: rating/body/authorName/kind/sourceId/
// createdAt/updatedAt. authorId (C2 ownership) is stripped for non-authors;
// status only surfaces via the `mine` entry (the public list returns only
// published rows).
export const REVIEW_PUBLIC_FIELDS = Object.freeze([
  'id', 'rating', 'body', 'authorName', 'kind', 'sourceId', 'createdAt', 'updatedAt',
])

// --- feedback --------------------------------------------------------------
// C10 — author + admin. The AUTHOR-facing DTO never includes adminNote
// (admin-only internal note, C7); the admin inbox/view includes it.
export const FEEDBACK_AUTHOR_FIELDS = Object.freeze([
  'id', 'type', 'category', 'message', 'authorId', 'authorName',
  'url', 'appVersion', 'userAgent', 'status', 'createdAt', 'updatedAt',
])
// adminNote: the internal owner-only note — only present in the ADMIN view.
export const FEEDBACK_ADMIN_ONLY_FIELDS = Object.freeze(['adminNote'])

// --- user ------------------------------------------------------------------
// C11/C12 — account identity is private to self+admin; credentials (code,
// code_hash, Stripe ids) are NEVER exported from any durable user DTO. The
// filter.js 'user' resource delegates to publicUser (see auth.js), which
// strips C12. (The transient code minted on approve/rotate is a controlled
// one-time out-of-band delivery and is intentionally NOT in any durable DTO.)
export const USER_SECRET_FIELDS = Object.freeze([
  'code', 'code_hash', 'stripeCustomerId', 'stripeSubscriptionId', 'stripeCheckoutSessionId',
])

// Helper: true when a principal role sees the OWNED (full) surface of a
// resource — the owner/admin bypass. Members see their own owned surface too
// (own:true is resolved by the caller via filterFor), which is why the bypass
// is keyed on the role here and the per-call `own` flag is consulted in
// filterFor.
export function isOwnerRole(role) {
  return OWNER_ROLES.has(role)
}
