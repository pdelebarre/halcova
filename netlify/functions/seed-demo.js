// One-shot seeder for the public demo space. Reachable ONLY with the owner's
// admin SESSION (`Authorization: Bearer <sessionToken>` — SEC-1.6, #181: the
// admin key only minted this session at login). Seeds the shared demo stores
// (collection-demo-records / collection-demo-books, via
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
//   2. Exchange the admin key for an admin session, then call it:
//        SESSION=$(curl -s -X POST http://localhost:8888/.netlify/functions/auth \
//                   -H "Content-Type: application/json" \
//                   -d "{\"action\":\"login\",\"code\":\"$RUNOUT_ADMIN_KEY\"}" \
//                   | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).session))")
//        curl -X POST http://localhost:8888/.netlify/functions/seed-demo \
//             -H "Authorization: Bearer $SESSION"
//      or use the thin wrapper:  node scripts/seed-demo.mjs
//   In production, trigger it once after deploy (RUNOUT_ADMIN_KEY is required
//   and never ships to the client; RUNOUT_DEMO_CODE is public by design).

import { getStore } from '@netlify/blobs'
import { DEMO_USER } from './_shared/auth'
import { json } from './_shared/collection-store'
import { requireAdmin } from './_shared/session-auth'
import { DEMO_RECORDS, DEMO_BOOKS, seedDemoStore } from './_shared/demo-data'
import { storeNameFor } from './_shared/users'

// Seed both demo collections via the shared idempotent seeder + curated data
// in ./_shared/demo-data.js (same source the lazy auto-seed in collection.js
// uses, so the demo always shows the same fixed set). Harmless to re-run — it
// skips a kind whose store index is already non-empty.
export default async (req) => {
  // SEC-1.6 (#181): authorize by the session's role (the owner's admin
  // session), never by re-checking a bearer string against ADMIN_KEY.
  const admin = await requireAdmin(req)
  if (admin.error) return admin.error
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const records = await seedDemoStore(getStore(storeNameFor(DEMO_USER.id, 'records')), DEMO_RECORDS)
  const books = await seedDemoStore(getStore(storeNameFor(DEMO_USER.id, 'books')), DEMO_BOOKS)
  return json(200, { ok: true, records, books })
}
