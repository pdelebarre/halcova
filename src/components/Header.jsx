import { useEffect, useRef, useState } from 'react'
import { useScrolled } from '../hooks/useScrolled'
import { t } from '../i18n'
import './Header.css'

export default function Header({
  tabs,
  activeTab,
  onTabChange,
  onOpenSettings,
  onOpenAdmin,
  onOpenCredits,
  showAdmin = false,
  user,
  pendingCount = 0,
  onLogout,
  showBack = false,
  onBack,
  backLabel,
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
        {showBack && (
          <button
            type="button"
            className="icon-btn header-back-btn"
            onClick={onBack}
            aria-label={backLabel || t('common.back')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <span className="wordmark">Halcova</span>
      </div>
      <div className="header-right">
        {tabs && tabs.length > 0 && (
          <nav className="tab-bar" aria-label={t('header.collectionType')}>
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
        )}
        {user && (
          <div className="avatar-wrap">
            {menuOpen && <div className="avatar-overlay" onClick={closeMenu} aria-hidden="true" />}
            <div
              className="avatar-menu"
              role="menu"
              aria-label={t('header.account')}
              ref={menuRef}
              hidden={!menuOpen}
            >
              <button type="button" role="menuitem" onClick={() => run(onOpenSettings)}>
                {t('common.settings')}
              </button>
              {showAdmin && (
                <button type="button" role="menuitem" onClick={() => run(onOpenAdmin)}>
                  {t('common.adminPanel')}
                  {pendingCount > 0 && (
                    <span className="admin-badge menu-badge" aria-label={t('admin.dashboard.pendingBadge', { n: pendingCount })}>
                      {pendingCount}
                    </span>
                  )}
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => run(onOpenCredits)}>
                {t('common.credits')}
              </button>
              <button type="button" role="menuitem" className="avatar-signout" onClick={() => run(onLogout)}>
                {t('common.signOut')}
              </button>
            </div>
            <button
              ref={avatarRef}
              type="button"
              className="icon-btn user-chip"
              onClick={() => setMenuOpen((s) => !s)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={
                showAdmin && pendingCount > 0
                  ? `${t('header.accountLabel', { name: user.name })} — ${t('admin.dashboard.pendingBadge', { n: pendingCount })}`
                  : t('header.accountLabel', { name: user.name })
              }
            >
              <span className="user-chip-initial">{String(user.name || '?').charAt(0).toUpperCase()}</span>
              {showAdmin && pendingCount > 0 && (
                <span className="admin-badge avatar-badge" aria-label={t('admin.dashboard.pendingBadge', { n: pendingCount })}>
                  {pendingCount}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
