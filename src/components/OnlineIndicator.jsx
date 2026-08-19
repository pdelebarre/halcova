import { useEffect, useState } from 'react'
import { t } from '../i18n'
import './OnlineIndicator.css'

// ---------------------------------------------------------------------------
// Online / offline status indicator (M1 shell, #157).
//
// The ADR-0015 Dec 4 principle requires the shell to fail gracefully across
// network transitions — never a dark screen. The shell is fully precached, so
// when the network drops the UI keeps rendering; this small pill surfaces the
// network state so the user understands why live data (lookups, sync) is
// paused and that the app is still usable offline.
//
// Design notes:
//   - Rendered ONLY when offline (avoids an always-on header bar competing
//     with the nav). `role="status"` (implicit on <output>) makes each
//     offline/online transition a polite live-region announcement — no
//     intrusive focus steal, screen-reader friendly.
//   - Reads `navigator.onLine` once and subscribes to the `online`/`offline`
//     window events so the pill appears/disappears without a poll.
//   - First paint: if we're already offline at mount (e.g. the app was opened
//     with the device in airplane mode), we show it immediately.
//   - No server/tracked data touched — this is purely local UI state.
// ---------------------------------------------------------------------------
export default function OnlineIndicator() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    // `online`/`offline` are window events. Listen on both so the pill tracks
    // real connectivity changes, not just the initial value.
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (online) return null

  return (
    // `<output>` carries an implicit `role="status"` live region (the repo's
    // a11y rule — same pattern as UpdateNotice.jsx). Do NOT set role explicit.
    <output className="online-indicator">
      <svg className="online-indicator-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 1l22 22" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      <span className="online-indicator-text">{t('offline.status')}</span>
    </output>
  )
}
