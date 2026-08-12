import { t, LOCALES, SUPPORTED_LOCALES, useLocale } from '../i18n'
import './SettingsModal.css'

export default function SettingsModal({ onClose }) {
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
        </div>
      </div>
    </div>
  )
}
