import { t, LOCALES, SUPPORTED_LOCALES, useLocale } from '../i18n'
import './SettingsModal.css'

export default function SettingsModal({ onClose, onOpenFeedback }) {
  const { locale, setLocale } = useLocale()

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
