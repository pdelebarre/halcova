import { t } from '../i18n'
import './DemoBanner.css'

// Read-only notice shown above the collection for demo visitors (ADR-0001):
// they can browse, search, filter and detail everything, but the space is
// read-only. "Leave demo" signs out so the visitor can sign in with their own
// access code (or request one).
export default function DemoBanner({ onLeave }) {
  return (
    <div className="demo-banner" role="status">
      <svg className="demo-banner-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
      <p className="demo-banner-text">
        {t('demo.banner')} {t('demo.signInPrompt')}
      </p>
      {onLeave && (
        <button type="button" className="btn btn-ghost btn-sm demo-banner-action" onClick={onLeave}>
          {t('demo.leaveDemo')}
        </button>
      )}
    </div>
  )
}
