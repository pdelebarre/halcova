import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import ListView from './components/ListView'
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

// Leading toast status icons (§4.17): ✓ add / – remove / ✕ error.
const TOAST_ICONS = { add: '✓', remove: '–', error: '✕' }

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
  const [toast, setToast] = useState(null) // { msg, kind: 'add' | 'remove' | 'error' }
  const toastTimer = useRef(null)

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeFormats, setActiveFormats] = useState([])
  const [activeGenres, setActiveGenres] = useState([])
  const [activeArtist, setActiveArtist] = useState('')
  const [sortBy, setSortBy] = useState('added')

  // Grid vs List, remembered per kind (§4.6).
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(`runout.view.${catalog.kind}`) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  useEffect(() => {
    try { localStorage.setItem(`runout.view.${catalog.kind}`, view) } catch { /* ignore */ }
  }, [view, catalog.kind])

  // Debounce the search filter so typing stays instant on large collections
  // (§4.18): the input updates immediately, the filter computation lags ~150ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(t)
  }, [query])

  // FAB add menu (§4.8): Scan barcode / Search by title / Enter manually.
  const [fabOpen, setFabOpen] = useState(false)
  const fabRef = useRef(null)
  const fabMenuRef = useRef(null)

  useEffect(() => {
    if (!fabOpen) return undefined
    fabMenuRef.current?.querySelector('button')?.focus()
    function onKey(e) {
      if (e.key === 'Escape') {
        setFabOpen(false)
        fabRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fabOpen])

  const { Grid, Detail, ManualAdd } = catalog.components
  const copy = catalog.copy

  function showToast(msg, kind = 'add') {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, kind })
    toastTimer.current = setTimeout(() => setToast(null), 2400)
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

  // Reset only the format/genre/artist filters (search stays) — used by the
  // filter sheet's Reset action (§5.2).
  function resetFilters() {
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

  const hasActiveFilters = debouncedQuery.trim() !== '' || activeFormats.length > 0 || activeGenres.length > 0 || activeArtist !== ''

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
      if (err.code === 'SERVER_NO_TOKEN') {
        onRequestSettings()
        showToast(`${catalog.lookupName} lookups aren't configured yet — ask the owner to set up the shared token`, 'error')
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
    const payload = { ...candidate }
    delete payload.id
    delete payload.dateAdded
    delete payload.notes
    try {
      await add({ ...payload, notes: '' })
      setModal(null)
      setScanCandidate(null)
      showToast(copy.addToast, 'add')
    } catch {
      showToast('Could not save — check your connection', 'error')
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
    navigator.vibrate?.(40)
    await remove(id)
    setModal(null)
    setSelectedItem(null)
    showToast(copy.removedToast, 'remove')
  }

  async function handleSaveNotes(notes) {
    if (!selectedItem) return
    await update(selectedItem.id, { notes })
    setSelectedItem((prev) => (prev ? { ...prev, notes } : prev))
  }

  // FAB menu: tapping the scrim / Esc closes and restores focus to the FAB;
  // choosing an action opens the matching flow.
  function closeFab() {
    setFabOpen(false)
    fabRef.current?.focus()
  }

  function fabAction(m) {
    setFabOpen(false)
    setModal(m)
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
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.trim().toLowerCase()
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
  }, [items, debouncedQuery, activeFormats, activeGenres, activeArtist, sortBy])

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
          onResetFilters={resetFilters}
          view={view} setView={setView}
          copy={copy}
        />
      )}

      <main className="app-main">
        {status === 'loading' && <p className="status-line">{copy.loading}</p>}

        {status === 'error' && (
          <div className="status-line status-error">
            <p>Couldn't reach your collection. {error}</p>
            <button type="button" className="btn btn-ghost" onClick={refresh}>Try again</button>
          </div>
        )}

        {status === 'ready' && items.length === 0 && (
          <EmptyState copy={copy} onScan={() => setModal('scan')} onManualAdd={() => setModal('manual')} />
        )}

        {status === 'ready' && items.length > 0 && visibleItems.length === 0 && (
          <EmptyState kind="no-results" copy={copy} onClear={clearFilters} />
        )}

        {status === 'ready' && visibleItems.length > 0 && (
          view === 'list' ? (
            <ListView
              items={visibleItems}
              sortBy={sortBy}
              copy={copy}
              onOpen={(item) => { setSelectedItem(item); setModal('detail') }}
            />
          ) : (
            <Grid items={visibleItems} onOpen={(item) => { setSelectedItem(item); setModal('detail') }} />
          )
        )}

        {status === 'ready' && items.length > 0 && (
          <span className="visually-hidden" role="status" aria-live="polite">
            {copy.view?.showing ? copy.view.showing(visibleItems.length, items.length) : ''}
          </span>
        )}
      </main>

      {items.length > 0 && (
        <>
          {fabOpen && <div className="fab-overlay" onClick={closeFab} aria-hidden="true" />}
          <div
            className="fab-menu"
            role="menu"
            aria-label={copy.fabMenu.label}
            ref={fabMenuRef}
            hidden={!fabOpen}
          >
            <button type="button" role="menuitem" className="fab-option" onClick={() => fabAction('scan')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
                <path d="M7 12h10" />
              </svg>
              {copy.fabMenu.scan}
            </button>
            <button type="button" role="menuitem" className="fab-option" onClick={() => fabAction('manual')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              {copy.fabMenu.searchTitle}
            </button>
            <button type="button" role="menuitem" className="fab-option" onClick={() => fabAction('manual')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              {copy.fabMenu.manual}
            </button>
          </div>
          <button
            ref={fabRef}
            type="button"
            className="fab"
            aria-haspopup="menu"
            aria-expanded={fabOpen}
            onClick={() => setFabOpen((s) => !s)}
            aria-label="Scan"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
              <path d="M7 12h10" />
            </svg>
            <span>Scan</span>
          </button>
        </>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden="true">{TOAST_ICONS[toast.kind] || '✕'}</span>
          {toast.msg}
        </div>
      )}

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
        <ManualAdd copy={copy} onPick={presentCandidate} onClose={() => setModal(null)} />
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
