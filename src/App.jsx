import { useCallback, useEffect, useRef, useState } from 'react'
import Header from './components/Header'
import SettingsModal from './components/SettingsModal'
import CreditModal from './components/CreditModal'
import FeedbackModal from './components/FeedbackModal'
import LoansDashboard from './components/LoansDashboard'
import DemoBanner from './components/DemoBanner'
import CollectionView from './CollectionView'
import AuthScreen from './AuthScreen'
import AdminPanel from './AdminPanel'
import PaywallModal from './components/PaywallModal'
import ErrorBoundary from './components/ErrorBoundary'
import BottomNav from './components/BottomNav'
import HomeScreen from './components/HomeScreen'
import { ThemeProvider } from './theme'
import { recordsCatalog, booksCatalog } from './catalog'
import * as authApi from './api/auth'
import * as paymentApi from './api/payment'
import * as collectionApi from './api/collection'
import { useAuth } from './hooks/useAuth'
import { getSessionToken } from './utils/session'
import { isOverdue } from './utils/lending'
import { t } from './i18n'
import OnlineIndicator from './components/OnlineIndicator'
import './App.css'

const CATALOGS = { records: recordsCatalog, books: booksCatalog }

// S2 entitlements (mirror of netlify/functions/_shared/entitlements.js): the
// paid plans are uncapped and include lending. The server is authoritative;
// this only mirrors `effectiveFeatures` so the client can gate the UI.
const PAID_PLANS = new Set(['premium', 'lifetime', 'unlimited'])
function isPaidPlan(user) {
  return !!user && PAID_PLANS.has(user.plan)
}

// Mirror of the inline `lendingEnabled` derivation below, extracted so the
// overdue-badge fetch can re-check it without a session object swap. Admin
// always has lending; an expired premium only keeps it via an explicit
// `features.lending` flag.
function hasLending(user) {
  if (!user) return false
  if (user.role === 'admin') return true
  if (user.features?.lending) return true
  if (!isPaidPlan(user)) return false
  if (user.plan === 'premium' && user.planExpiresAt && new Date(user.planExpiresAt).getTime() < Date.now()) return false
  return true
}

// Remove a query param from the address bar without a reload — used to strip
// one-time tokens (?magic-link= / ?session_id= / ?checkout=) after handling
// so a reload doesn't re-verify or re-poll.
function stripUrlParams(keys) {
  const params = new URLSearchParams(window.location.search)
  for (const key of keys) params.delete(key)
  const qs = params.toString()
  let url = window.location.pathname
  if (qs) url += `?${qs}`
  url += window.location.hash
  window.history.replaceState({}, '', url)
}
function stripUrlParam(key) { stripUrlParams([key]) }

