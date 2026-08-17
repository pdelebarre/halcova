// Client for the lending Netlify function: lend / return items from a
// collection. Mirrors src/api/collection.js conventions — same
// `Authorization: Bearer <code>` header, JSON body, and `{ error }` unwrap
// into a thrown Error on non-200. Success returns the full updated item
// (`200 { item }`) from the function, which stores lending state on the item
// blob itself (item.lending / item.lendingHistory).

import { getSessionToken } from '../utils/session'

const FN_URL = '/.netlify/functions/lending'

function authHeaders() {
  const token = getSessionToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function postAction(body) {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data.item
}

// Lend an item to a borrower. Returns the updated item with `lending` set.
// `borrower` is `{ name, contact? }`; `dueOn` is an optional ISO date string.
export async function lend({ collection, itemId, borrower, dueOn }) {
  return postAction({ action: 'lend', collection, itemId, borrower, dueOn })
}

// Mark an item as returned. Returns the updated item with `lending` cleared
// and the loan moved onto `lendingHistory`.
export async function returnItem({ collection, itemId }) {
  return postAction({ action: 'return', collection, itemId })
}
