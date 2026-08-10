import './EmptyState.css'

export default function EmptyState({ kind = 'empty', copy = {}, onScan }) {
  const iconClass = copy.emptyIcon || 'empty-disc'

  if (kind === 'no-results') {
    return (
      <div className="empty-state">
        <div className={iconClass} aria-hidden="true" />
        <p className="empty-title">Nothing matches</p>
        <p className="empty-sub">Try a different search or clear the filters.</p>
      </div>
    )
  }

  return (
    <div className="empty-state">
      <div className={iconClass} aria-hidden="true" />
      <p className="empty-title">{copy.emptyTitle || 'Your collection is empty'}</p>
      <p className="empty-sub">{copy.emptySub || 'Scan a barcode to catalog your first item.'}</p>
      {onScan && <button className="btn btn-primary" onClick={onScan}>{copy.emptyBtn || 'Scan an item'}</button>}
    </div>
  )
}