export default function App() {
  const { session, ready, login, logout, requestAccess, refresh, setSession } = useAuth()
  // Bottom navigation tab: 'home' | 'browse' | 'scan' | 'more'
  // Default is 'home'. Tests and URL params can override via ?tab=browse.
  const initialTab = (() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const tab = params.get('tab')
      if (tab && ['home', 'browse', 'more'].includes(tab)) return tab
    } catch { /* ignore */ }
    // Also check localStorage for test overrides
    try {
      const stored = localStorage.getItem('runout.navTab')
      if (stored && ['home', 'browse', 'more'].includes(stored)) return stored
    } catch { /* ignore */ }
    return 'home'
  })()
  const [navTab, setNavTab] = useState(initialTab)
  // Collection tab within browse: 'records' | 'books'
  const [collectionTab, setCollectionTab] = useState('records')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  // In-app feedback (epic #74, T5 #82): null = closed, { initialType } = open.
  // Settings opens a suggestion; the ErrorBoundary crash card pre-fills a bug.
  const [feedbackOpen, setFeedbackOpen] = useState(null)
  // W7: loans dashboard — owns whether the global overlay is open and a
  // counter that bumps whenever a loan is returned so the visible collection
  // re-fetches and stays in sync.
  const [loansOpen, setLoansOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  // A5.4: global overdue loan count (records + books) surfaced as the badge
  // on the Toolbar Loans button. Refetched on sign-in / plan change / return.
  const [overdueCount, setOverdueCount] = useState(0)
  const loansButtonRef = useRef(null)
  // (ADMIN-EPIC-1, #263) — the owner's glanceable pending-request badge. App
  // owns a LIGHTWEIGHT pending-count fetch (the ?dashboard=1 counts block,
  // never the full adminList — PWA battery) and hands it to Header.
  const [pendingCount, setPendingCount] = useState(0)
  const isAdmin = session?.user?.role === 'admin'

  // S6 paywall: CollectionView reports WHY it's blocked ({ reason, kind,
  // feature? }); App owns the modal and decides what to render.
  const [paywall, setPaywall] = useState(null)
  // App-level feedback for post-checkout / magic-link flows (toasts inside a
  // collection stay local to CollectionView).
  const [appToast, setAppToast] = useState(null)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [signingInViaLink, setSigningInViaLink] = useState(false)
  const appToastTimer = useRef(null)
  const pollTimerRef = useRef(null)
  // Latest session, readable from the async paywall poll (a setState closure
  // would go stale across the 2s polls).
  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session }, [session])

  // A5.4 — keep the Loans-button overdue badge in sync. Fetches both
  // collections (only when lending is enabled) and counts overdue loans; the
  // dashboard also reports its own count via onOverdueCount when it opens, so
  // the badge matches what the user just saw. Errors/offline -> 0 (never throw).
  useEffect(() => {
    if (!hasLending(session?.user)) {
      setOverdueCount(0)
      return undefined
    }
    let cancelled = false
    Promise.all([collectionApi.listItems('records'), collectionApi.listItems('books')])
      .then(([records, books]) => {
        if (cancelled) return
        const all = [...(Array.isArray(records) ? records : []), ...(Array.isArray(books) ? books : [])]
        setOverdueCount(all.filter((it) => !!it?.lending?.dueOn && isOverdue(it.lending.dueOn)).length)
      })
      .catch(() => { if (!cancelled) setOverdueCount(0) })
    return () => { cancelled = true }
  }, [session?.user, refreshTick])

  // (ADMIN-EPIC-1, #263/#264) — pending-request badge, three surfaces, one
  // fetch. Reads counts.pendingRequests from GET /admin?counts=1.
  const refreshPending = useCallback(() => {
    authApi.adminCounts()
      .then((res) => {
        const n = Number(res?.counts?.pendingRequests)
        setPendingCount(Number.isFinite(n) && n > 0 ? n : 0)
      })
      .catch(() => setPendingCount(0))
  }, [])

  useEffect(() => {
    if (!isAdmin) {
      setPendingCount(0)
      return undefined
    }
    let cancelled = false
    const tick = () => { if (!cancelled) refreshPending() }
    tick()
    const id = window.setInterval(tick, 60000)
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [isAdmin, refreshPending])

  const adminWasOpen = useRef(adminOpen)
  useEffect(() => {
    const wasOpen = adminWasOpen.current
    adminWasOpen.current = adminOpen
    if (wasOpen && !adminOpen && isAdmin) refreshPending()
  }, [adminOpen, isAdmin, refreshPending])

  const showAppToast = useCallback((msg, kind = 'add') => {
    if (appToastTimer.current) clearTimeout(appToastTimer.current)
    setAppToast({ msg, kind })
    appToastTimer.current = setTimeout(() => setAppToast(null), 3200)
  }, [])

  // Reset to the first collection when a different user signs in.
  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return undefined
    const user = sessionRef.current?.user
    const collections = user?.collections || {}
    if (!collections.books) {
      setCollectionTab('records')
      return undefined
    }
    let cancelled = false
    Promise.resolve()
      .then(() => collectionApi.listItems('books'))
      .then((items) => {
        if (cancelled) return
        setCollectionTab(Array.isArray(items) && items.length === 0 ? 'books' : 'records')
      })
      .catch(() => {
        if (!cancelled) setCollectionTab('records')
      })
    return () => { cancelled = true }
  }, [session?.user?.id])

  // S1 self-serve signup via magic link.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const params = new URLSearchParams(window.location.search)
    const token = params.get('magic-link')
    if (!token) return undefined
    let cancelled = false
    setSigningInViaLink(true)
    authApi.verifyMagicLink({ token })
      .then((user) => {
        if (cancelled) return
        stripUrlParam('magic-link')
        setSession({ user, session: getSessionToken() })
      })
      .catch(() => {
        if (cancelled) return
        stripUrlParam('magic-link')
        showAppToast(t('paywall.magicLinkError'), 'error')
      })
      .finally(() => { if (!cancelled) setSigningInViaLink(false) })
    return () => { cancelled = true }
  }, [setSession, showAppToast])

  // S6 checkout return.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    const isSuccess = params.get('checkout') === 'success' || params.get('upgrade') === 'success'
    const isCancelled = params.get('checkout') === 'cancelled'
    if (!isSuccess && !isCancelled && !sessionId) return undefined

    stripUrlParams(['checkout', 'session_id', 'upgrade'])
    if (isCancelled) return undefined

    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 15
    const DELAY_MS = 2000
    setConfirmingPayment(true)

    const step = async () => {
      attempts += 1
      let paid = false
      try {
        if (sessionId) {
          const data = await paymentApi.getCheckoutStatus(sessionId)
          if (data?.status === 'complete') {
            const nextUser = data.user || sessionRef.current?.user
            if (nextUser) setSession({ user: nextUser, session: getSessionToken() })
            await refresh()
            paid = true
          }
        } else {
          await refresh()
          paid = isPaidPlan(sessionRef.current?.user)
        }
      } catch {
        // Offline / transient — keep polling.
      }
      if (cancelled) return
      if (paid) {
        setConfirmingPayment(false)
        showAppToast(t('paywall.successToast'), 'add')
        return
      }
      if (attempts >= MAX_ATTEMPTS) return
      pollTimerRef.current = setTimeout(step, DELAY_MS)
    }

    step()
    return () => {
      cancelled = true
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
    }
  }, [refresh, setSession, showAppToast])

  if (!ready) {
    return <div className="status-line">{t('common.loading')}</div>
  }

  if (!session) {
    return (
      <>
        {confirmingPayment && (
          <div className="paywall-notice" role="status" aria-live="polite">
            <span>{t('paywall.stillPending')}</span>
          </div>
        )}
        {signingInViaLink
          ? <div className="status-line">{t('common.loading')}</div>
          : <AuthScreen onLogin={login} onRequestAccess={requestAccess} />}
      </>
    )
  }

  const user = session.user
  const allowed = user.collections || {}
  const available = ['records', 'books'].filter((kind) => allowed[kind])
  const activeCollectionTab = available.includes(collectionTab) ? collectionTab : (available[0] || '')

  const catalog = CATALOGS[activeCollectionTab]

  const isDemo = user.role === 'demo'
  const plan = user.role === 'admin' ? 'unlimited' : (user.plan || 'free')

  const planStatus = (() => {
    if (!user?.plan || user.plan === 'free') return 'free'
    if (user.role === 'admin' || user.plan === 'unlimited') return 'unlimited'
    const exp = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : null
    if (user.plan === 'premium' && exp && exp < Date.now()) return 'expired'
    return 'active'
  })()

  const lendingEnabled = hasLending(user)
  const gamesEnabled = !!user.features?.games
  const isFree = (plan === 'free' || planStatus === 'expired') && !isDemo

  if (!catalog) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Halcova</h1>
          <p className="auth-copy">
            {t('auth.noCollections', { name: user.name })}
          </p>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>{t('common.signOut')}</button>
        </div>
      </div>
    )
  }

  function openPaywall(p) {
    if (isDemo) return
    setPaywall({
      reason: p?.reason || 'upgrade',
      kind: p?.kind || activeCollectionTab,
      feature: p?.feature,
    })
  }

  // Handle bottom nav tab changes
  function handleNavChange(tab) {
    if (tab === 'scan') {
      // Scan is the dominant CTA — trigger scan modal immediately
      // by navigating to browse with scan open
      setNavTab('browse')
      // The scan flow starter will be handled by the browse view
      return
    }
    setNavTab(tab)
  }

  return (
    <>
      <Header
        tabs={navTab === 'browse' ? available.map((kind) => ({ id: kind, label: t(`kind.${kind}`) })) : undefined}
        activeTab={navTab === 'browse' ? activeCollectionTab : undefined}
        onTabChange={navTab === 'browse' ? setCollectionTab : undefined}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
        onOpenCredits={() => setCreditOpen(true)}
        showAdmin={user.role === 'admin'}
        user={user}
        pendingCount={pendingCount}
        onLogout={logout}
        showBack={navTab !== 'home'}
        onBack={() => setNavTab('home')}
      />

      <OnlineIndicator />

      {isDemo && <DemoBanner onLeave={logout} />}

      {confirmingPayment && (
        <div className="paywall-notice" role="status" aria-live="polite">
          <span>{t('paywall.stillPending')}</span>
          <button type="button" className="paywall-notice-close" onClick={() => setConfirmingPayment(false)} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      {/* Main content area — switches between Home and Browse views */}
      <div className="app-content">
        {navTab === 'home' && (
          <HomeScreen
            catalog={catalog}
            status="ready"
            isDemo={isDemo}
            isFree={isFree}
            lendingEnabled={lendingEnabled}
            onScan={() => { setNavTab('browse'); /* scan triggered from browse */ }}
            onScanCover={() => { setNavTab('browse'); /* cover scan triggered from browse */ }}
            onManualAdd={() => { setNavTab('browse'); /* manual add triggered from browse */ }}
            onOpenCollection={() => setNavTab('browse')}
            onOpenWishlist={() => { setNavTab('browse'); /* wishlist handled in browse view */ }}
            onOpenConflicts={() => setNavTab('browse')}
          />
        )}

        {navTab === 'browse' && (
          <ThemeProvider theme={catalog?.theme}>
            <ErrorBoundary
              key={`boundary-${catalog.kind}`}
              onReport={() => setFeedbackOpen({ initialType: 'bug' })}
            >
              <CollectionView
                key={catalog.kind}
                catalog={catalog}
                onRequestSettings={() => setSettingsOpen(true)}
                lendingEnabled={lendingEnabled}
                overdueCount={overdueCount}
                onOpenLoans={() => setLoansOpen(true)}
                onOpenPaywall={openPaywall}
                refreshTick={refreshTick}
                loansButtonRef={loansButtonRef}
                plan={plan}
                planStatus={planStatus}
                isFree={isFree}
                isDemo={isDemo}
                user={user}
                gamificationEnabled={gamesEnabled}
              />
            </ErrorBoundary>
          </ThemeProvider>
        )}

        {navTab === 'more' && (
          <div className="more-screen">
            <div className="more-screen-content">
              <p className="more-screen-placeholder">{t('home.title')} &amp; {t('common.settings')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom navigation — always visible when signed in */}
      <BottomNav
        activeTab={navTab}
        onTabChange={handleNavChange}
        conflictCount={0}
        wishlistCount={0}
      />

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onOpenFeedback={() => {
            setSettingsOpen(false)
            setFeedbackOpen({ initialType: 'suggestion' })
          }}
          userId={user?.id}
        />
      )}
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      {creditOpen && <CreditModal onClose={() => setCreditOpen(false)} />}
      {feedbackOpen && (
        <FeedbackModal
          initialType={feedbackOpen.initialType}
          onClose={() => setFeedbackOpen(null)}
        />
      )}
      {lendingEnabled && loansOpen && (
        <LoansDashboard
          open={loansOpen}
          onClose={() => setLoansOpen(false)}
          onLoanReturned={() => setRefreshTick((n) => n + 1)}
          onOverdueCount={setOverdueCount}
          returnFocusRef={loansButtonRef}
        />
      )}

      {paywall && (
        <PaywallModal
          kind={paywall.kind}
          reason={paywall.reason}
          feature={paywall.feature}
          onClose={() => setPaywall(null)}
        />
      )}

      {appToast && (
        <div className={`toast toast-${appToast.kind}`} role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden="true">{appToast.kind === 'error' ? '✕' : '✓'}</span>
          {appToast.msg}
        </div>
      )}
    </>
  )
}