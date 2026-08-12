import './EmptyState.css'

export default function EmptyState({ kind = 'empty', copy = {}, onScan, onManualAdd, onClear }) {
  const iconClass = copy.emptyIcon || 'empty-disc'

  if (kind === 'no-results') {
    return (
      <div className="empty-state">
        <div className={iconClass} aria-hidden="true" />
        <p className="empty-title">Nothing matches</p>
        <p className="empty-sub">Try a different search or clear the filters.</p>
        {onClear && (
          <button type="button" className="btn btn-ghost" onClick={onClear} style={{ marginTop: 8 }}>
            {copy.clearFilters || 'Clear filters'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="empty-state">
      <div className={iconClass} aria-hidden="true" />
      <p className="empty-title">{copy.emptyTitle || 'Your collection is empty'}</p>
      <p className="empty-sub">{copy.emptySub || 'Scan a barcode to catalog your first item.'}</p>
      {copy.emptyTagline && <p className="empty-tagline">{copy.emptyTagline}</p>}
      {onScan && <button type="button" className="btn btn-primary" onClick={onScan}>{copy.emptyBtn || 'Scan an item'}</button>}
      {onManualAdd && (
        <button type="button" className="btn btn-ghost" onClick={onManualAdd} style={{ marginTop: 8 }}>
          {copy.emptyManualBtn || 'Add by title'}
        </button>
      )}
    </div>
  )
}
