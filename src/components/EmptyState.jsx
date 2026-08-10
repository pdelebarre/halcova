import './EmptyState.css'

export default function EmptyState({ kind = 'empty', onScan }) {
  if (kind === 'no-results') {
    return (
      <div className="empty-state">
        <div className="empty-disc" aria-hidden="true" />
        <p className="empty-title">Nothing matches</p>
        <p className="empty-sub">Try a different search or clear the filters.</p>
      </div>
    )
  }

  return (
    <div className="empty-state">
      <div className="empty-disc" aria-hidden="true" />
      <p className="empty-title">Your crate is empty</p>
      <p className="empty-sub">Scan the barcode on a sleeve to catalog your first record.</p>
      {onScan && <button className="btn btn-primary" onClick={onScan}>Scan a record</button>}
    </div>
  )
}
