// ---------------------------------------------------------------------------
// Client-side mirror of the server's item-field contract for CREATE (POST)
// writes (netlify/functions/_shared/item-fields.js `validateItem`): `year` and
// `pageCount` must be integers in range or omitted entirely — a string
// ('1968', '') is rejected with a 400 TYPE_ERROR. Lookup normalizers, manual
// forms and legacy stored items can all carry strings, so every add POST
// funnels the payload through here to coerce or drop those two fields.
//
// This only shapes the payload. It never strips id/dateAdded/notes (callers
// own that) and never logs or exposes credentials.
// ---------------------------------------------------------------------------

function coerceIntOrDelete(item, key, { min, max }) {
  if (!Object.prototype.hasOwnProperty.call(item, key)) return
  const value = item[key]
  if (value === undefined || value === null) {
    delete item[key]
    return
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    delete item[key]
    return
  }
  if (typeof value === 'string' && value.trim() === '') {
    delete item[key]
    return
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isInteger(n) && n >= min && n <= max) item[key] = n
  else delete item[key]
}

// Returns a shallow copy with `year`/`pageCount` coerced to the server's
// integer contract (or removed when absent/invalid). Never mutates the input.
export function sanitizeItemForCreate(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  const out = { ...item }
  coerceIntOrDelete(out, 'year', { min: 1000, max: 2100 })
  coerceIntOrDelete(out, 'pageCount', { min: 0, max: 1000000 })
  return out
}
