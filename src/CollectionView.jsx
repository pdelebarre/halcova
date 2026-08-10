import { lazy, Suspense, useMemo, useState } from 'react'
import Toolbar from './components/Toolbar'
import EmptyState from './components/EmptyState'
import MatchPicker from './components/MatchPicker'
import ScanResult from './components/ScanResult'
import { useCollection } from './hooks/useCollection'
import { findRelated, splitArtistTitle } from './utils/match'
import './App.css'

// The WASM barcode decoder is heavy — only worth loading once the person
// actually taps "Scan", not on first paint.
const ScannerModal = lazy(() => import('./components/ScannerModal'))

function cleanBarcode(raw) {
  return String(raw).replace(/[^0-9Xx]/g, '')
}

/**
 * One full collection screen — search, scan, add, filter, sort, delete —
 * driven by a `catalog` describing what we're cataloging (records or books).
 * App.jsx renders one of these per tab.
 */
export default function CollectionView({ catalog, onRequestSettings }) {
  const { items, status, error, add, update, remove, refresh } = useCollection(catalog.storage)

  const [modal, setModal] = useState(null) // 'scan' | 'pick' | 'manual' | 'result' | 'detail'
  const [pickerState, setPickerState] = useState({ matches: null, loading: false, errorMsg: '' })
  const [scanCandidate, setScanCandidate] = useState(null) // { candidate, ownedExact, sameAlbum, otherArtist }
  const [selectedItem, setSelectedItem] = useState(null)
  const [toast, setToast] = useState('')

  const [query, setQuery] = useState('')
  const [activeFormats, setActiveFormats] = useState([])
  const [activeGenres, setActiveGenres] = useState([])
  const [activeArtist, setActiveArtist] = useState('')
  const [sortBy, setSortBy] = useState('added')

  const { Grid, Detail, ManualAdd } = catalog.components
  const copy = catalog.copy

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 2400)
  }

  function toggleFormat(f) {
    setActiveFormats((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]))
  }

  function toggleGenre(g) {
    setActiveGenres((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))
  }

  function clearFilters() {
    setQuery('')
    setActiveFormats([])
    setActiveGenres([])
    setActiveArtist('')
  }

  // Distinct genres and artists present in the collection — drives the classification filters.
  const { genres, artists } = useMemo(() => {
    const genreSet = new Set()
    const artistSet = new Set()
    items.forEach((it) => {
      const gs = it.genre || []
      gs.forEach((g) => {
        const trimmed = g.trim()
        if (trimmed) genreSet.add(trimmed)
      })
      const { artist } = splitArtistTitle(it.title)
      if (artist) artistSet.add(artist)
    })
    return {
      genres: [...genreSet].sort((a, b) => a.localeCompare(b)),
      artists: [...artistSet].sort((a, b) => a.localeCompare(b)),
    }
  }, [items])

  const hasActiveFilters = query.trim() !== '' || activeFormats.length > 0 || activeGenres.length > 0 || activeArtist !== ''

  // The core "am I looking at a duplicate" step — every path into the app
  // (barcode auto-match, picking from multiple pressings/editions, text
  // search, manual entry) funnels through here before anything gets added.
  function presentCandidate(candidate) {
    const { ownedExact, sameAlbum, otherArtist } = findRelated(candidate, items)
    setScanCandidate({ candidate, ownedExact, sameAlbum, otherArtist })
    setModal('result')
  }

  async function handleBarcodeDetected(barcode) {
    const clean = cleanBarcode(barcode)

    // Already scanned this exact barcode before — answer instantly, no
    // network round-trip needed. Also means it still works on bad shop wifi.
    const localMatch = items.find((it) => it.barcode && it.barcode === clean)
    if (localMatch) {
      presentCandidate(localMatch)
      return
    }

    setModal('pick')
    setPickerState({ matches: null, loading: true, errorMsg: '' })
    try {
      const results = await catalog.api.searchByBarcode(clean)
      if (results.length === 1) {
        presentCandidate(results[0])
      } else {
        setPickerState({ matches: results, loading: false, errorMsg: '' })
      }
    } catch (err) {
      if (err.code === 'NO_TOKEN') {
        onRequestSettings()
        showToast(`Add a ${catalog.lookupName} token first to look up barcodes`)
        return
      }
      setPickerState({ matches: [], loading: false, errorMsg: err.message })
    }
  }

  function handleScannerClose(reason) {
    if (reason === 'manual') setModal('manual')
    else setModal(null)
  }

  async function handleAddCandidate(candidate) {
    // Strip anything carried over from an already-owned item (id, dateAdded,
    // notes) so "Add anyway" creates a genuinely new entry, not a stale clone.
    const { id: _id, dateAdded: _dateAdded, notes: _notes, ...payload } = candidate
    try {
      await add({ ...payload, notes: '' })
      setModal(null)
      setScanCandidate(null)
      showToast(copy.addToast)
    } catch {
      showToast('Could not save — check your connection')
    }
  }

  function handleOpenFromResult(item) {
    setSelectedItem(item)
    setModal('detail')
  }

  function handleScanNext() {
    setScanCandidate(null)
    setModal('scan')
  }

  async function handleDelete(id) {
    await remove(id)
    setModal(null)
    setSelectedItem(null)
    showToast(copy.removedToast)
  }

  async function handleSaveNotes(notes) {
    if (!selectedItem) return
    await update(selectedItem.id, { notes })
    setSelectedItem((prev) => (prev ? { ...prev, notes } : prev))
  }

  const visibleItems = useMemo(() => {
    let list = items
    if (activeFormats.length) {
      list = list.filter((it) => activeFormats.includes(it.formatType))
    }
    if (activeGenres.length) {
      list = list.filter((it) => (it.genre || []).some((g) => activeGenres.includes(g)))
    }
    if (activeArtist) {
      list = list.filter((it) => splitArtistTitle(it.title).artist === activeArtist)
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((it) =>
        it.title?.toLowerCase().includes(q) ||
        it.label?.toLowerCase().includes(q) ||
        it.catno?.toLowerCase().includes(q) ||
        (it.genre || []).some((g) => g.toLowerCase().includes(q)))
    }
    const sorted = [...list]
    if (sortBy === 'artist') {
      sorted.sort((a, b) => {
        const artistCmp = splitArtistTitle(a.title).artist.localeCompare(splitArtistTitle(b.title).artist)
        return artistCmp !== 0 ? artistCmp : (a.title || '').localeCompare(b.title || '')
      })
    } else if (sortBy === 'year') {
      sorted.sort((a, b) => (b.year || 0) - (a.year || 0))
    } else if (sortBy === 'format') {
      sorted.sort((a, b) => (a.formatType || '').localeCompare(b.formatType || ''))
    } else if (sortBy === 'title') {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else {
      sorted.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))
    }
    return sorted
  }, [items, query, activeFormats, activeGenres, activeArtist, sortBy])

  return (
    <>
      {status === 'ready' && items.length > 0 && (
        <Toolbar
          query={query} setQuery={setQuery}
          placeholder={catalog.searchPlaceholder}
          formats={catalog.formats}
          activeFormats={activeFormats} toggleFormat={toggleFormat}
          genres={genres} activeGenres={activeGenres} toggleGenre={toggleGenre}
          genreLabel={catalog.genreLabel}
          artists={artists} activeArtist={activeArtist} setActiveArtist={setActiveArtist}
          artistLabel={catalog.artistLabel} artistPlaceholder={catalog.artistPlaceholder}
          sortBy={sortBy} setSortBy={setSortBy}
          sortOptions={catalog.sortOptions}
          count={visibleItems.length}
          showClear={hasActiveFilters} onClearFilters={clearFilters}
        />
      )}

      <main className="app-main">
        {status === 'loading' && <p className="status-line">{copy.loading}</p>}

        {status === 'error' && (
          <div className="status-line status-error">
            <p>Couldn't reach your collection. {error}</p>
            <button className="btn btn-ghost" onClick={refresh}>Try again</button>
          </div>
        )}

        {status === 'ready' && items.length === 0 && (
          <EmptyState copy={copy} onScan={() => setModal('scan')} />
        )}

        {status === 'ready' && items.length > 0 && visibleItems.length === 0 && (
          <EmptyState kind="no-results" copy={copy} />
        )}

        {status === 'ready' && visibleItems.length > 0 && (
          <Grid items={visibleItems} onOpen={(item) => { setSelectedItem(item); setModal('detail') }} />
        )}
      </main>

      {items.length > 0 && (
        <button className="fab" onClick={() => setModal('scan')} aria-label="Scan a barcode">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
            <path d="M7 12h10" />
          </svg>
          <span>Scan</span>
        </button>
      )}

      {toast && <div className="toast">{toast}</div>}

      {modal === 'scan' && (
        <Suspense fallback={<div className="scanner-loading">Starting camera…</div>}>
          <ScannerModal onDetected={handleBarcodeDetected} onClose={handleScannerClose} />
        </Suspense>
      )}

      {modal === 'pick' && (
        <MatchPicker
          title="Is this it?"
          matches={pickerState.matches}
          loading={pickerState.loading}
          errorMsg={pickerState.errorMsg}
          onPick={presentCandidate}
          onRetrySearch={() => setModal('manual')}
          onManual={() => setModal('manual')}
          onClose={() => setModal(null)}
          loadingLabel={copy.lookingUp}
          noMatchLabel={copy.noMatch}
        />
      )}

      {modal === 'manual' && (
        <ManualAdd onPick={presentCandidate} onClose={() => setModal(null)} />
      )}

      {modal === 'result' && scanCandidate && (
        <ScanResult
          candidate={scanCandidate.candidate}
          ownedExact={scanCandidate.ownedExact}
          sameAlbum={scanCandidate.sameAlbum}
          otherArtist={scanCandidate.otherArtist}
          onAdd={handleAddCandidate}
          onOpenItem={handleOpenFromResult}
          onScanNext={handleScanNext}
          onClose={() => { setModal(null); setScanCandidate(null) }}
          copy={copy}
        />
      )}

      {modal === 'detail' && selectedItem && (
        <Detail
          item={selectedItem}
          catalog={catalog}
          onClose={() => { setModal(null); setSelectedItem(null) }}
          onDelete={handleDelete}
          onSaveNotes={handleSaveNotes}
        />
      )}
    </>
  )
}
