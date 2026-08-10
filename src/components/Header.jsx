import './Header.css'

const DEFAULT_TABS = [
  { id: 'records', label: 'Records' },
  { id: 'books', label: 'Books' },
]

export default function Header({
  tabs = DEFAULT_TABS,
  activeTab,
  onTabChange,
  onOpenSettings,
  onOpenAdmin,
  showAdmin = false,
  user,
  onLogout,
}) {
  return (
    <header className="app-header">
      <div className="app-header-title">
        <span className="wordmark">Runout</span>
        <span className="tagline">
          {activeTab === 'books' ? 'your shelf, cataloged' : 'your crate, cataloged'}
        </span>
      </div>
      <div className="header-right">
        <nav className="tab-bar" aria-label="Collection type">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
              aria-pressed={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {showAdmin && (
          <button className="icon-btn" onClick={onOpenAdmin} aria-label="Admin panel">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </button>
        )}
        <button className="icon-btn" onClick={onOpenSettings} aria-label="Settings">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {user && (
          <button
            className="icon-btn user-chip"
            onClick={onLogout}
            aria-label={`Sign out ${user.name}`}
            title={`Signed in as ${user.name} — tap to sign out`}
          >
            <span className="user-chip-initial">{String(user.name || '?').charAt(0).toUpperCase()}</span>
          </button>
        )}
      </div>
    </header>
  )
}
