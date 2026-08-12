import { useEffect, useState } from 'react'
import Header from './components/Header'
import SettingsModal from './components/SettingsModal'
import CollectionView from './CollectionView'
import AuthScreen from './AuthScreen'
import AdminPanel from './AdminPanel'
import { recordsCatalog, booksCatalog } from './catalog'
import { useAuth } from './hooks/useAuth'
import './App.css'

const CATALOGS = { records: recordsCatalog, books: booksCatalog }
const KIND_LABELS = { records: 'Records', books: 'Books' }

export default function App() {
  const { session, ready, login, logout, requestAccess } = useAuth()
  const [tab, setTab] = useState('records')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)

  // Reset to the first collection when a different user signs in.
  useEffect(() => {
    setTab('records')
  }, [session?.user?.id])

  if (!ready) {
    return <div className="status-line">Loading…</div>
  }

  if (!session) {
    return <AuthScreen onLogin={login} onRequestAccess={requestAccess} />
  }

  const user = session.user
  const allowed = user.collections || {}
  const available = ['records', 'books'].filter((kind) => allowed[kind])
  const activeTab = available.includes(tab) ? tab : (available[0] || '')

  const catalog = CATALOGS[activeTab]

  if (!catalog) {
    // Signed in but no collections granted — shouldn't normally happen, but
    // be defensive rather than mounting a broken collection view.
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Alcove</h1>
          <p className="auth-copy">
            Hi {user.name} — your account doesn't include any collections yet.
            Ask the admin to grant you Records and/or Books.
          </p>
          <button type="button" className="btn btn-ghost btn-block" onClick={logout}>Sign out</button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Header
        tabs={available.map((kind) => ({ id: kind, label: KIND_LABELS[kind] }))}
        activeTab={activeTab}
        onTabChange={setTab}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAdmin={() => setAdminOpen(true)}
        showAdmin={user.role === 'admin'}
        user={user}
        onLogout={logout}
      />

      {/* keyed by kind so each collection remounts fresh when you switch tabs */}
      <CollectionView key={catalog.kind} catalog={catalog} onRequestSettings={() => setSettingsOpen(true)} />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {adminOpen && <AdminPanel onClose={() => setAdminOpen(false)} />}
    </>
  )
}
