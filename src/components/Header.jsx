import { useEffect, useRef, useState } from 'react'
import { useScrolled } from '../hooks/useScrolled'
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
  const scrolled = useScrolled()
  const [menuOpen, setMenuOpen] = useState(false)
  const avatarRef = useRef(null)
  const menuRef = useRef(null)

  // Esc closes the avatar menu; focus returns to the avatar chip.
  useEffect(() => {
    if (!menuOpen) return undefined
    menuRef.current?.querySelector('button')?.focus()
    function onKey(e) {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        avatarRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  function closeMenu() {
    setMenuOpen(false)
    avatarRef.current?.focus()
  }

  function run(action) {
    setMenuOpen(false)
    action()
  }

  return (
    <header className={scrolled ? 'app-header scrolled' : 'app-header'}>
      <div className="app-header-title">
        <span className="wordmark">Alcove</span>
      </div>
      <div className="header-right">
        <nav className="tab-bar" aria-label="Collection type">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => onTabChange(tab.id)}
              aria-pressed={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {user && (
          <div className="avatar-wrap">
            {menuOpen && <div className="avatar-overlay" onClick={closeMenu} aria-hidden="true" />}
            <div
              className="avatar-menu"
              role="menu"
              aria-label="Account"
              ref={menuRef}
              hidden={!menuOpen}
            >
              <button type="button" role="menuitem" onClick={() => run(onOpenSettings)}>
                Settings
              </button>
              {showAdmin && (
                <button type="button" role="menuitem" onClick={() => run(onOpenAdmin)}>
                  Admin panel
                </button>
              )}
              <button type="button" role="menuitem" className="avatar-signout" onClick={() => run(onLogout)}>
                Sign out
              </button>
            </div>
            <button
              ref={avatarRef}
              type="button"
              className="icon-btn user-chip"
              onClick={() => setMenuOpen((s) => !s)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Account: ${user.name}`}
            >
              <span className="user-chip-initial">{String(user.name || '?').charAt(0).toUpperCase()}</span>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
