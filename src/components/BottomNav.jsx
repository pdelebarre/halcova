import { useMemo } from 'react'
import { t } from '../i18n'
import './BottomNav.css'

/**
 * Bottom navigation bar — M2 collector home redesign (#320).
 *
 * Thumb-friendly, ≤5 destinations with clear active state.
 * - Home: collection overview (stats, recent additions, next actions)
 * - Browse: Records/Books collection grid
 * - Scan: dominant Add action (center, prominent)
 * - More: wishlist, settings, profile access
 *
 * DESIGN RULES:
 * - 44px minimum touch targets (WCAG 2.5.8 / 2.5.5)
 * - Safe-area-aware (--safe-bottom)
 * - Active state uses --runout-gold accent
 * - Never renders credentials in the UI (static labels only)
 * - Mobile-first: collapses gracefully on desktop
 */
export default function BottomNav({ activeTab, onTabChange, conflictCount = 0, wishlistCount = 0 }) {
  // SECURITY: all labels are static localized strings — never user-provided
  // content, never credentials, never raw metadata.
  const items = useMemo(() => [
    {
      id: 'home',
      label: t('home.title'),
      icon: HomeIcon,
    },
    {
      id: 'browse',
      label: t('home.browse'),
      icon: BrowseIcon,
    },
    {
      id: 'scan',
      label: t('home.scan'),
      icon: ScanIcon,
      // The scan button is the dominant CTA — center position, visually
      // distinct (larger, accent-colored circle). It always opens the
      // scan flow regardless of active tab.
      dominant: true,
    },
    {
      id: 'more',
      label: t('home.more'),
      icon: MoreIcon,
      badge: conflictCount > 0 ? conflictCount : (wishlistCount > 0 ? wishlistCount : null),
    },
  ], [conflictCount, wishlistCount])

  function handleClick(id) {
    onTabChange(id)
  }

  return (
    <nav className="bottom-nav" aria-label={t('home.title')} role="tablist">
      {items.map((item) => {
        const isActive = activeTab === item.id
        return (
          <button
            key={item.id}
            type="button"
            className={`bottom-nav-item${isActive ? ' active' : ''}${item.dominant ? ' dominant' : ''}`}
            onClick={() => handleClick(item.id)}
            role="tab"
            aria-selected={isActive}
            aria-label={item.dominant ? t('common.scan') : item.label}
          >
            <span className="bottom-nav-icon-wrap">
              {item.badge != null && (
                <span className="bottom-nav-badge" aria-label={`${item.badge} notifications`}>
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
              <item.icon active={isActive} />
            </span>
            {!item.dominant && <span className="bottom-nav-label">{item.label}</span>}
          </button>
        )
      })}
    </nav>
  )
}

// --- Inline SVG icons ---

function HomeIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true">
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function BrowseIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function ScanIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7V4a1 1 0 011-1h3M17 3h3a1 1 0 011 1v3M21 17v3a1 1 0 01-1 1h-3M7 21H4a1 1 0 01-1-1v-3" />
      <path d="M7 12h10" />
    </svg>
  )
}

function MoreIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true">
      <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}