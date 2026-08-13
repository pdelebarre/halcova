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
import { INDEX_KEY, json } from './_shared/collection-store'
import { storeNameFor } from './_shared/users'

// Records: "Artist - Album", real EAN-13 barcodes, curated classics. The
// coverImage URLs are real public album-cover URLs; the UI falls back to a
// lettered placeholder if any ever stops loading. discogsIds are stable
// placeholders for the Discogs release pages.
const RECORDS = [
  {
    id: 'demo-rec-01',
    title: 'Pink Floyd - The Dark Side of the Moon',
    year: 1973,
    label: 'Harvest',
    catno: 'SHVL 804',
    formatRaw: 'LP, Album',
    formatType: 'LP',
    genre: ['Rock', 'Progressive Rock'],
    style: ['Psychedelic Rock'],
    country: 'UK',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/3/3b/Dark_Side_of_the_Moon.png',
    barcode: '0077774602129',
    discogsId: 372469,
    dateAdded: '2026-08-02T09:00:00.000Z',
  },
  {
    id: 'demo-rec-02',
    title: 'Fleetwood Mac - Rumours',
    year: 1977,
    label: 'Warner Bros. Records',
    catno: 'BSK 3010',
    formatRaw: 'LP, Album',
    formatType: 'LP',
    genre: ['Rock', 'Pop Rock'],
    style: ['Soft Rock'],
    country: 'US',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/6/6a/FleetwoodMacRumours.png',
    barcode: '0075992410489',
    discogsId: 8723963,
    dateAdded: '2026-07-28T09:00:00.000Z',
  },
  {
    id: 'demo-rec-03',
    title: 'Michael Jackson - Thriller',
    year: 1982,
    label: 'Epic',
    catno: 'QE 38112',
    formatRaw: 'LP, Album',
    formatType: 'LP',
    genre: ['Pop', 'Funk', 'Disco'],
    style: ['Boogie'],
    country: 'US',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/5/55/Michael_Jackson_-_Thriller.png',
    barcode: '0074643811842',
    discogsId: 4695171,
    dateAdded: '2026-07-21T09:00:00.000Z',
  },
  {
    id: 'demo-rec-04',
    title: 'Nirvana - Nevermind',
    year: 1991,
    label: 'DGC',
    catno: 'DGCD-24425',
    formatRaw: 'CD, Album',
    formatType: 'CD',
    genre: ['Grunge', 'Alternative Rock'],
    style: [],
    country: 'US',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/b/b7/NirvanaNevermind.svg',
    barcode: '0072064424252',
    discogsId: 1286244,
    dateAdded: '2026-07-14T09:00:00.000Z',
  },
  {
    id: 'demo-rec-05',
    title: 'Radiohead - OK Computer',
    year: 1997,
    label: 'Parlophone',
    catno: 'CDP 7243 8 55229 2 5',
    formatRaw: 'CD, Album',
    formatType: 'CD',
    genre: ['Alternative Rock', 'Art Rock'],
    style: ['Indie Rock'],
    country: 'UK',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/b/ba/Radioheadokcomputer.png',
    barcode: '0072438553076',
    discogsId: 1145189,
    dateAdded: '2026-07-08T09:00:00.000Z',
  },
  {
    id: 'demo-rec-06',
    title: 'Daft Punk - Random Access Memories',
    year: 2013,
    label: 'Columbia',
    catno: '88765434562',
    formatRaw: '2xLP, Album',
    formatType: 'LP',
    genre: ['Electronic', 'Disco', 'Funk'],
    style: ['House'],
    country: 'Europe',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/a/a7/Random_Access_Memories.jpg',
    barcode: '0088765434568',
    discogsId: 4554380,
    dateAdded: '2026-06-30T09:00:00.000Z',
  },
  {
    id: 'demo-rec-07',
    title: 'Queen - A Night at the Opera',
    year: 1975,
    label: 'EMI',
    catno: 'EMC 4007',
    formatRaw: 'LP, Album',
    formatType: 'LP',
    genre: ['Rock', 'Pop Rock'],
    style: ['Glam'],
    country: 'UK',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/8/8d/Queen_A_Night_At_The_Opera.png',
    barcode: '0077770640125',
    discogsId: 2962368,
    dateAdded: '2026-06-20T09:00:00.000Z',
  },
  {
    id: 'demo-rec-08',
    title: 'Amy Winehouse - Back to Black',
    year: 2006,
    label: 'Island Records',
    catno: '1708021',
    formatRaw: 'LP, Album',
    formatType: 'LP',
    genre: ['Soul', 'Rhythm & Blues'],
    style: ['Neo Soul'],
    country: 'UK',
    coverImage: 'https://upload.wikimedia.org/wikipedia/en/f/f5/Back_to_Black_%28Amy_Winehouse_album%29.png',
    barcode: '0060249871120',
    discogsId: 6575065,
    dateAdded: '2026-06-12T09:00:00.000Z',
  },
]

