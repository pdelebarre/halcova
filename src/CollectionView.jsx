import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import ListView from './components/ListView'
import EmptyState from './components/EmptyState'
import SectionHeader from './components/SectionHeader'
import CoverShelf from './components/CoverShelf'
import MatchPicker from './components/MatchPicker'
import ScanResult from './components/ScanResult'
import AisleSheet from './components/AisleSheet'
import { useCollection } from './hooks/useCollection'
import { findRelated, splitArtistTitle, searchItems, didYouMean } from './utils/match'
import { itemInBin } from './utils/browse'
import { t, getLocale } from './i18n'
import './App.css'

// The WASM barcode decoder is heavy — only worth loading once the person
// actually taps "Scan", not on first paint.
const ScannerModal = lazy(() => import('./components/ScannerModal'))

function cleanBarcode(raw) {
  return String(raw).replace(/[^0-9Xx]/g, '')
}

// Leading toast status icons (§4.17): ✓ add / – remove / ✕ error.
const TOAST_ICONS = { add: '✓', remove: '–', error: '✕' }

// Free tier cap (mirrors PLAN_LIMITS.free in netlify/functions/_shared/plans.js).
// The server is authoritative — this only drives the counter and disabling the
// add UI so users aren't sent on a doomed add.
const FREE_PLAN_CAP = 10

// How many of the most recently added items get their own shelf on the Floor.
// The Floor activates once the collection grows past this many items.
const NEW_ARRIVALS_COUNT = 5

/**
 * One full collection screen — search, scan, add, filter, sort, delete —
 * driven by a `catalog` describing what we're cataloging (records or books).
 * App.jsx renders one of these per tab.
 */
