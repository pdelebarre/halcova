const FN_BASE = '/.netlify/functions/collection'

// The collection API is shared by records and books — the Netlify function
// uses this to pick which blob store to read/write.
function fnUrl(collection, extra = {}) {
  const url = new URL(FN_BASE, window.location.origin)
  url.searchParams.set('collection', collection || 'records')
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== '') url.searchParams.set(k, v)
  })
  return url.pathname + url.search
}

async function handle(res) {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

export async function listItems(collection = 'records') {
  const res = await fetch(fnUrl(collection))
  const data = await handle(res)
  return data.items || []
}

export async function addItem(collection = 'records', item) {
  const res = await fetch(fnUrl(collection), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })
  return handle(res)
}

export async function updateItem(collection = 'records', id, patch) {
  const res = await fetch(fnUrl(collection, { id }), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return handle(res)
}

export async function deleteItem(collection = 'records', id) {
  const res = await fetch(fnUrl(collection, { id }), { method: 'DELETE' })
  return handle(res)
}
