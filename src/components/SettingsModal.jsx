import { useEffect, useRef, useState } from 'react'
import { t, LOCALES, SUPPORTED_LOCALES, useLocale } from '../i18n'
import { clearMirrorForUser } from '../utils/offlineMirror'
import { clearOutboxForUser } from '../utils/outbox'
import { clearLocalDataForUser, exportLocalData } from '../repositories/localDatabase'
import './SettingsModal.css'

export default function SettingsModal({ onClose, onOpenFeedback, userId }) {
  const { locale, setLocale } = useLocale()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearDone, setClearDone] = useState(false)
  const [clearFailed, setClearFailed] = useState(false)
  // M2 #158: export state
  const [exportDone, setExportDone] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  // Ergonomics (#159): manage focus so the keyboard/talkback user always knows
  // where the destructive-clear flow moved.
  const confirmButtonRef = useRef(null)
  const doneLineRef = useRef(null)
  const clearErrorRef = useRef(null)
  // Ergonomics (#159): the trigger that opened the clear-confirmation, so a
  // Cancel restores focus to it rather than dropping to <body>.
  const clearTriggerRef = useRef(null)
  // Track the confirming transition so we can restore focus to the trigger on
  // CANCEL (true→false with no clear done) — the ref is only populated after
  // the trigger re-renders, so a synchronous focus in the onClick is too early.
  const wasConfirming = useRef(false)
  useEffect(() => {
    if (wasConfirming.current && !confirmingClear && !clearDone && !clearFailed) {
      clearTriggerRef.current?.focus()
    }
    wasConfirming.current = confirmingClear
  }, [confirmingClear, clearDone, clearFailed])

  // On showing the confirmation, move focus to the confirm (destructive) button.
  useEffect(() => {
    if (confirmingClear) confirmButtonRef.current?.focus()
  }, [confirmingClear])

  // On completion, move focus to the `role="status"` done line.
  useEffect(() => {
    if (clearDone) doneLineRef.current?.focus()
  }, [clearDone])

  // On a failed clear, move focus to the safe `role="alert"` error line.
  useEffect(() => {
    if (clearFailed) clearErrorRef.current?.focus()
  }, [clearFailed])

  async function handleClearOfflineData() {
    if (!userId) return
    // Per ADR-0019 Dec 5 / security policy: clearing local data removes only the
    // signed-in user's offline records (never another user's, never the server
    // copy). This clears BOTH the offline mirror AND the durable #292 outbox so
    // no queued raw offline mutation (pendingItem/barcode/ocrText) auto-flushes
    // to the server on reconnect — a complete privacy reset (ADR-0019 Dec 12).
    // Each clear is user-scoped (mirrorScope(userId)), so another account's
    // mirror/outbox is never touched. The offline trust record is left intact
    // by design here — clearing the offline copy is a privacy management action,
    // not a sign-out.
    //
    // FAIL-CLOSED (Security): all clears are atomic for the reset outcome. If
    // ANY fails (delete/abort/quota/cursor error — the outbox, mirror, or local
    // store could still be readable while a raw queued op survives to auto-flush
    // on reconnect), we must NOT report "cleared". Surface a safe, generic error
    // (ADR-0019 Dec 12: no secrets/raw content) and keep the clear trigger
    // available for a retry.
    const [mirrorOk, outboxOk, localOk] = await Promise.all([
      clearMirrorForUser(userId),
      clearOutboxForUser(userId),
      clearLocalDataForUser(userId),
    ])
    setConfirmingClear(false)
    setClearDone(mirrorOk && outboxOk && localOk)
    setClearFailed(!(mirrorOk && outboxOk && localOk))
  }

  // M2 #158: export local data as a downloadable JSON file.
  async function handleExportData() {
    if (!userId) return
    setExporting(true)
    setExportDone(false)
    setExportFailed(false)
    try {
      const data = await exportLocalData(userId)
      if (!data) {
        setExportFailed(true)
        return
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `halcova-offline-data-${userId}-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportDone(true)
    } catch {
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('common.settings')}>
      <div className="sheet">
        <div className="sheet-header">
          <h2>{t('common.settings')}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="settings-form">
          <p className="settings-section-label">{t('settings.language')}</p>
          <div className="settings-card settings-help-books">
            <label className="settings-language-row">
              <span>{t('settings.languageHint')}</span>
              <select
                className="settings-language-select"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                {SUPPORTED_LOCALES.map((code) => (
                  <option key={code} value={code}>{LOCALES[code]}</option>
                ))}
              </select>
            </label>
          </div>

          <p className="settings-section-label">{t('kind.records')}</p>
          <div className="settings-card settings-help-books">
            {t('settings.recordsHelp')}
          </div>

          <p className="settings-section-label">{t('kind.books')}</p>
          <div className="settings-card settings-help-books">
            {t('settings.booksHelp')}
          </div>

          {/* M2 #159: local-data management / reset per approved security policy
              (ADR-0019 Dec 5). Shown for a signed-in user only; clears the
              offline copy for THIS user. */}
          {userId && (
            <>
              <p className="settings-section-label">{t('offline.localDataTitle')}</p>
              <div className="settings-card settings-help-books">
                <p className="settings-offline-data-hint">{t('offline.localDataHint')}</p>
                {clearFailed ? (
                  <>
                    <p
                      className="settings-offline-data-done"
                      role="alert"
                      ref={clearErrorRef}
                      tabIndex={-1}
                    >
                      {t('offline.clearOfflineDataFailed')}
                    </p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      ref={clearTriggerRef}
                      onClick={() => {
                        setClearFailed(false)
                        setConfirmingClear(true)
                      }}
                    >
                      {t('offline.clearOfflineData')}
                    </button>
                  </>
                ) : clearDone ? (
                  <p
                    className="settings-offline-data-done"
                    role="status"
                    ref={doneLineRef}
                    tabIndex={-1}
                  >
                    {t('offline.clearOfflineDataDone')}
                  </p>
                ) : confirmingClear ? (
                  <div className="settings-offline-data-confirm">
                    <p>{t('offline.clearOfflineDataConfirm')}</p>
                    <div className="settings-offline-data-actions">
                      <button
                        type="button"
                        className="btn btn-danger"
                        ref={confirmButtonRef}
                        onClick={handleClearOfflineData}
                      >
                        {t('offline.clearOfflineData')}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirmingClear(false)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost" ref={clearTriggerRef} onClick={() => setConfirmingClear(true)}>
                    {t('offline.clearOfflineData')}
                  </button>
                )}
              </div>
            </>
          )}

          {/* M2 #158: local-data export. Shown for a signed-in user only;
              downloads a JSON file of the local item store for backup or
              debugging. The export includes sync metadata but never the
              session token or access code (ADR-0019 Dec 4). */}
          {userId && (
            <div className="settings-card settings-help-books">
              <p className="settings-offline-data-hint">{t('offline.exportDataHint')}</p>
              {exportDone ? (
                <p className="settings-offline-data-done" role="status" tabIndex={-1}>
                  {t('offline.exportDataDone')}
                </p>
              ) : exportFailed ? (
                <>
                  <p className="settings-offline-data-done" role="alert" tabIndex={-1}>
                    {t('offline.exportDataFailed')}
                  </p>
                  <button type="button" className="btn btn-ghost" onClick={handleExportData}>
                    {t('offline.exportData')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleExportData}
                  disabled={exporting}
                >
                  {exporting ? t('common.loading') : t('offline.exportData')}
                </button>
              )}
            </div>
          )}

          {/* Feedback entry (feat/feedback #82): a tappable card that opens the
              FeedbackModal. App wires onOpenFeedback; the optional-chaining
              keeps the sheet usable if it isn't passed (standalone tests). */}
          <button
            type="button"
            className="settings-card settings-feedback-card"
            onClick={() => onOpenFeedback?.()}
          >
            <span className="settings-feedback-row">
              <span className="settings-feedback-title">{t('feedback.title')}</span>
              <span className="settings-feedback-arrow" aria-hidden="true">→</span>
            </span>
            <span className="settings-feedback-subtitle">{t('feedback.subtitle')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
