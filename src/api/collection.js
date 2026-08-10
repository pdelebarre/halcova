const FN_BASE = '/.netlify/functions/collection'

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

export async function listItems() {
  const res = await fetch(FN_BASE)
  const data = await handle(res)
  return data.items || []
}

export async function addItem(item) {
  const res = await fetch(FN_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  })
  return handle(res)
}

export async function updateItem(id, patch) {
  const res = await fetch(`${FN_BASE}?id=${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return handle(res)
}

export async function deleteItem(id) {
  const res = await fetch(`${FN_BASE}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  return handle(res)
}
