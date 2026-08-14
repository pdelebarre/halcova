// Pagination for GET /collection (T2, ADR-0002 Phase 0). Pure helpers — no
// blob I/O — so the validation and slicing rules are unit-tested in isolation.

// Default page size. Deliberately HIGH so the current client
// (src/api/collection.js listItems / useCollection) is unchanged — it never
// sends limit/offset and still gets the whole collection back.
export const DEFAULT_LIMIT = 1000
// Sane ceiling on `limit` so one request can't ask for a huge blob read.
export const MAX_LIMIT = 1000

// Parse `?limit=` and `?offset=` into { offset, limit }. Values are validated:
// non-negative integers, `limit` capped at MAX_LIMIT. Anything else (missing,
// empty, negative, fractional, non-numeric) falls back to the defaults rather
// than erroring — a bad param never fails a request and never over-reads.
export function parsePagination(searchParams, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const rawLimit = searchParams?.get?.('limit')
  const rawOffset = searchParams?.get?.('offset')
  let limit = defaultLimit
  let offset = 0
  if (rawLimit != null && rawLimit !== '') {
    const n = Number(rawLimit)
    if (Number.isInteger(n) && n >= 0) limit = Math.min(n, maxLimit)
  }
  if (rawOffset != null && rawOffset !== '') {
    const n = Number(rawOffset)
    if (Number.isInteger(n) && n >= 0) offset = n
  }
  return { offset, limit }
}

// Slice an ordered id list to the requested window. Keeps index order.
export function sliceIds(ids, offset, limit) {
  return (ids || []).slice(offset, offset + limit)
}

// The default (unpaginated) page is the only shape the client requests today
// and the only read served from the list cache (T4) — explicit pagination
// params opt out of the cache so paginated reads always see fresh data.
export function isDefaultPage(searchParams) {
  return !searchParams?.has?.('limit') && !searchParams?.has?.('offset')
}
