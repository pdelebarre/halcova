// A "catalog" is everything the shared collection flow needs to know about one
// kind of thing we catalog (records or books): which API to look it up on,
// which components render it, and the copy used for labels/toasts/empty states.
//
// Records and books share the same item shape — title stored as "Artist -
// Author - Title", plus year/label/genre/coverImage/barcode — so one flow in
// CollectionView.jsx drives both.

import * as discogs from './api/discogs'
import * as books from './api/books'
import { t } from './i18n'
import { splitArtistTitle } from './utils/match'
import { decadeOf } from './utils/browse'
import AlbumCard from './components/AlbumCard'
import AlbumGrid from './components/AlbumGrid'
import AlbumDetail from './components/AlbumDetail'
import ManualAddModal from './components/ManualAddModal'
import BookCard from './components/BookCard'
import BookGrid from './components/BookGrid'
import BookDetail from './components/BookDetail'
import BookManualAddModal from './components/BookManualAddModal'

export const recordsCatalog = {
  kind: 'records',
  entity: 'record',
  collectionLabel: 'crate', // used in t() interpolation
  searchPlaceholder: 'Search your crate…',
  storage: 'records',
  api: discogs,
  getDetail: discogs.getReleaseDetail,
  lookupName: 'Discogs',
  formats: ['LP', 'EP', 'CD', '7"', '12"'],
  genreLabel: 'Genre',
  artistLabel: 'artist',
  artistPlaceholder: 'All artists',
  sortOptions: [
    { value: 'added', label: 'Recently added' },
    { value: 'artist', label: 'Artist A–Z' },
    { value: 'year', label: 'Year' },
    { value: 'format', label: 'Format' },
  ],
  // The Aisles (§ Phase 2): browse axes for the aisle picker. Each axis knows
  // how to extract its bin value(s) from an item; bins are counted client-side.
  browseAxes: [
    { id: 'genre', label: 'Genre', value: (item) => (item.genre || []).map((g) => String(g).trim()).filter(Boolean) },
    { id: 'artist', label: 'Artist', value: (item) => [splitArtistTitle(item.title).artist].filter(Boolean) },
    { id: 'decade', label: 'Decade', value: (item) => [decadeOf(item.year)] },
    { id: 'format', label: 'Format', value: (item) => (item.formatType ? [item.formatType] : []) },
    { id: 'label', label: 'Label', value: (item) => (item.label ? [item.label] : []) },
  ],
  components: {
    Card: AlbumCard,
    Grid: AlbumGrid,
    Detail: AlbumDetail,
    ManualAdd: ManualAddModal,
  },
  detailLink: (item) => `https://www.discogs.com/release/${item.discogsId}`,
  detailLinkLabel: 'View on Discogs ↗',
  copy: {
    emptyIcon: 'empty-disc',
    // Kind-specific overrides for the shared collection flow.
    // Components use t() as the primary source; these are fallbacks / overrides.
    emptyTitle: 'Your crate is empty',
    emptySub: 'Scan the barcode on a sleeve to catalog your first record.',
    emptyTagline: 'your crate, cataloged',
    emptyBtn: 'Scan a record',
    loading: 'Loading your crate…',
    addToast: 'Added to your crate',
    removeLabel: 'Remove from crate',
    lookingUp: 'Looking it up on Discogs…',
    noMatch: 'No matches found on Discogs.',
    resultGood: { label: 'Not in your crate yet', sub: "You don't have this one." },
    resultOwned: { label: 'Already in your crate', sub: 'This exact record is already yours.' },
    resultSame: { label: 'You already own this album', sub: 'Different pressing or format — check before buying.' },
    sameHeading: 'Other pressings you own',
    moreBy: (name, n) => `More by ${name} in your crate (${n})`,
    nothingElseBy: (name) => `Nothing else by ${name} in your crate`,
    moreRelated: (n) => `and ${n} more`,
    scanNext: 'Scan next',
    add: 'Add to crate',
    manualTitleRequired: 'Add a title — give this record a name first.',
    fabMenu: { label: 'Add options', scan: 'Scan barcode', searchTitle: 'Search by title', manual: 'Enter manually' },
    filterSheet: {
      artist: 'Artist',
      noArtists: 'No matching artists',
      clearArtist: 'Clear artist filter',
    },
    // The Floor (§ Phase 1): sectioned home — New arrivals / On loan / Pinned
    // shelves, then "Browse all". `dive` opens a random item.
    floor: {
      newArrivals: { title: 'New arrivals', kicker: 'Fresh in' },
      onLoan: { title: 'On loan', kicker: 'Out in the world' },
      pinned: { title: 'Pinned', kicker: 'Your picks' },
      browseAll: { title: 'Browse all', kicker: 'Everything' },
      dive: 'Crate dive',
      diveAria: 'Open a random record from your crate',
      pin: 'Pin to top',
      unpin: 'Unpin',
      pinnedToast: 'Pinned to your picks',
      unpinnedToast: 'Removed from your picks',
    },
    browse: {
      label: 'Browse',
      title: 'Browse your crate',
      clear: 'Clear browse',
      empty: 'Nothing to show here yet.',
    },
    search: {
      results: (n, q) => `${n} ${n === 1 ? 'match' : 'matches'} for “${q}”`,
      clear: 'Clear search results',
      recentTitle: 'Recent searches',
      clearRecent: 'Clear recent',
      didYouMeanPrefix: 'Did you mean',
      done: 'Done',
    },
    lending: {
      section: t('lending.section'),
      statusOut: (name, date) => t('lending.statusOut', { name, date }),
      due: (date) => t('lending.due', { date }),
      overdue: t('lending.overdue'),
      overdueSince: (date) => t('lending.overdueSince', { date }),
      notOnLoan: t('lending.notOnLoan'),
      lend: t('lending.lend'),
      lendTitle: (entity) => t('lending.lendTitle', { entity }),
      borrower: t('lending.borrower'),
      borrowerPlaceholder: t('lending.borrowerPlaceholder'),
      contact: t('lending.contact'),
      dueDate: t('lending.dueDate'),
      confirmLend: t('lending.confirmLend'),
      nameRequired: t('lending.nameRequired'),
      return: t('lending.return'),
      returnConfirm: t('lending.returnConfirm'),
      lentToast: (name) => t('lending.lentToast', { name }),
      returnedToast: t('lending.returnedToast'),
      badge: t('lending.badge'),
      badgeOverdue: t('lending.badgeOverdue'),
      filter: t('lending.filter'),
      filterHint: t('lending.filterHint'),
      history: t('lending.history'),
      historyLent: (date) => t('lending.historyLent', { date }),
      historyReturned: (date) => t('lending.historyReturned', { date }),
    },
    view: {
      showing: (n, m) => `Showing ${Number(n || 0).toLocaleString()} of ${Number(m || 0).toLocaleString()}`,
    },
  },
}

