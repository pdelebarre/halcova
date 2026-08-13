import { useEffect, useRef, useState } from 'react'
import Header from './components/Header'
import SettingsModal from './components/SettingsModal'
import CreditModal from './components/CreditModal'
import LoansDashboard from './components/LoansDashboard'
import DemoBanner from './components/DemoBanner'
import CollectionView from './CollectionView'
import AuthScreen from './AuthScreen'
import AdminPanel from './AdminPanel'
import { recordsCatalog, booksCatalog } from './catalog'
import { useAuth } from './hooks/useAuth'
import { t } from './i18n'
import './App.css'

const CATALOGS = { records: recordsCatalog, books: booksCatalog }

export default function App() {
  const { session, ready, login, logout, requestAccess } = useAuth()
  const [tab, setTab] = useState('records')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  // W7: loans dashboard — owns whether the global overlay is open and a
  // counter that bumps whenever a loan is returned so the visible collection
  // re-fetches and stays in sync.
  const [loansOpen, setLoansOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const loansButtonRef = useRef(null)

  // Reset to the first collection when a different user signs in.
  useEffect(() => {
    setTab('records')
  }, [session?.user?.id])

  if (!ready) {
    return <div className="status-line">{t('common.loading')}</div>
  }

  if (!session) {
    return <AuthScreen onLogin={login} onRequestAccess={requestAccess} />
  }

  const user = session.user
  const allowed = user.collections || {}
  const available = ['records', 'books'].filter((kind) => allowed[kind])
  const activeTab = available.includes(tab) ? tab : (available[0] || '')

  const catalog = CATALOGS[activeTab]

  // Feature flag for the lending MVP (§ W6): the admin grants it per member
  // (user.features.lending). Gate for the shared LendingControls in details.
  const lendingEnabled = !!user.features?.lending

  // Free tier & demo (ADR-0001). The owner/admin is implicitly unlimited; demo
  // visitors are read-only (no plan, no adds), so `isFree` is forced off for
  // them and only the demo banner/read-only UI applies.
  const isDemo = user.role === 'demo'
  const plan = user.role === 'admin' ? 'unlimited' : (user.plan || 'free')
  const isFree = plan === 'free' && !isDemo

  if (!catalog) {
    // Signed in but no collections granted — shouldn't normally happen, but
    // be defensive rather than mounting a broken collection view.
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Hokan</h1>
          <p className="auth-copy">
            {t('auth.noCollections', { name: user.name })}
          </p>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>{t('common.signOut')}</button>
        </div>
      </div>
    )
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
        onLogout={logout}
      />

      {/* Read-only demo notice (ADR-0001): demo visitors browse but can't add
          or edit. Leaving the demo signs out back to the auth screen. */}
      {isDemo && <DemoBanner onLeave={logout} />}

      {/* keyed by kind so each collection remounts fresh when you switch tabs */}
      <CollectionView
        key={catalog.kind}
        catalog={catalog}
        onRequestSettings={() => setSettingsOpen(true)}
        lendingEnabled={lendingEnabled}
        onOpenLoans={() => setLoansOpen(true)}
        refreshTick={refreshTick}
        loansButtonRef={loansButtonRef}
        plan={plan}
        isFree={isFree}
        isDemo={isDemo}
        user={user}
      />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
      {creditOpen && <CreditModal onClose={() => setCreditOpen(false)} />}
      {lendingEnabled && loansOpen && (
        <LoansDashboard
          open={loansOpen}
          onClose={() => setLoansOpen(false)}
          onLoanReturned={() => setRefreshTick((n) => n + 1)}
          returnFocusRef={loansButtonRef}
        />
      )}
    </>
  )
}