export default function CollectionView({ catalog, onRequestSettings, lendingEnabled, onOpenLoans, refreshTick, loansButtonRef, isFree = false, isDemo = false }) {
  const { items, status, error, add, update, remove, refresh, lend, returnItem } = useCollection(catalog.storage)

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
  const [activeLending, setActiveLending] = useState(false) // W7: only on-loan items
  const [sortBy, setSortBy] = useState('added')
  // The Aisles (§ Phase 2): a selected browse bin ({ axisId, value }) acts as
  // a filter; the sheet is the picker.
  const [activeAisle, setActiveAisle] = useState(null)
  const [aisleSheetOpen, setAisleSheetOpen] = useState(false)
  // The Catalog (§ Phase 3): recent searches persisted per kind + focus state
  // for the "recent searches" row under the toolbar.
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const raw = localStorage.getItem(`runout.recentSearches.${catalog.kind}`)
      const arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr.slice(0, 6) : []
    } catch { return [] }
  })
  const [searchFocused, setSearchFocused] = useState(false)

  // Free tier: the counter reflects the WHOLE collection (items.length, not the
  // filtered/visible count) and add flows are gated once the cap is reached so
  // a free user never attempts an add the server will reject with PLAN_LIMIT.
  const atLimit = isFree && items.length >= FREE_PLAN_CAP

  // Grid vs List, remembered per kind (§4.6).
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(`runout.view.${catalog.kind}`) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  useEffect(() => {
    try { localStorage.setItem(`runout.view.${catalog.kind}`, view) } catch { /* ignore */ }
  }, [view, catalog.kind])

  // Persist the recent-searches list (capped at 6, most recent first).
  useEffect(() => {
    try { localStorage.setItem(`runout.recentSearches.${catalog.kind}`, JSON.stringify(recentSearches)) } catch { /* ignore */ }
  }, [recentSearches, catalog.kind])

  // Debounce the search filter so typing stays instant on large collections
  // (§4.18): the input updates immediately, the filter computation lags ~150ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(t)
  }, [query])

  // W7: when App bumps `refreshTick` (e.g. returning an item from the loans
  // dashboard), re-fetch this collection so the visible state stays in sync.
  // Skip the first run — useCollection already fetches on mount.
  const skipFirstRefreshTick = useRef(true)
  useEffect(() => {
    if (skipFirstRefreshTick.current) {
      skipFirstRefreshTick.current = false
      return
    }
    refresh()
  }, [refreshTick, refresh])

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

  const { Grid, Detail, ManualAdd, Card } = catalog.components
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

  function toggleLending() {
    setActiveLending((v) => !v)
  }

  function clearFilters() {
    setQuery('')
    setActiveFormats([])
    setActiveGenres([])
    setActiveArtist('')
    setActiveLending(false)
    setActiveAisle(null)
  }

  // Reset only the format/genre/artist/lending filters (search stays) — used
  // by the filter sheet's Reset action (§5.2).
  function resetFilters() {
    setActiveFormats([])
    setActiveGenres([])
    setActiveArtist('')
    setActiveLending(false)
    setActiveAisle(null)
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

  const hasActiveFilters = debouncedQuery.trim() !== '' || activeFormats.length > 0 || activeGenres.length > 0 || activeArtist !== '' || activeLending || activeAisle !== null
  const hasQuery = debouncedQuery.trim() !== ''

  // The Floor (§ Phase 1): curated shelves shown in the default browse state
  // (grid view, no filters, "Recently added" sort). New arrivals appear only
  // once the collection is big enough that the shelf adds value; On loan and
  // Pinned shelves appear whenever they're non-empty. `floor` is a stable
  // reference (catalog module copy), so the memo stays valid.
  // copy is a stable module reference, so this memo keeps `floor` stable
  // (no new object every render — keeps exhaustive-deps happy).
  const floor = useMemo(() => copy.floor || {}, [copy])
  const floorSections = useMemo(() => {
    const sections = []
    if (items.length > NEW_ARRIVALS_COUNT) {
      const sorted = [...items].sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))
      sections.push({
        id: 'floor-new',
        key: 'floor-new',
        kicker: floor.newArrivals?.kicker || '',
        title: floor.newArrivals?.title || '',
        count: NEW_ARRIVALS_COUNT,
        items: sorted.slice(0, NEW_ARRIVALS_COUNT),
      })
    }
    if (lendingEnabled) {
      const onLoan = items.filter((it) => it.lending)
      if (onLoan.length) {
        sections.push({
          id: 'floor-loan',
          key: 'floor-loan',
          kicker: floor.onLoan?.kicker || '',
          title: floor.onLoan?.title || '',
          count: onLoan.length,
          items: onLoan,
        })
      }
    }
    const pinned = items.filter((it) => it.pinned)
    if (pinned.length) {
      sections.push({
        id: 'floor-pinned',
        key: 'floor-pinned',
        kicker: floor.pinned?.kicker || '',
        title: floor.pinned?.title || '',
        count: pinned.length,
        items: pinned,
      })
    }
    return sections
  }, [items, lendingEnabled, floor])

  // The Floor activates once the collection grows past NEW_ARRIVALS_COUNT
  // items (e.g. > 5) — below that the plain grid is the whole store and
  // curated shelves would just duplicate it.
  const showFloor =
    status === 'ready' &&
    items.length > NEW_ARRIVALS_COUNT &&
    view === 'grid' &&
    sortBy === 'added' &&
    !hasActiveFilters &&
    floorSections.length > 0

  function openItem(item) {
    setSelectedItem(item)
    setModal('detail')
  }

  // Crate dive (§ Phase 1): like pulling a random record off the shelf —
  // opens a random item's detail sheet.
  function handleCrateDive() {
    if (!items.length) return
    const pick = items[Math.floor(Math.random() * items.length)]
    setSelectedItem(pick)
    setModal('detail')
  }

  // Pin/unpin (§ Phase 1): `pinned` is an additive item field (the collection
  // PUT spreads any patch, so no server change). Optimistic via useCollection.
  async function handleTogglePinned(item) {
    const next = !item.pinned
    try {
      await update(item.id, { pinned: next })
      setSelectedItem((prev) => (prev ? { ...prev, pinned: next } : prev))
      showToast(next ? (floor.pinnedToast || 'Pinned') : (floor.unpinnedToast || 'Unpinned'))
    } catch {
      showToast(t('view.couldNotSave'), 'error')
    }
  }

  // The Aisles (§ Phase 2): picking a bin applies it as a filter; the chip
  // above the grid shows the active bin and clears it.
  const activeAisleLabel = useMemo(() => {
    if (!activeAisle) return ''
    const axis = catalog.browseAxes?.find((a) => a.id === activeAisle.axisId)
    return axis ? `${axis.label}: ${activeAisle.value}` : activeAisle.value
  }, [activeAisle, catalog])

  function handlePickAisle(axisId, value) {
    setActiveAisle({ axisId, value })
    setAisleSheetOpen(false)
  }

  function handleClearAisle() {
    setActiveAisle(null)
  }

  // The Catalog (§ Phase 3): a "did you mean" suggestion when a query matches
  // nothing, and the recent-searches history (committed on Enter or blur).
  const suggestion = useMemo(() => (hasQuery ? didYouMean(items, debouncedQuery) : null), [items, hasQuery, debouncedQuery])

  function commitRecentSearch(q) {
    const clean = q.trim()
    if (!clean) return
    setRecentSearches((prev) => [clean, ...prev.filter((s) => s !== clean)].slice(0, 6))
  }

  function handleSearchCommit() {
    const q = query.trim()
    if (q) commitRecentSearch(q)
  }

  function handleSearchBlur() {
    setSearchFocused(false)
    const q = query.trim()
    if (q) commitRecentSearch(q)
  }

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
        showToast(`${catalog.lookupName} ${t('view.lookupsNotConfigured', { lookupName: catalog.lookupName })}`, 'error')
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
    // Defensive: a free user at the cap should never reach here — the FAB and
    // empty-state entries are gated — but guard anyway so no doomed POST fires.
    if (atLimit) {
      showToast(t('plan.limitToast'), 'error')
      return
    }
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
    } catch (err) {
      // Server branchable codes (T3): the free-tier cap and the read-only demo
      // space get clear upgrade/sign-in prompts instead of a generic save error.
      if (err?.code === 'PLAN_LIMIT') {
        showToast(t('plan.limitToast'), 'error')
      } else if (err?.code === 'DEMO_READONLY') {
        showToast(t('demo.readOnlyToast'), 'error')
      } else {
        showToast(t('view.couldNotSave'), 'error')
      }
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
    showToast(copy.removedToast || t('catalog.removedToast'), 'remove')
  }

  async function handleSaveNotes(notes) {
    if (!selectedItem) return
    await update(selectedItem.id, { notes })
    setSelectedItem((prev) => (prev ? { ...prev, notes } : prev))
  }

  // Lending (W6): optimistic lend/return go through the hook (which keeps
  // `items` in sync and rolls back on failure). We mirror the same item patch
  // onto the OPEN sheet's `selectedItem` so the detail reflects the change
  // live — the shape matches what useCollection / the lending function store.
  async function handleLend(payload) {
    if (!selectedItem) return
    await lend(selectedItem.id, payload)
    setSelectedItem((prev) => (prev ? {
      ...prev,
      lending: {
        borrower: {
          name: payload.borrower.name,
          ...(payload.borrower.contact ? { contact: payload.borrower.contact } : {}),
        },
        lentOn: new Date().toISOString(),
        ...(payload.dueOn ? { dueOn: payload.dueOn } : {}),
      },
    } : prev))
  }

  async function handleReturn() {
    if (!selectedItem) return
    await returnItem(selectedItem.id)
    setSelectedItem((prev) => {
      if (!prev) return prev
      const updated = { ...prev }
      if (prev.lending) {
        const record = { ...prev.lending, returnedOn: new Date().toISOString() }
        updated.lendingHistory = [record, ...(prev.lendingHistory || [])].slice(0, 10)
      }
      delete updated.lending
      return updated
    })
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
    // W7: "On loan" — an item passes when item.lending is present.
    if (activeLending) {
      list = list.filter((it) => !!it.lending)
    }
    // The Aisles (§ Phase 2): a selected bin filters to items in that bin.
    if (activeAisle) {
      const axis = catalog.browseAxes?.find((a) => a.id === activeAisle.axisId)
      if (axis) list = list.filter((it) => itemInBin(it, axis, activeAisle.value))
    }
    // The Catalog (§ Phase 3): with a query, OPAC-style fuzzy + ranked search
    // (relevance overrides the sort). Otherwise the normal sort applies.
    let sorted
    if (hasQuery) {
      sorted = searchItems(list, debouncedQuery)
    } else {
      sorted = [...list]
      if (sortBy === 'artist') {
        const locale = getLocale()
        sorted.sort((a, b) => {
          const artistCmp = splitArtistTitle(a.title).artist.localeCompare(splitArtistTitle(b.title).artist, locale)
          return artistCmp !== 0 ? artistCmp : (a.title || '').localeCompare(b.title || '', locale)
        })
      } else if (sortBy === 'year') {
        sorted.sort((a, b) => (b.year || 0) - (a.year || 0))
      } else if (sortBy === 'format') {
        const locale = getLocale()
        sorted.sort((a, b) => (a.formatType || '').localeCompare(b.formatType || '', locale))
      } else if (sortBy === 'title') {
        const locale = getLocale()
        sorted.sort((a, b) => (a.title || '').localeCompare(b.title || '', locale))
      } else {
        sorted.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))
      }
    }
    return sorted
  }, [items, debouncedQuery, activeFormats, activeGenres, activeArtist, activeLending, activeAisle, catalog, sortBy, hasQuery])

  return (
    <>
      {/* Free tier: total-items counter (items.length, not the visible count)
          + the at-cap hint. Shown only for free-plan members — absent for
          owner/unlimited and demo visitors. */}
      {status === 'ready' && isFree && (
        <div className="plan-banner" role="status">
          <span className="plan-banner-counter">
            {t('plan.freeCounter', { count: items.length, cap: FREE_PLAN_CAP })}
          </span>
          {atLimit && (
            <span className="plan-banner-hint">{t('plan.atLimitHint', { cap: FREE_PLAN_CAP })}</span>
          )}
        </div>
      )}

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
          lendingEnabled={lendingEnabled}
          activeLending={activeLending}
          onToggleLending={toggleLending}
          onOpenLoans={onOpenLoans}
          loansButtonRef={loansButtonRef}
          onOpenAisles={() => setAisleSheetOpen(true)}
          aislesOpen={aisleSheetOpen}
          extraFilterCount={activeAisle ? 1 : 0}
          onSearchFocus={() => setSearchFocused(true)}
          onSearchBlur={handleSearchBlur}
          onSearchCommit={handleSearchCommit}
        />
      )}

      {/* W7: empty collection + lending enabled — a minimal toolbar still
          exposes the Loans button so the global dashboard stays reachable. */}
      {status === 'ready' && items.length === 0 && lendingEnabled && (
        <Toolbar
          minimal
          copy={copy}
          lendingEnabled={lendingEnabled}
          onOpenLoans={onOpenLoans}
          loansButtonRef={loansButtonRef}
        />
      )}

      {searchFocused && !query.trim() && recentSearches.length > 0 && (
        <div className="recent-searches">
          <span className="recent-searches-title">{copy.search?.recentTitle || 'Recent searches'}</span>
          <div className="recent-searches-chips">
            {recentSearches.map((s) => (
              <button
                key={s}
                type="button"
                className="recent-chip"
                onClick={() => { setQuery(s); setSearchFocused(false) }}
              >
                {s}
              </button>
            ))}
            <button type="button" className="recent-clear" onClick={() => setRecentSearches([])}>
              {copy.search?.clearRecent || 'Clear recent'}
            </button>
          </div>
        </div>
      )}

      <main className="app-main">
        {status === 'loading' && <p className="status-line">{copy.loading}</p>}

        {status === 'error' && (
          <div className="status-line status-error">
            <p>{t('view.couldNotReach', { error })}</p>
            <button type="button" className="btn btn-ghost" onClick={refresh}>{t('common.tryAgain')}</button>
          </div>
        )}

        {status === 'ready' && items.length === 0 && (
          <EmptyState
            copy={copy}
            onScan={isDemo ? undefined : () => setModal('scan')}
            onManualAdd={isDemo ? undefined : () => setModal('manual')}
          />
        )}

        {status === 'ready' && items.length > 0 && visibleItems.length === 0 && hasQuery && suggestion && (
          <div className="did-you-mean">
            <span>{copy.search?.didYouMeanPrefix || 'Did you mean'}: </span>
            <button type="button" className="did-you-mean-btn" onClick={() => setQuery(suggestion)}>
              {suggestion}
            </button>
          </div>
        )}

        {status === 'ready' && items.length > 0 && visibleItems.length === 0 && (
          <EmptyState kind="no-results" copy={copy} onClear={clearFilters} />
        )}

        {status === 'ready' && hasQuery && visibleItems.length > 0 && (
          <div className="search-summary">
            <span className="search-summary-text">
              {typeof copy.search?.results === 'function'
                ? copy.search.results(visibleItems.length, debouncedQuery)
                : `${visibleItems.length} matches`}
            </span>
            <button
              type="button"
              className="btn btn-ghost section-action-btn"
              onClick={() => setQuery('')}
              aria-label={copy.search?.clear || 'Clear search results'}
            >
              Clear
            </button>
          </div>
        )}

        {activeAisle && (
          <div className="aisle-chip-row">
            <button
              type="button"
              className="aisle-chip"
              onClick={handleClearAisle}
              aria-label={`${copy.browse?.clear || 'Clear browse'}: ${activeAisleLabel}`}
            >
              <span className="aisle-chip-label">{activeAisleLabel}</span>
              <span className="aisle-chip-clear" aria-hidden="true">✕</span>
            </button>
          </div>
        )}

        {status === 'ready' && visibleItems.length > 0 && showFloor && (
          <div className="collection-floor">
            {floorSections.map((section) => (
              <section key={section.key} className="floor-section" aria-labelledby={section.id}>
                <SectionHeader id={section.id} kicker={section.kicker} title={section.title} count={section.count} />
                <CoverShelf
                  items={section.items}
                  Card={Card}
                  onOpen={openItem}
                  lendingEnabled={lendingEnabled}
                  copy={copy}
                  label={section.title}
                />
              </section>
            ))}

            <section className="floor-section" aria-labelledby="floor-browse-all">
              <SectionHeader
                id="floor-browse-all"
                kicker={floor.browseAll?.kicker || ''}
                title={floor.browseAll?.title || ''}
                count={items.length}
                action={!isDemo && (
                  <button
                    type="button"
                    className="btn btn-ghost section-action-btn"
                    onClick={handleCrateDive}
                    aria-label={floor.diveAria || floor.dive}
                  >
                    {floor.dive}
                  </button>
                )}
              />
              <Grid items={visibleItems} onOpen={openItem} lendingEnabled={lendingEnabled} copy={copy} query={debouncedQuery} />
            </section>
          </div>
        )}

        {status === 'ready' && visibleItems.length > 0 && !showFloor && (
          view === 'list' ? (
            <ListView
              items={visibleItems}
              sortBy={sortBy}
              copy={copy}
              lendingEnabled={lendingEnabled}
              onOpen={openItem}
              query={debouncedQuery}
            />
          ) : (
            <Grid items={visibleItems} onOpen={openItem} lendingEnabled={lendingEnabled} copy={copy} query={debouncedQuery} />
          )
        )}

        {status === 'ready' && items.length > 0 && (
          <span className="visually-hidden" role="status" aria-live="polite">
            {copy.view?.showing ? copy.view.showing(visibleItems.length, items.length) : ''}
          </span>
        )}
      </main>

      {items.length > 0 && !isDemo && (
        <>
          {fabOpen && !atLimit && <div className="fab-overlay" onClick={closeFab} aria-hidden="true" />}
          <div
            className="fab-menu"
            role="menu"
            aria-label={copy.fabMenu.label}
            ref={fabMenuRef}
            hidden={!fabOpen || atLimit}
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
            className={`fab${atLimit ? ' at-limit' : ''}`}
            aria-haspopup="menu"
            aria-expanded={fabOpen}
            aria-disabled={atLimit || undefined}
            onClick={atLimit
              ? () => showToast(t('plan.limitToast'), 'error')
              : () => setFabOpen((s) => !s)}
            aria-label={atLimit ? t('plan.limitFab') : t('common.scan')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 7V4a1 1 0 0 1 1-1h3M17 3h3a1 1 0 0 1 1 1v3M21 17v3a1 1 0 0 1-1 1h-3M7 21H4a1 1 0 0 1-1-1v-3" />
              <path d="M7 12h10" />
            </svg>
            <span>{t('common.scan')}</span>
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
          isDemo={isDemo}
        />
      )}

      {modal === 'detail' && selectedItem && (
        <Detail
          item={selectedItem}
          catalog={catalog}
          onClose={() => { setModal(null); setSelectedItem(null) }}
          onDelete={handleDelete}
          onSaveNotes={handleSaveNotes}
          onTogglePinned={() => handleTogglePinned(selectedItem)}
          lendingEnabled={lendingEnabled}
          onLend={handleLend}
          onReturn={handleReturn}
          showToast={showToast}
          isDemo={isDemo}
        />
      )}

      {aisleSheetOpen && (
        <AisleSheet
          axes={catalog.browseAxes || []}
          items={items}
          activeAisle={activeAisle}
          onPick={handlePickAisle}
          onClear={handleClearAisle}
          onClose={() => setAisleSheetOpen(false)}
          copy={copy}
        />
      )}
    </>
  )
}
