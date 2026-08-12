import { t } from '../i18n'
import './EmptyState.css'

export default function EmptyState({ kind = 'empty', copy = {}, onScan, onManualAdd, onClear }) {
  const iconClass = copy.emptyIcon || 'empty-disc'

  if (kind === 'no-results') {
    return (
      <div className="empty-state">
        <div className={iconClass} aria-hidden="true" />
        <p className="empty-title">{t('list.nothingMatches')}</p>
        <p className="empty-sub">{t('list.tryDifferentSearch')}</p>
        {onClear && (
          <button type="button" className="btn btn-ghost" onClick={onClear} style={{ marginTop: 8 }}>
            {copy.clearFilters || t('catalog.clearFilters')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="empty-state">
      <div className={iconClass} aria-hidden="true" />
      <p className="empty-title">{copy.emptyTitle || t('catalog.emptyTitle')}</p>
      <p className="empty-sub">{copy.emptySub || t('catalog.emptySub')}</p>
      {copy.emptyTagline && <p className="empty-tagline">{copy.emptyTagline}</p>}
      {onScan && <button type="button" className="btn btn-primary" onClick={onScan}>{copy.emptyBtn || t('catalog.emptyBtn')}</button>}
      {onManualAdd && (
        <button type="button" className="btn btn-ghost" onClick={onManualAdd} style={{ marginTop: 8 }}>
          {copy.emptyManualBtn || t('catalog.emptyManualBtn')}
        </button>
      )}
    </div>
  )
}
