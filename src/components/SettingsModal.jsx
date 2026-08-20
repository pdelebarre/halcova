import { useState } from 'react'
import { t, LOCALES, SUPPORTED_LOCALES, useLocale } from '../i18n'
import { clearMirrorForUser } from '../utils/offlineMirror'
import './SettingsModal.css'

export default function SettingsModal({ onClose, onOpenFeedback, userId }) {
  const { locale, setLocale } = useLocale()
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearDone, setClearDone] = useState(false)

  async function handleClearOfflineData() {
    if (!userId) return
    // Per ADR-0019 Dec 5 / security policy: clearing local data removes only the
    // signed-in user's offline records (never another user's, never the server
    // copy). The offline trust record is left intact by design here — clearing
    // the offline copy is a privacy management action, not a sign-out.
    await clearMirrorForUser(userId)
    setConfirmingClear(false)
    setClearDone(true)
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
                {clearDone ? (
                  <p className="settings-offline-data-done" role="status">{t('offline.clearOfflineDataDone')}</p>
                ) : confirmingClear ? (
                  <div className="settings-offline-data-confirm">
                    <p>{t('offline.clearOfflineDataConfirm')}</p>
                    <div className="settings-offline-data-actions">
                      <button type="button" className="btn btn-danger" onClick={handleClearOfflineData}>
                        {t('offline.clearOfflineData')}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirmingClear(false)}>
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmingClear(true)}>
                    {t('offline.clearOfflineData')}
                  </button>
                )}
              </div>
            </>
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
