import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Toolbar from './components/Toolbar'
import ListView from './components/ListView'
import EmptyState from './components/EmptyState'
import SectionHeader from './components/SectionHeader'
import CoverShelf from './components/CoverShelf'
import MatchPicker from './components/MatchPicker'
import ScanResult from './components/ScanResult'
import AisleSheet from './components/AisleSheet'
import CollectionStats from './components/CollectionStats'
import WishlistSheet from './components/WishlistSheet'
import PlayPanel from './components/PlayPanel'
import { useCollection } from './hooks/useCollection'
import { findRelated, splitArtistTitle, searchItems, didYouMean } from './utils/match'
import { extractSearchQuery } from './utils/ocrText'
import { itemInBin } from './utils/browse'
import { track } from './utils/track'
import { t, getLocale } from './i18n'
import './App.css'

// The WASM barcode decoder is heavy — only worth loading once the person
// actually taps "Scan", not on first paint.
const ScannerModal = lazy(() => import('./components/ScannerModal'))
// Cover OCR is heavier still (Tesseract wasm + traineddata), so the capture
// modal is also lazy — it only loads when someone actually scans a cover.
const CoverScanModal = lazy(() => import('./components/CoverScanModal'))

function cleanBarcode(raw) {
  return String(raw).replace(/[^0-9Xx]/g, '')
}

