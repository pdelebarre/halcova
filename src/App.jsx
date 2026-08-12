import { useEffect, useState } from 'react'
import Header from './components/Header'
import SettingsModal from './components/SettingsModal'
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
