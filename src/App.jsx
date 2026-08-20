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
  const [tab, setTab] = useState('records')
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
  // the badge matches what the user just saw. Errors/offline → 0 (never throw).
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
  // fetch. Reads counts.pendingRequests from GET /admin?counts=1 — the cheap,
  // requireAdmin-gated COUNTS-ONLY call (CWE-200): it returns only `{ counts }`
  // and never the requests/users lists, so the 60s poll ships no PII (unlike
  // ?dashboard=1 / adminList). Refreshed on app foreground + a modest 60s
  // interval. Failures/offline degrade to 0 (never throw), and non-admins
  // never fetch.
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

  // Refresh the badge the moment the admin panel closes — an approve/reject
  // inside the panel should decrement the avatar badge immediately, not on the
  // next 60s poll. A ref tracks whether it was previously open so the mount
  // (panel already closed) doesn't double-fetch alongside the effect above.
  const adminWasOpen = useRef(adminOpen)
  useEffect(() => {
    const wasOpen = adminWasOpen.current
    adminWasOpen.current = adminOpen
    if (wasOpen && !adminOpen && isAdmin) refreshPending()
  }, [adminOpen, isAdmin, refreshPending])

  // Stable App toast: auto-dismissing feedback used by the magic-link and
  // checkout-return flows above the collection shell.
  const showAppToast = useCallback((msg, kind = 'add') => {
    if (appToastTimer.current) clearTimeout(appToastTimer.current)
    setAppToast({ msg, kind })
    appToastTimer.current = setTimeout(() => setAppToast(null), 3200)
  }, [])

  // Reset to the first collection when a different user signs in. C2.1
  // (issue #86): route first-run to the token-free path — a brand-new member
  // lands on Books (no Discogs token needed, so their first scan works
  // immediately) when Books is granted and its collection is still empty;
  // established members and records-only accounts keep Records. On a lookup
  // failure we fall back to Records, the safe default.
  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return undefined
    // Read the current session via the ref (kept in sync above) so this effect
    // can stay keyed only on user.id — a plan refresh (new session object,
    // same user) must never reset the member's manually-chosen tab.
    const user = sessionRef.current?.user
    const collections = user?.collections || {}
    if (!collections.books) {
      setTab('records')
      return undefined
    }
    let cancelled = false
    // Promise.resolve() wraps the call so a mocked/non-promise return (or a
    // synchronous throw) can never crash the effect — dark-screen safety.
    Promise.resolve()
      .then(() => collectionApi.listItems('books'))
      .then((items) => {
        if (cancelled) return
        setTab(Array.isArray(items) && items.length === 0 ? 'books' : 'records')
      })
      .catch(() => {
        if (!cancelled) setTab('records')
      })
    return () => { cancelled = true }
  }, [session?.user?.id])

  // S1 self-serve signup (ADR-0003 §3): arriving via ?magic-link=<token> (the
  // emailed one-time link) exchanges the token for a session — no password, no
  // admin approval. verifyMagicLink() already persists the session to
  // localStorage; we then sync React state so the shell mounts (equivalent to
  // login() without a redundant server round-trip). The token is stripped from
  // the URL so a reload doesn't re-verify.
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

  // S6 checkout return: Stripe's success URL lands as
  // `?checkout=success&session_id=...` (the ?upgrade=success alias is also
  // tolerated). Strip the params, then poll the S3 status endpoint (the
  // self-healing path for webhook lag) — or me() when no session id is present
  // — until the plan is paid, then success toast + refresh. Offline keeps the
  // cached session (S5): the poll never signs the user out.
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
    const MAX_ATTEMPTS = 15 // ~30s of 2s polls
    const DELAY_MS = 2000
    setConfirmingPayment(true)

    const step = async () => {
      attempts += 1
      let paid = false
      try {
        if (sessionId) {
          // S3 self-healing path: the status poll persists the session for a
          // brand-new prospect and confirms an existing member's upgrade.
          const data = await paymentApi.getCheckoutStatus(sessionId)
          if (data?.status === 'complete') {
            const nextUser = data.user || sessionRef.current?.user
            if (nextUser) setSession({ user: nextUser, session: getSessionToken() })
            await refresh()
            paid = true
          }
        } else {
          // No session id (?upgrade=success alone): poll me() until the plan
          // flips to paid.
          await refresh()
          paid = isPaidPlan(sessionRef.current?.user)
        }
      } catch {
        // Offline / transient — keep the cached session (S5) and keep polling.
      }
      if (cancelled) return
      if (paid) {
        setConfirmingPayment(false)
        showAppToast(t('paywall.successToast'), 'add')
        return
      }
      if (attempts >= MAX_ATTEMPTS) return // banner stays: "still confirming"
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
    // While a magic link is being verified, show a loading line instead of a
    // flash of the auth screen. A prospect returning from a successful
    // checkout sees the "still confirming" notice while the poll runs.
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
  const activeTab = available.includes(tab) ? tab : (available[0] || '')

  const catalog = CATALOGS[activeTab]

  // Free tier & demo (ADR-0001). The owner/admin is implicitly unlimited; demo
  // visitors are read-only (no plan, no adds), so `isFree` is forced off for
  // them and only the demo banner/read-only UI applies.
  const isDemo = user.role === 'demo'
  const plan = user.role === 'admin' ? 'unlimited' : (user.plan || 'free')

  // S6 plan state. `planStatus` is derived client-side (the backend doesn't
  // emit it): 'free' | 'active' | 'expired' | 'unlimited'. An expired premium
  // counts as free so the cap gate still protects the server's limit, and the
  // soft upgrade entry reads "renew". Every field is read defensively.
  const planStatus = (() => {
    if (!user?.plan || user.plan === 'free') return 'free'
    if (user.role === 'admin' || user.plan === 'unlimited') return 'unlimited'
    const exp = user.planExpiresAt ? new Date(user.planExpiresAt).getTime() : null
    if (user.plan === 'premium' && exp && exp < Date.now()) return 'expired'
    return 'active'
  })()

  // Per-account capability flags (§ W6 / Phase 1 § Play): lending is DERIVED
  // from the plan (mirror of the server's effectiveFeatures) — any paid plan
  // includes it, the admin always has it, and the admin's manual per-member
  // `features.lending` override still works. Games stays an admin-granted
  // per-account flag (unchanged).
  const lendingEnabled = hasLending(user)
  const gamesEnabled = !!user.features?.games
  const isFree = (plan === 'free' || planStatus === 'expired') && !isDemo

  if (!catalog) {
    // Signed in but no collections granted — shouldn't normally happen, but
    // be defensive rather than mounting a broken collection view.
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

  // S6: open the paywall for the active collection. CollectionView reports the
  // reason it's blocked; App owns the modal. The demo space (DEMO_READONLY)
  // never upgrades, so the paywall is never reachable from the demo.
  function openPaywall(p) {
    if (isDemo) return
    setPaywall({
      reason: p?.reason || 'upgrade',
      kind: p?.kind || activeTab,
      feature: p?.feature,
    })
  }

  return (
    <>
      <Header
        tabs={available.map((kind) => ({ id: kind, label: t(`kind.${kind}`) }))}
        activeTab={activeTab}
        onTabChange={setTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
        onOpenCredits={() => setCreditOpen(true)}
        showAdmin={user.role === 'admin'}
        user={user}
        pendingCount={pendingCount}
        onLogout={logout}
      />

      {/* M1 offline shell (#157): a small, accessible offline-status pill that
          appears only when the network drops, so the user understands why live
          data (lookups/sync) is paused while the precached shell keeps
          rendering. Rendered globally — even on the auth screen — so it never
          surprises anyone mid-session. */}
      <OnlineIndicator />

      {/* Read-only demo notice (ADR-0001): demo visitors browse but can't add
          or edit. Leaving the demo signs out back to the auth screen. */}
      {isDemo && <DemoBanner onLeave={logout} />}

      {/* S6 post-checkout notice: "still confirming" while the payment poll
          runs — and it stays up on timeout so a slow webhook never looks lost. */}
      {confirmingPayment && (
        <div className="paywall-notice" role="status" aria-live="polite">
          <span>{t('paywall.stillPending')}</span>
          <button type="button" className="paywall-notice-close" onClick={() => setConfirmingPayment(false)} aria-label={t('common.close')}>✕</button>
        </div>
      )}

      {/* keyed by kind so each collection remounts fresh when you switch tabs.
          The boundary shares the key so switching tabs also clears an error
          state — a failure in one collection never blanks the header/nav or
          poisons the other tab. */}
      {/* T2 (issue #110): ThemeProvider feeds the active catalog's room theme
          (records = gold, books = neutral placeholder until T3 #104) to the
          collection below; CollectionView applies it as CSS variables on its
          own container. `catalog?.theme` is optional-chained — a missing theme
          can never throw. The provider is keyed implicitly by catalog.kind via
          the boundary/CollectionView keys, so each tab swap gets a fresh
          accent scope. */}
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

      {/* S6 paywall: CollectionView reported why it's blocked — App renders the
          bottom sheet with that reason + kind. */}
      {paywall && (
        <PaywallModal
          kind={paywall.kind}
          reason={paywall.reason}
          feature={paywall.feature}
          onClose={() => setPaywall(null)}
        />
      )}

      {/* App-level toast for the magic-link / checkout-return flows. */}
      {appToast && (
        <div className={`toast toast-${appToast.kind}`} role="status" aria-live="polite">
          <span className="toast-icon" aria-hidden="true">{appToast.kind === 'error' ? '✕' : '✓'}</span>
          {appToast.msg}
        </div>
      )}
    </>
  )
}