// Books: "Author - Title", real ISBN-13s, curated classics. covers.openlibrary.org
// serves a real cover for any valid ISBN. googleBooksId is a stable id for
// duplicate detection; infoLink points at the Open Library ISBN page so the
// external link always resolves.
const BOOKS = [
  {
    id: 'demo-book-01',
    title: 'George Orwell - 1984',
    year: 1949,
    label: 'Secker & Warburg',
    isbn: '9780452284234',
    catno: '9780452284234',
    formatRaw: '',
    formatType: '',
    genre: ['Fiction', 'Dystopian'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9780452284234-M.jpg',
    barcode: '9780452284234',
    googleBooksId: 'k5hUDwAAQBAJ',
    infoLink: 'https://openlibrary.org/isbn/9780452284234',
    description: 'Winston Smith rewrites history for the Party in a totalitarian superstate where Big Brother is always watching.',
    pageCount: 328,
    language: 'en',
    dateAdded: '2026-08-01T09:00:00.000Z',
  },
  {
    id: 'demo-book-02',
    title: 'Harper Lee - To Kill a Mockingbird',
    year: 1960,
    label: 'J. B. Lippincott & Co.',
    isbn: '9780061120084',
    catno: '9780061120084',
    formatRaw: '',
    formatType: '',
    genre: ['Fiction', 'Classics'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9780061120084-M.jpg',
    barcode: '9780061120084',
    googleBooksId: 'PGR2AwAAQBAJ',
    infoLink: 'https://openlibrary.org/isbn/9780061120084',
    description: 'Scout Finch and her brother Jem grow up in 1930s Alabama while their lawyer father defends a black man falsely accused of a crime.',
    pageCount: 336,
    language: 'en',
    dateAdded: '2026-07-25T09:00:00.000Z',
  },
  {
    id: 'demo-book-03',
    title: 'F. Scott Fitzgerald - The Great Gatsby',
    year: 1925,
    label: "Charles Scribner's Sons",
    isbn: '9780743273565',
    catno: '9780743273565',
    formatRaw: '',
    formatType: '',
    genre: ['Fiction', 'Classics'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9780743273565-M.jpg',
    barcode: '9780743273565',
    googleBooksId: 'SuqUDwAAQBAJ',
    infoLink: 'https://openlibrary.org/isbn/9780743273565',
    description: 'Jay Gatsby throws lavish parties on Long Island in pursuit of the love of his life — a portrait of the Jazz Age.',
    pageCount: 180,
    language: 'en',
    dateAdded: '2026-07-19T09:00:00.000Z',
  },
  {
    id: 'demo-book-04',
    title: 'J.R.R. Tolkien - The Hobbit',
    year: 1937,
    label: 'George Allen & Unwin',
    isbn: '9780547928227',
    catno: '9780547928227',
    formatRaw: '',
    formatType: '',
    genre: ['Fantasy', 'Classics'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9780547928227-M.jpg',
    barcode: '9780547928227',
    googleBooksId: '9XHpAAAAMAAJ',
    infoLink: 'https://openlibrary.org/isbn/9780547928227',
    description: 'Bilbo Baggins joins a company of dwarves to reclaim a mountain hoard from the dragon Smaug.',
    pageCount: 300,
    language: 'en',
    dateAdded: '2026-07-11T09:00:00.000Z',
  },
  {
    id: 'demo-book-05',
    title: 'Aldous Huxley - Brave New World',
    year: 1932,
    label: 'Chatto & Windus',
    isbn: '9780060850524',
    catno: '9780060850524',
    formatRaw: '',
    formatType: '',
    genre: ['Fiction', 'Dystopian'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9780060850524-M.jpg',
    barcode: '9780060850524',
    googleBooksId: '6U1ZAAAAMAAJ',
    infoLink: 'https://openlibrary.org/isbn/9780060850524',
    description: 'In a genetically engineered future, citizens are conditioned for happiness — until one man questions the price.',
    pageCount: 268,
    language: 'en',
    dateAdded: '2026-07-03T09:00:00.000Z',
  },
  {
    id: 'demo-book-06',
    title: 'Ray Bradbury - Fahrenheit 451',
    year: 1953,
    label: 'Ballantine Books',
    isbn: '9781451673319',
    catno: '9781451673319',
    formatRaw: '',
    formatType: '',
    genre: ['Fiction', 'Science Fiction'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9781451673319-M.jpg',
    barcode: '9781451673319',
    googleBooksId: 'T7sLDQAAQBAJ',
    infoLink: 'https://openlibrary.org/isbn/9781451673319',
    description: 'Fireman Guy Montag burns books for a living in a future where reading is outlawed.',
    pageCount: 249,
    language: 'en',
    dateAdded: '2026-06-24T09:00:00.000Z',
  },
  {
    id: 'demo-book-07',
    title: 'J.D. Salinger - The Catcher in the Rye',
    year: 1951,
    label: 'Little, Brown and Company',
    isbn: '9780316769480',
    catno: '9780316769480',
    formatRaw: '',
    formatType: '',
    genre: ['Fiction', 'Classics'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9780316769480-M.jpg',
    barcode: '9780316769480',
    googleBooksId: '9-UDAAAAMAAJ',
    infoLink: 'https://openlibrary.org/isbn/9780316769480',
    description: 'Holden Caulfield wanders New York City after being expelled from prep school.',
    pageCount: 277,
    language: 'en',
    dateAdded: '2026-06-15T09:00:00.000Z',
  },
  {
    id: 'demo-book-08',
    title: 'Gabriel García Márquez - One Hundred Years of Solitude',
    year: 1967,
    label: 'Harper & Row',
    isbn: '9780060883287',
    catno: '9780060883287',
    formatRaw: '',
    formatType: '',
    genre: ['Fiction', 'Magical Realism'],
    style: [],
    country: '',
    coverImage: 'https://covers.openlibrary.org/b/isbn/9780060883287-M.jpg',
    barcode: '9780060883287',
    googleBooksId: '9n4SAQAAIAAJ',
    infoLink: 'https://openlibrary.org/isbn/9780060883287',
    description: 'Seven generations of the Buendía family in the fictional town of Macondo — the landmark of magical realism.',
    pageCount: 417,
    language: 'en',
    dateAdded: '2026-06-05T09:00:00.000Z',
  },
]

// Seed one kind idempotently: skip when the store's index is already non-empty
// so re-runs never duplicate. Writes item:<id> blobs + the ordered index list
// exactly like collection.js does (newest first).
async function seedKind(kind, items) {
  const store = getStore(storeNameFor(DEMO_USER.id, kind))
  const existing = await store.get(INDEX_KEY, { type: 'json' })
  if (existing && existing.length > 0) {
    return { skipped: true, count: existing.length }
  }
  await Promise.all(items.map((item) => store.setJSON(`item:${item.id}`, item)))
  await store.setJSON(INDEX_KEY, items.map((item) => item.id))
  return { skipped: false, count: items.length }
}

export default async (req) => {
  if (bearer(req) !== ADMIN_KEY) {
    return json(401, { error: 'Admin key required. Set RUNOUT_ADMIN_KEY and sign in as the owner.' })
  }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  const records = await seedKind('records', RECORDS)
  const books = await seedKind('books', BOOKS)
  return json(200, { ok: true, records, books })
}
