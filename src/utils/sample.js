// Curated "Try a sample" items (issue #85, epic #84 C2.3). A brand-new user
// can see a full scan-result sheet in ~10 seconds without owning anything,
// scanning a barcode, or configuring a Discogs token — the sample is fed
// DIRECTLY into the result flow (no lookup API, no token, no network).
//
// These are client-side copies of two items already shipped in the demo seed
// (netlify/functions/_shared/demo-data.js) — deliberately NOT imported from
// the server module, so the PWA never depends on backend code for a frontend
// affordance. `isSample` is stamped on the candidate by CollectionView so
// every write boundary (add / wishlist / convert / delete / lend) can refuse
// to persist it.

export const SAMPLE_RECORD = {
  title: 'Pink Floyd - The Dark Side of the Moon',
  year: 1973,
  label: 'Harvest',
  catno: 'SHVL 804',
  formatType: 'LP',
  genre: ['Rock', 'Progressive Rock'],
  coverImage: 'https://upload.wikimedia.org/wikipedia/en/3/3b/Dark_Side_of_the_Moon.png',
  barcode: '0077774602129',
  discogsId: 372469,
}

export const SAMPLE_BOOK = {
  title: 'George Orwell - 1984',
  year: 1949,
  label: 'Secker & Warburg',
  catno: '9780452284234',
  formatType: '',
  genre: ['Fiction', 'Dystopian'],
  coverImage: 'https://covers.openlibrary.org/b/isbn/9780452284234-M.jpg',
  barcode: '9780452284234',
  googleBooksId: 'k5hUDwAAQBAJ',
  pageCount: 328,
  description: 'Winston Smith rewrites history for the Party in a totalitarian superstate where Big Brother is always watching.',
}
