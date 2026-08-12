import { t } from '../i18n'
import './MatchPicker.css'

export default function MatchPicker({
  title, matches, loading, errorMsg,
  onPick, onRetrySearch, onManual, onClose,
  loadingLabel = 'Looking it up…',
  noMatchLabel = 'No matches found.',
}) {
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sheet">
        <div className="sheet-header">
          <h2>{title}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        {loading && <p className="sheet-status">{loadingLabel}</p>}
        {errorMsg && !loading && <p className="sheet-status sheet-error">{errorMsg}</p>}

        {!loading && !errorMsg && matches?.length === 0 && (
          <div className="sheet-empty">
            <p>{noMatchLabel}</p>
          </div>
        )}

        {!loading && matches?.length > 0 && (
          <ul className="match-list">
            {matches.map((m) => (
              <li key={m.discogsId ?? m.googleBooksId ?? m.title}>
                <button className="match-row" onClick={() => onPick(m)}>
                  <span className="match-cover">
                    {m.coverImage
                      ? <img src={m.coverImage} alt="" loading="lazy" />
                      : <span className="match-cover-placeholder" aria-hidden="true" />}
                  </span>
                  <span className="match-info">
                    <span className="match-title">{m.title}</span>
                    <span className="match-meta">
                      {[m.formatType, m.year, m.label].filter(Boolean).join(' · ')}
                    </span>
                    {m.catno && <span className="match-catno">{m.catno}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="sheet-actions">
          {onRetrySearch && (
            <button className="btn btn-ghost" onClick={onRetrySearch}>{t('add.searchByTitleInstead')}</button>
          )}
          <button className="btn btn-ghost" onClick={onManual}>{t('add.addManually')}</button>
        </div>
      </div>
    </div>
  )
}
