import { t } from '../i18n'
import TreasureNookMark from './TreasureNookMark'
import './CreditModal.css'

export default function CreditModal({ onClose }) {
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('common.credits')}>
      <div className="sheet credit-sheet">
        <div className="sheet-header">
          <h2>{t('common.credits')}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <div className="credits-body">
          <div className="credits-mark"><TreasureNookMark size={72} /></div>
          <div className="credits-wordmark">Hokan</div>

          <section className="credits-section">
            <h3 className="credits-section-heading">{t('credits.aboutName')}</h3>
            <p className="credits-section-body">{t('credits.aboutNameBody')}</p>
          </section>

          <section className="credits-section">
            <h3 className="credits-section-heading">{t('credits.builtWith')}</h3>
            <ul className="credits-tech-list">
              <li><span className="credits-tech-name">{t('credits.techReact')}</span> <span className="credits-tech-desc">{t('credits.techReactDesc')}</span></li>
              <li><span className="credits-tech-name">{t('credits.techVite')}</span> <span className="credits-tech-desc">{t('credits.techViteDesc')}</span></li>
              <li><span className="credits-tech-name">{t('credits.techZxing')}</span> <span className="credits-tech-desc">{t('credits.techZxingDesc')}</span></li>
              <li><span className="credits-tech-name">{t('credits.techDiscogs')}</span> <span className="credits-tech-desc">{t('credits.techDiscogsDesc')}</span></li>
              <li><span className="credits-tech-name">{t('credits.techGoogleBooks')}</span> <span className="credits-tech-desc">{t('credits.techGoogleBooksDesc')}</span></li>
              <li><span className="credits-tech-name">{t('credits.techNetlify')}</span> <span className="credits-tech-desc">{t('credits.techNetlifyDesc')}</span></li>
              <li><span className="credits-tech-name">{t('credits.techPwa')}</span> <span className="credits-tech-desc">{t('credits.techPwaDesc')}</span></li>
            </ul>
          </section>

          <section className="credits-section">
            <h3 className="credits-section-heading">{t('credits.fonts')}</h3>
            <p className="credits-section-body">{t('credits.fontsBody')}</p>
          </section>

          <section className="credits-section">
            <h3 className="credits-section-heading">{t('credits.creator')}</h3>
            <p className="credits-section-body">{t('credits.creatorBody')}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