export const booksCatalog = {
  kind: 'books',
  entity: 'book',
  collectionLabel: 'shelf', // used in t() interpolation
  searchPlaceholder: 'Search your shelf…',
  storage: 'books',
  api: books,
  getDetail: books.getBookDetail,
  lookupName: 'Google Books',
  formats: [], // books are looked up by ISBN — no format chips
  genreLabel: 'Category',
  artistLabel: 'author',
  artistPlaceholder: 'All authors',
  sortOptions: [
    { value: 'added', label: 'Recently added' },
    { value: 'artist', label: 'Author A–Z' },
    { value: 'title', label: 'Title A–Z' },
    { value: 'year', label: 'Year' },
  ],
  // The Aisles (§ Phase 2): browse axes for the aisle picker. Books have no
  // series field in the item shape, so the axes cover the data we actually have.
  browseAxes: [
    { id: 'category', label: 'Category', value: (item) => (item.genre || []).map((g) => String(g).trim()).filter(Boolean) },
    { id: 'author', label: 'Author', value: (item) => [splitArtistTitle(item.title).artist].filter(Boolean) },
    { id: 'year', label: 'Year', value: (item) => (item.year ? [String(item.year)] : []) },
  ],
  components: {
    Card: BookCard,
    Grid: BookGrid,
    Detail: BookDetail,
    ManualAdd: BookManualAddModal,
  },
  detailLink: (item) => item.infoLink || `https://books.google.com/books?id=${item.googleBooksId}`,
  detailLinkLabel: 'View on Google Books ↗',
  copy: {
    emptyIcon: 'empty-book',
    // Kind-specific overrides for the shared collection flow.
    emptyTitle: 'Your shelf is empty',
    lending: {
      section: t('lending.section'),
      statusOut: (name, date) => t('lending.statusOut', { name, date }),
      due: (date) => t('lending.due', { date }),
      overdue: t('lending.overdue'),
      overdueSince: (date) => t('lending.overdueSince', { date }),
      notOnLoan: t('lending.notOnLoan'),
      lend: t('lending.lend'),
      lendTitle: (entity) => t('lending.lendTitle', { entity }),
      borrower: t('lending.borrower'),
      borrowerPlaceholder: t('lending.borrowerPlaceholder'),
      contact: t('lending.contact'),
      dueDate: t('lending.dueDate'),
      confirmLend: t('lending.confirmLend'),
      nameRequired: t('lending.nameRequired'),
      return: t('lending.return'),
      returnConfirm: t('lending.returnConfirm'),
      lentToast: (name) => t('lending.lentToast', { name }),
      returnedToast: t('lending.returnedToast'),
      badge: t('lending.badge'),
      badgeOverdue: t('lending.badgeOverdue'),
      filter: t('lending.filter'),
      filterHint: t('lending.filterHint'),
      history: t('lending.history'),
      historyLent: (date) => t('lending.historyLent', { date }),
      historyReturned: (date) => t('lending.historyReturned', { date }),
    },
    emptySub: 'Scan the ISBN on a book to catalog your first title.',
    emptyTagline: 'your shelf, cataloged',
    emptyBtn: 'Scan a book',
    loading: 'Loading your shelf…',
    addToast: 'Added to your shelf',
    removeLabel: 'Remove from shelf',
    lookingUp: 'Looking it up on Google Books…',
    noMatch: 'No matches found on Google Books.',
    resultGood: { label: 'Not on your shelf yet', sub: "You don't have this one." },
    resultOwned: { label: 'Already on your shelf', sub: 'This exact book is already yours.' },
    resultSame: { label: 'You already own this book', sub: 'Different edition — check before buying.' },
    sameHeading: 'Other editions you own',
    moreBy: (name, n) => `More by ${name} on your shelf (${n})`,
    nothingElseBy: (name) => `Nothing else by ${name} on your shelf`,
    moreRelated: (n) => `and ${n} more`,
    scanNext: 'Scan next',
    add: 'Add to shelf',
    manualTitleRequired: 'Add a title — give this book a name first.',
    fabMenu: { label: 'Add options', scan: 'Scan barcode', searchTitle: 'Search by title', manual: 'Enter manually' },
    filterSheet: {
      artist: 'Author',
      noArtists: 'No matching authors',
      clearArtist: 'Clear author filter',
    },
    // The Floor (§ Phase 1): sectioned home — New arrivals / On loan / Pinned
    // shelves, then "Browse all". `dive` opens a random item.
    floor: {
      newArrivals: { title: 'New arrivals', kicker: 'Fresh in' },
      onLoan: { title: 'On loan', kicker: 'Out in the world' },
      pinned: { title: 'Pinned', kicker: 'Your picks' },
      browseAll: { title: 'Browse all', kicker: 'Everything' },
      dive: 'Shelf dive',
      diveAria: 'Open a random book from your shelf',
      pin: 'Pin to top',
      unpin: 'Unpin',
      pinnedToast: 'Pinned to your picks',
      unpinnedToast: 'Removed from your picks',
    },
    browse: {
      label: 'Browse',
      title: 'Browse your shelf',
      clear: 'Clear browse',
      empty: 'Nothing to show here yet.',
    },
    search: {
      results: (n, q) => `${n} ${n === 1 ? 'match' : 'matches'} for “${q}”`,
      clear: 'Clear search results',
      recentTitle: 'Recent searches',
      clearRecent: 'Clear recent',
      didYouMeanPrefix: 'Did you mean',
      done: 'Done',
    },
    view: {
      showing: (n, m) => `Showing ${Number(n || 0).toLocaleString()} of ${Number(m || 0).toLocaleString()}`,
    },
  },
}
