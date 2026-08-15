import { t } from '../i18n'
import './EmptyState.css'

export default function EmptyState({ kind = 'empty', copy = {}, noToken = false, onScan, onScanCover, onManualAdd, onTrySample, onClear }) {
  const iconClass = copy.emptyIcon || 'empty-disc'
  // C2 onboarding (issue #88): `emptySteps` (a 3-item array) replaces the
  // single emptySub sentence. Guarded so a malformed value can never crash —
  // there is no error boundary, and an uncaught render error blanks the app.
  const steps = Array.isArray(copy.emptySteps) ? copy.emptySteps : null

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
      {steps && steps.length > 0 ? (
        <ol className="empty-steps">
          {steps.map((step, i) => (
            <li key={i}>{typeof step === 'string' ? step : ''}</li>
          ))}
        </ol>
      ) : (
        <p className="empty-sub">{copy.emptySub || t('catalog.emptySub')}</p>
      )}
      {copy.emptyTagline && <p className="empty-tagline">{copy.emptyTagline}</p>}
      {onScan && <button type="button" className="btn btn-primary" onClick={onScan}>{copy.emptyBtn || t('catalog.emptyBtn')}</button>}
      {/* C2.4 (issue #88): persistent, non-blocking records token hint under
          the Scan button. CollectionView passes noToken only for the Records
          catalog after a SERVER_NO_TOKEN signal. */}
      {noToken && copy.noTokenHint && <p className="empty-nohint">{copy.noTokenHint}</p>}
      {onScanCover && (
        <button type="button" className="btn btn-ghost" onClick={onScanCover} style={{ marginTop: 8 }}>
          {copy.coverScan?.title || t('coverScan.title')}
        </button>
      )}
      {onManualAdd && (
        <button type="button" className="btn btn-ghost" onClick={onManualAdd} style={{ marginTop: 8 }}>
          {copy.emptyManualBtn || t('catalog.emptyManualBtn')}
        </button>
      )}
      {/* C2.3 (issue #85): "Try a sample" — a curated item is fed straight into
          the result flow (no lookup, no token, no network) so a brand-new user
          sees a full result sheet in ~10s. Read-only, so it's safe for demo
          visitors too. Only rendered when the flow wired the handler. */}
      {onTrySample && (
        <button type="button" className="btn btn-ghost" onClick={onTrySample} style={{ marginTop: 8 }}>
          {copy.trySample || t('catalog.trySample')}
        </button>
      )}
    </div>
  )
}
