// One-shot seeder for the public demo space. Reachable ONLY with the admin key
// (`Authorization: Bearer RUNOUT_ADMIN_KEY` — a 401 otherwise). Seeds the
// shared demo stores (collection-demo-records / collection-demo-books, via
// storeNameFor('demo', kind)) with a curated fixed set of well-known records
// and books so every demo visitor sees the same items rendered by the shared
// CollectionView flow.
//
// Items use the app's real item shape (title as "Artist - Album" for records /
// "Author - Title" for books, plus year/label/genre/coverImage/barcode and a
// kind-specific id) so grid/detail/duplicate-detection all work unchanged.
//
// Idempotent: each kind is skipped when its store index is already non-empty,
// so re-running never duplicates. Stable fixed ids (not randomUUID) keep
// re-runs deterministic.
//
// How to run:
//   1. Start the functions locally:  netlify dev   (functions on :8888)
//   2. Either curl it:
//        curl -X POST http://localhost:8888/.netlify/functions/seed-demo \
//             -H "Authorization: Bearer $RUNOUT_ADMIN_KEY"
//      or use the thin wrapper:  node scripts/seed-demo.mjs
//   In production, trigger it once after deploy (RUNOUT_ADMIN_KEY is required
//   and never ships to the client; RUNOUT_DEMO_CODE is public by design).

import { getStore } from '@netlify/blobs'
import { ADMIN_KEY, DEMO_USER, bearer } from './_shared/auth'
import { json } from './_shared/collection-store'
import { DEMO_RECORDS, DEMO_BOOKS, seedDemoStore } from './_shared/demo-data'
import { storeNameFor } from './_shared/users'

// Seed both demo collections via the shared idempotent seeder + curated data
// in ./_shared/demo-data.js (same source the lazy auto-seed in collection.js
// uses, so the demo always shows the same fixed set). Harmless to re-run — it
// skips a kind whose store index is already non-empty.
export default async (req) => {
  if (bearer(req) !== ADMIN_KEY) {
    return json(401, { error: 'Admin key required. Set RUNOUT_ADMIN_KEY and sign in as the owner.' })
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const records = await seedDemoStore(getStore(storeNameFor(DEMO_USER.id, 'records')), DEMO_RECORDS)
  const books = await seedDemoStore(getStore(storeNameFor(DEMO_USER.id, 'books')), DEMO_BOOKS)
  return json(200, { ok: true, records, books })
}