// Load the persisted browse path (§ Phase 4) — filters/sort/aisle are restored
// across reloads and offline, per-kind keying like runout.view.<kind>.
function loadBrowseState(kind) {
  try {
    const raw = localStorage.getItem(`runout.browse.${kind}`)
    const s = raw ? JSON.parse(raw) : null
    return s && typeof s === 'object' ? s : {}
  } catch { return {} }
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
export default function CollectionView({ catalog, onRequestSettings, lendingEnabled, onOpenLoans, onOpenPaywall, refreshTick, loansButtonRef, planStatus = 'free', isFree = false, isDemo = false, gamificationEnabled = false }) {
  const { items, status, error, add, update, remove, refresh, lend, returnItem } = useCollection(catalog.storage)

  // Partition (§ Fix): wishlist items are UNOWNED wants — they never count as
  // owned, and never appear in the crate/shelf, stats, aisles or search.
  // `wishlistItems` feeds the dedicated Wishlist sheet; converting flips the
  // flag off and the item joins `ownedItems` (the shelf).
  const ownedItems = useMemo(() => items.filter((it) => !it.wishlist), [items])
  const wishlistItems = useMemo(() => items.filter((it) => it.wishlist), [items])

  const [modal, setModal] = useState(null) // 'scan' | 'cover' | 'pick' | 'manual' | 'result' | 'detail'
  const [pickerState, setPickerState] = useState({ matches: null, loading: false, errorMsg: '' })
  // Cover OCR progress lives INSIDE the cover modal ("Reading the cover…" /
  // error with retry), so the modal stays mounted until OCR + lookup resolve
  // and a failure is shown in the cover flow, never a blank picker.
  const [coverState, setCoverState] = useState({ busy: false, error: '' })
  const [scanCandidate, setScanCandidate] = useState(null) // { candidate, ownedExact, wishlistExact, sameAlbum, otherArtist }
  const [selectedItem, setSelectedItem] = useState(null)
  const [toast, setToast] = useState(null) // { msg, kind: 'add' | 'remove' | 'error' }
  const toastTimer = useRef(null)
  // C2.4 (issue #88): records token availability, learned from the server.
  // Defaults to off (no hint). The Discogs proxy reports SERVER_NO_TOKEN when
  // no token is configured; we keep a persistent, non-blocking hint in the
  // empty state after that signal and clear it once lookups succeed.
  const [recordsNoToken, setRecordsNoToken] = useState(false)

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  // The browse path (§ Phase 4) is persisted per kind so filters/sort/aisle
  // survive a reload and work offline. Parsed once; seeds the state below.
  const [browseState] = useState(() => loadBrowseState(catalog.kind))
  const [activeFormats, setActiveFormats] = useState(() => (Array.isArray(browseState.activeFormats) ? browseState.activeFormats : []))
  const [activeGenres, setActiveGenres] = useState(() => (Array.isArray(browseState.activeGenres) ? browseState.activeGenres : []))
  const [activeArtist, setActiveArtist] = useState(() => browseState.activeArtist || '')
  const [activeLending, setActiveLending] = useState(() => !!browseState.activeLending)
  const [sortBy, setSortBy] = useState(() => (catalog.sortOptions.some((o) => o.value === browseState.sortBy) ? browseState.sortBy : 'added'))
  // The Aisles (§ Phase 2): a selected browse bin ({ axisId, value }) acts as
  // a filter; the sheet is the picker. Only restore it if the axis still exists.
  const [activeAisle, setActiveAisle] = useState(() => {
    const a = browseState.activeAisle
    return a && a.axisId && catalog.browseAxes?.some((ax) => ax.id === a.axisId) ? a : null
  })
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
  // Jump-to-top (§ Phase 4): shown once the user scrolls deep.
  const [showJumpTop, setShowJumpTop] = useState(false)

  // Free tier: the counter reflects the OWNED collection (ownedItems.length,
  // not the filtered/visible count; wishlist wants are excluded) and add flows
  // are gated once the cap is reached so a free user never attempts an add the
  // server will reject with PLAN_LIMIT.
  const atLimit = isFree && ownedItems.length >= FREE_PLAN_CAP

  // S6 lending gate: a free member sees a gated "Lending" affordance in the
  // detail sheet that opens the paywall (reason 'feature'). Never for demo
  // visitors (read-only, no paywall) — LendingControls renders null for them.
  const lendingGate = !lendingEnabled && isFree && !isDemo

  // S6: report WHY the collection is blocked. CollectionView never decides
  // what to render — App owns the paywall modal.
  function openPaywall(reason, feature) {
    onOpenPaywall?.({ reason, kind: catalog.kind, ...(feature ? { feature } : {}) })
  }

  // Grid vs List, remembered per kind (§4.6).
  const [view, setView] = useState(() => {
    try { return localStorage.getItem(`runout.view.${catalog.kind}`) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  useEffect(() => {
    try { localStorage.setItem(`runout.view.${catalog.kind}`, view) } catch { /* ignore */ }
  }, [view, catalog.kind])

  // Persist the browse path (§ Phase 4) — filters/sort/aisle across reloads.
  useEffect(() => {
    const state = { sortBy, activeFormats, activeGenres, activeArtist, activeLending, activeAisle }
    try { localStorage.setItem(`runout.browse.${catalog.kind}`, JSON.stringify(state)) } catch { /* ignore */ }
  }, [sortBy, activeFormats, activeGenres, activeArtist, activeLending, activeAisle, catalog.kind])

  // Stats sheet (§ Phase 5), saved views (persisted per kind, capped at 20)
  // and the Wishlist sheet (§ Fix — unowned wants).
  const [wishlistOpen, setWishlistOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  // Gamification (Phase 1 § Play): the "Play" entry point is gated by the
  // member's `features.games` entitlement (admin-granted) — the modal only
  // mounts when the entitlement is on (passed as `gamificationEnabled` from
  // App.jsx).
  const [playOpen, setPlayOpen] = useState(false)
  const [savedViews, setSavedViews] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`runout.views.${catalog.kind}`) || '[]') } catch { return [] }
  })

  // Persist the recent-searches list (capped at 6, most recent first).
  useEffect(() => {
    try { localStorage.setItem(`runout.recentSearches.${catalog.kind}`, JSON.stringify(recentSearches)) } catch { /* ignore */ }
  }, [recentSearches, catalog.kind])

  // Jump-to-top (§ Phase 4): capture-phase scroll listener catches both the
  // page scroll (grid) and the list's own scroller.
  useEffect(() => {
    function onScroll() {
      const scroller = document.querySelector('.list-scroller')
      const deep = (window.scrollY || 0) > 400 || (scroller ? scroller.scrollTop > 400 : false)
      setShowJumpTop(deep)
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    onScroll()
    return () => document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  // Persist saved views (§ Phase 5), capped at 20.
  useEffect(() => {
    try { localStorage.setItem(`runout.views.${catalog.kind}`, JSON.stringify(savedViews.slice(-20))) } catch { /* ignore */ }
  }, [savedViews, catalog.kind])

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
    if (ownedItems.length > NEW_ARRIVALS_COUNT) {
      const sorted = [...ownedItems].sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))
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
      const onLoan = ownedItems.filter((it) => it.lending)
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
    const pinned = ownedItems.filter((it) => it.pinned)
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
  }, [ownedItems, lendingEnabled, floor])

  // The Floor activates once the collection grows past NEW_ARRIVALS_COUNT
  // items (e.g. > 5) — below that the plain grid is the whole store and
  // curated shelves would just duplicate it.
  const showFloor =
    status === 'ready' &&
    ownedItems.length > NEW_ARRIVALS_COUNT &&
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
    if (!ownedItems.length) return
    const pick = ownedItems[Math.floor(Math.random() * ownedItems.length)]
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

  // Wishlist (§ Fix): UNOWNED wants, kept separate from the owned crate.
  // Converting flips the `wishlist` flag off so the item joins the owned
  // collection and appears on the shelf/Floor. Removing deletes it outright.
  async function handleAddToWishlist(candidate) {
    const payload = { ...candidate, wishlist: true }
    delete payload.id
    delete payload.dateAdded
    delete payload.notes
    try {
      await add({ ...payload, notes: '' })
      setModal(null)
      setScanCandidate(null)
      showToast(copy.wishlist?.addedToast || 'Added to your wishlist', 'add')
    } catch (err) {
      if (err?.code === 'PLAN_LIMIT') {
        showToast(t('plan.limitToast'), 'error')
        openPaywall('cap')
      } else if (err?.code === 'DEMO_READONLY') showToast(t('demo.readOnlyToast'), 'error')
      else showToast(t('view.couldNotSave'), 'error')
    }
  }

  async function handleConvertToOwned(item) {
    if (!item) return
    // Wishlist → owned grows the owned count: gate the convert at the cap (the
    // server caps `{ wishlist: false }` too — this keeps the UI honest).
    if (atLimit) {
      showToast(t('plan.limitToast'), 'error')
      openPaywall('cap')
      return
    }
    try {
      await update(item.id, { wishlist: false })
      setWishlistOpen(false)
      setModal(null)
      setScanCandidate(null)
      setSelectedItem(null)
      showToast(copy.wishlist?.addToCrateToast || 'Added to your crate', 'add')
    } catch (err) {
      if (err?.code === 'PLAN_LIMIT') {
        showToast(t('plan.limitToast'), 'error')
        openPaywall('cap')
      } else if (err?.code === 'DEMO_READONLY') showToast(t('demo.readOnlyToast'), 'error')
      else showToast(t('view.couldNotSave'), 'error')
    }
  }

  async function handleRemoveFromWishlist(item) {
    try {
      await remove(item.id)
      showToast(copy.wishlist?.removeToast || 'Removed from your wishlist', 'remove')
    } catch {
      showToast(t('view.couldNotSave'), 'error')
    }
  }

  // Saved views (§ Phase 5): capture the current filter set under a name, or
  // apply / delete / rename one. Filters only (search + sort stay live).
  function handleSaveView(name) {
    const state = { activeFormats, activeGenres, activeArtist, activeLending }
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${savedViews.length}`
    setSavedViews((prev) => [...prev, { id, name, state }].slice(-20))
  }
  function handleApplyView(state) {
    setActiveFormats(Array.isArray(state?.activeFormats) ? state.activeFormats : [])
    setActiveGenres(Array.isArray(state?.activeGenres) ? state.activeGenres : [])
    setActiveArtist(state?.activeArtist || '')
    setActiveLending(!!state?.activeLending)
  }
  function handleDeleteView(id) {
    setSavedViews((prev) => prev.filter((v) => v.id !== id))
  }
  function handleRenameView(id, name) {
    setSavedViews((prev) => prev.map((v) => (v.id === id ? { ...v, name } : v)))
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

  // Jump-to-top (§ Phase 4): scroll the list's own container when in list
  // view, otherwise the page. Reduced-motion users get an instant jump.
  function jumpToTop() {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const behavior = reduce ? 'auto' : 'smooth'
    const scroller = document.querySelector('.list-scroller')
    if (scroller) {
      scroller.scrollTo?.({ top: 0, behavior })
      return
    }
    try { window.scrollTo({ top: 0, behavior }) } catch { /* jsdom / no-op */ }
  }

  // The Catalog (§ Phase 3): a "did you mean" suggestion when a query matches
  // nothing, and the recent-searches history (committed on Enter or blur).
  const suggestion = useMemo(() => (hasQuery ? didYouMean(ownedItems, debouncedQuery) : null), [ownedItems, hasQuery, debouncedQuery])

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
  // `wishlistExact` lets the scan result offer "Own it" for an existing want.
  function presentCandidate(candidate, source = 'manual') {
    // Defensive: a malformed candidate must never crash the result sheet (no
    // error boundary — a render throw unmounts to the dark screen).
    if (!candidate || typeof candidate !== 'object') return
    const { ownedExact, wishlistExact, sameAlbum, otherArtist } = findRelated(candidate, ownedItems, wishlistItems)
    // `source` feeds gamif_item_added ('scan' vs 'manual') — the G-2 funnel
    // join key (Phase 0 §4). Camera paths pass 'scan'; everything else
    // (manual form, text search) defaults to 'manual'.
    setScanCandidate({ candidate, ownedExact, wishlistExact, sameAlbum, otherArtist, source })
    setModal('result')
  }

  async function handleBarcodeDetected(barcode) {
    const clean = cleanBarcode(barcode)

    // Already scanned this exact barcode before — answer instantly, no
    // network round-trip needed. Also means it still works on bad shop wifi.
    const localMatch = items.find((it) => it.barcode && it.barcode === clean)
    if (localMatch) {
      presentCandidate(localMatch, 'scan')
      return
    }

    setModal('pick')
    setPickerState({ matches: null, loading: true, errorMsg: '' })
    try {
      const results = await catalog.api.searchByBarcode(clean)
      // A successful lookup means a token is configured — drop any hint.
      setRecordsNoToken(false)
      if (results.length === 1) {
        presentCandidate(results[0], 'scan')
      } else {
        setPickerState({ matches: results, loading: false, errorMsg: '' })
      }
    } catch (err) {
      if (err.code === 'SERVER_NO_TOKEN') {
        // C2.4 (issue #88): remember the missing token so the empty state can
        // show a persistent hint (the toast below stays as-is).
        setRecordsNoToken(true)
        onRequestSettings()
        showToast(`${catalog.lookupName} ${t('view.lookupsNotConfigured', { lookupName: catalog.lookupName })}`, 'error')
        return
      }
      setPickerState({ matches: [], loading: false, errorMsg: err.message })
    }
  }

  // Cover OCR (§ cover-scan-ocr): read artist/title (or a visible barcode) off
  // a photo of the cover with on-device Tesseract, then funnel whatever we get
  // through the SAME duplicate-checked add path as a barcode scan. The modal
  // stays open on a visible "Reading the cover…" progress (`coverState.busy`)
  // while OCR + lookup run; on success it switches to the picker/result, on
  // failure the error is shown INSIDE the cover flow (retry / re-pick). Must
  // never crash on empty/weird OCR output — there's no error boundary.
  async function handleCoverCaptured(blob) {
    setCoverState({ busy: true, error: '' })
    try {
      const { recognizeImage } = await import('./utils/ocr')
      const { lines } = await recognizeImage(blob)
      const { query, barcode } = extractSearchQuery(lines, catalog.kind)
      let results = null
      if (barcode) {
        results = await catalog.api.searchByBarcode(barcode)
      } else if (query) {
        results = await catalog.api.searchByText(query)
      }
      // Nothing readable on the cover — surface a friendly hint instead of
      // fabricating a search. Stays inside the cover flow.
      if (results === null) {
        throw new Error(copy.coverScan?.noText || t('coverScan.noText'))
      }
      const safeResults = Array.isArray(results) ? results : []
      // A successful lookup means a token is configured — drop any hint.
      setRecordsNoToken(false)
      setCoverState({ busy: false, error: '' })
      if (safeResults.length === 0) {
        setModal('pick')
        setPickerState({ matches: [], loading: false, errorMsg: '' })
      } else if (safeResults.length === 1 && safeResults[0] && typeof safeResults[0] === 'object') {
        presentCandidate(safeResults[0], 'scan')
      } else {
        setModal('pick')
        setPickerState({ matches: safeResults, loading: false, errorMsg: '' })
      }
    } catch (err) {
      if (err.code === 'SERVER_NO_TOKEN') {
        // C2.4 (issue #88): remember the missing token for the empty-state hint.
        setRecordsNoToken(true)
        onRequestSettings()
        showToast(`${catalog.lookupName} ${t('view.lookupsNotConfigured', { lookupName: catalog.lookupName })}`, 'error')
        setCoverState({ busy: false, error: '' })
        setModal(null)
        return
      }
      // OCR or lookup failure: surface the error inside the cover flow so the
      // user can retry / pick a photo again — never a blank picker.
      setCoverState({
        busy: false,
        error: err?.code === 'OCR_TIMEOUT'
          ? (copy.coverScan?.timedOut || t('coverScan.timedOut'))
          : (err?.message || copy.coverScan?.error || t('coverScan.error')),
      })
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
      openPaywall('cap')
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
      // G-2 funnel join key (Phase 0 §4): every owned add emits
      // gamif_item_added with its kind and source (scan vs manual). track()
      // is default-off — harmless today, joinable later.
      track('gamif_item_added', {
        kind: catalog.kind === 'books' ? 'books' : 'records',
        source: scanCandidate?.source === 'scan' ? 'scan' : 'manual',
      })
      setModal(null)
      setScanCandidate(null)
      showToast(copy.addToast, 'add')
    } catch (err) {
      // Server branchable codes (T3): the free-tier cap and the read-only demo
      // space get clear upgrade/sign-in prompts instead of a generic save error.
      if (err?.code === 'PLAN_LIMIT') {
        showToast(t('plan.limitToast'), 'error')
        openPaywall('cap')
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
    // A wishlist want deleted from its Detail sheet runs the same remove path
    // (it deletes the want), but the success toast says "wishlist", not crate.
    const wasWant = !!selectedItem?.wishlist
    setModal(null)
    setSelectedItem(null)
    showToast(wasWant
      ? (copy.wishlist?.removeToast || 'Removed from your wishlist')
      : (copy.removedToast || t('catalog.removedToast')), 'remove')
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

  // Opening the cover flow always starts from a clean (non-busy) state.
  function openCoverScan() {
    setCoverState({ busy: false, error: '' })
    setModal('cover')
  }

  function fabAction(m) {
    setFabOpen(false)
    if (m === 'cover') {
      openCoverScan()
      return
    }
    setModal(m)
  }

  const visibleItems = useMemo(() => {
    let list = ownedItems
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
  }, [ownedItems, debouncedQuery, activeFormats, activeGenres, activeArtist, activeLending, activeAisle, catalog, sortBy, hasQuery])

  return (
    <>
      {/* Free tier: total-items counter (items.length, not the visible count)
          + the at-cap hint. Shown only for free-plan members — absent for
          owner/unlimited and demo visitors. */}
      {status === 'ready' && isFree && (
        <div className="plan-banner">
          <div className="plan-banner-status" role="status">
            <span className="plan-banner-counter">
              {t('plan.freeCounter', { count: ownedItems.length, cap: FREE_PLAN_CAP })}
            </span>
            {atLimit && (
              <span className="plan-banner-hint">{t('plan.atLimitHint', { cap: FREE_PLAN_CAP })}</span>
            )}
          </div>
          {!isDemo && (
            <button
              type="button"
              className="plan-banner-upgrade"
              onClick={() => openPaywall(planStatus === 'expired' ? 'expired' : 'upgrade')}
            >
              {t('paywall.cta')}
            </button>
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
          onOpenStats={() => setStatsOpen(true)}
          statsOpen={statsOpen}
          onOpenPlay={gamificationEnabled ? () => setPlayOpen(true) : undefined}
          playLabel={copy.gamif?.nav || 'Play'}
          onOpenWishlist={() => setWishlistOpen(true)}
          wishlistOpen={wishlistOpen}
          wishlistCount={wishlistItems.length}
          savedViews={savedViews}
          onSaveView={handleSaveView}
          onApplyView={handleApplyView}
          onDeleteView={handleDeleteView}
          onRenameView={handleRenameView}
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

        {status === 'ready' && ownedItems.length === 0 && (
          <EmptyState
            copy={copy}
            noToken={catalog.kind === 'records' && recordsNoToken}
            onScan={isDemo ? undefined : () => setModal('scan')}
            onScanCover={isDemo ? undefined : openCoverScan}
            onManualAdd={isDemo ? undefined : () => setModal('manual')}
          />
        )}

        {status === 'ready' && ownedItems.length > 0 && visibleItems.length === 0 && hasQuery && suggestion && (
          <div className="did-you-mean">
            <span>{copy.search?.didYouMeanPrefix || 'Did you mean'}: </span>
            <button type="button" className="did-you-mean-btn" onClick={() => setQuery(suggestion)}>
              {suggestion}
            </button>
          </div>
        )}

        {status === 'ready' && ownedItems.length > 0 && visibleItems.length === 0 && (
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
                count={ownedItems.length}
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

        {status === 'ready' && ownedItems.length > 0 && (
          <span className="visually-hidden" role="status" aria-live="polite">
            {copy.view?.showing ? copy.view.showing(visibleItems.length, ownedItems.length) : ''}
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
            <button type="button" role="menuitem" className="fab-option" onClick={() => fabAction('cover')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              {copy.fabMenu.scanCover}
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
              ? () => openPaywall('cap')
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

      {showJumpTop && (
        <button
          type="button"
          className="jump-top"
          onClick={jumpToTop}
          aria-label={copy.view?.backToTop || 'Back to top'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
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

      {modal === 'cover' && (
        <Suspense fallback={<div className="scanner-loading">Starting camera…</div>}>
          <CoverScanModal
            copy={copy}
            onCaptured={handleCoverCaptured}
            onClose={() => { setModal(null); setCoverState({ busy: false, error: '' }) }}
            busy={coverState.busy}
            busyError={coverState.error}
          />
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
          wishlistExact={scanCandidate.wishlistExact}
          sameAlbum={scanCandidate.sameAlbum}
          otherArtist={scanCandidate.otherArtist}
          onAdd={handleAddCandidate}
          onAddToWishlist={handleAddToWishlist}
          onOwnWishlist={() => handleConvertToOwned(scanCandidate.wishlistExact)}
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
          lendingGate={lendingGate}
          onLend={handleLend}
          onReturn={handleReturn}
          showToast={showToast}
          isDemo={isDemo}
          onOpenPaywall={(p) => onOpenPaywall?.({ ...p, kind: catalog.kind })}
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

      {statsOpen && (
        <CollectionStats items={ownedItems} onClose={() => setStatsOpen(false)} copy={copy} />
      )}

      {wishlistOpen && (
        <WishlistSheet
          items={wishlistItems}
          onConvert={handleConvertToOwned}
          onRemove={handleRemoveFromWishlist}
          onClose={() => setWishlistOpen(false)}
          // Tapping a wishlist row opens the full Detail sheet. Close the
          // wishlist first — both sheets share the same overlay z-index and
          // the wishlist renders later in the DOM, so it would cover the
          // detail otherwise.
          onOpenItem={(item) => { setWishlistOpen(false); openItem(item) }}
          copy={copy}
          isDemo={isDemo}
        />
      )}

      {status === 'ready' && gamificationEnabled && playOpen && (
        <PlayPanel items={ownedItems} catalog={catalog} onClose={() => setPlayOpen(false)} />
      )}
    </>
  )
}
