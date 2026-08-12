import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { t } from '../i18n'
import './UpdateNotice.css'

// ---------------------------------------------------------------------------
// Visible PWA update prompt — the "silent stale service worker" fix.
//
// vite.config.js runs VitePWA with `registerType: 'prompt'` and
// `injectRegister: false`, so the plugin neither injects its own
// `<script src="/registerSW.js">` nor silently auto-reloads. We register the
// service worker from code here and, when a freshly deployed build has been
// installed and is waiting to activate (`onNeedRefresh`), show a small
// "New version available" banner with a Reload button.
//
// Contract:
//   registerSW({ immediate: true, onNeedRefresh, onOfflineReady }) → updateSW
//     - immediate: register right away (don't wait for the load event).
//     - onNeedRefresh: fired when a new SW is installed and waiting to skip.
//     - onOfflineReady: fired once the app is cached for offline use (unused
//       for now — the app was already offline-capable).
//     - updateSW(true): calls skipWaiting on the waiting SW, which the plugin
//       wires to automatically reload the page with the new version.
// ---------------------------------------------------------------------------
export default function UpdateNotice() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateSW, setUpdateSW] = useState(() => null)

  useEffect(() => {
    const onNeedRefresh = () => setUpdateAvailable(true)
    const onOfflineReady = () => {}
    const sw = registerSW({ immediate: true, onNeedRefresh, onOfflineReady })
    if (typeof sw === 'function') setUpdateSW(() => sw)
  }, [])

  if (!updateAvailable) return null

  return (
    // `<output>` carries an implicit `role="status"` (live region) — the
    // repo's a11y rules require it over a plain div with role="status".
    <output className="update-notice">
      <span className="update-notice-text">{t('update.newVersion')}</span>
      <button
        type="button"
        className="update-notice-btn"
        onClick={() => updateSW?.(true)}
      >
        {t('update.reload')}
      </button>
    </output>
  )
}
