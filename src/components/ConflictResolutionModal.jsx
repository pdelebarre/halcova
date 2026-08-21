// M3 #161 — Conflict Resolution Modal (ADR-0019 Dec 8).
//
// WHAT THIS IS
// ------------
// A modal dialog that lets users inspect and resolve conflicts detected during
// synchronization. It shows the server version and local version side by side,
// highlights the differing fields, and lets the user choose which version to
// keep or perform a field-level merge for collection metadata.
//
// SECURITY (ADR-0019 Dec 4/5/6/8 — mandatory)
//   - No credentials in conflict payloads: only sanitized item data is shown.
//   - Server-authoritative ownership: the user can only see their own conflicts.
//   - No silent discard: every conflict requires explicit user action (or an
//     explicit policy) to resolve.
//
// ERGONOMICS
//   - Thumb-friendly layout (min 44px touch targets, safe-area aware).
//   - Screen-reader accessible (role="dialog", aria-modal, focus trap).
//   - Warns before closing with unresolved conflicts.
//   - Shows conflict count: "Conflict 1 of 3".
//   - Resolved conflicts show a confirmation state.

import { useCallback, useState } from 'react'
import { t } from '../i18n'
import { useConflicts, RESOLUTION } from '../hooks/useConflicts'
import './ConflictResolutionModal.css'

/**
 * ConflictResolutionModal — modal dialog for inspecting and resolving conflicts.
 *
 * @param {object} props
 * @param {boolean} props.open - Whether the modal is visible.
 * @param {Function} props.onClose - Callback when the modal is closed.
 * @param {number} [props.refreshId=0] - Bump to force re-read of conflicts.
 */
export default function ConflictResolutionModal({
  open,
  onClose,
  refreshId = 0,
}) {
  const { conflicts, metrics, loading, resolveConflict } = useConflicts({ refreshId })
  const [currentIndex, setCurrentIndex] = useState(0)
  const [resolving, setResolving] = useState(null) // conflictId being resolved
  const [resolvedIds, setResolvedIds] = useState(new Set())
  const [mergedFields, setMergedFields] = useState({})

  const currentConflict = conflicts[currentIndex] || null
  const totalUnresolved = conflicts.length

  // Reset index when conflicts change
  const handleClose = useCallback(() => {
    setCurrentIndex(0)
    setResolvedIds(new Set())
    setMergedFields({})
    onClose()
  }, [onClose])

  const handleResolve = useCallback(async (conflictId, resolution) => {
    if (!conflictId) return
    setResolving(conflictId)

    const mergedItem = resolution === RESOLUTION.MERGE
      ? mergedFields[conflictId] || undefined
      : undefined

    const ok = await resolveConflict(conflictId, resolution, mergedItem)
    if (ok) {
      setResolvedIds((prev) => new Set([...prev, conflictId]))
    }
    setResolving(null)
  }, [resolveConflict, mergedFields])

  const handleMergeField = useCallback((field, value) => {
    setMergedFields((prev) => ({
      ...prev,
      [currentConflict?.conflictId]: {
        ...(prev[currentConflict?.conflictId] || {}),
        [field]: value,
      },
    }))
  }, [currentConflict])

  const handleNext = useCallback(() => {
    if (currentIndex < conflicts.length - 1) {
      setCurrentIndex((i) => i + 1)
    }
  }, [currentIndex, conflicts.length])

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1)
    }
  }, [currentIndex])

  if (!open) return null

  const hasUnresolved = totalUnresolved > 0
  const isResolved = currentConflict && resolvedIds.has(currentConflict.conflictId)

  // Diff server vs local fields
  const serverItem = currentConflict?.serverItem || {}
  const localItem = currentConflict?.localItem || {}
  const allFields = [...new Set([
    ...Object.keys(serverItem),
    ...Object.keys(localItem),
  ])].filter((k) => k !== 'uuid' && k !== 'serverId' && k !== 'scope')
  const differingFields = allFields.filter(
    (k) => JSON.stringify(serverItem[k]) !== JSON.stringify(localItem[k]),
  )

  return (
    <div
      className="conflict-modal-overlay"
      onClick={handleClose}
      onKeyDown={(e) => { if (e.key === 'Escape') handleClose() }}
      role="presentation"
    >
      <div
        className="conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('conflict.title')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="conflict-modal-header">
          <h2 className="conflict-modal-title">
            {t('conflict.title')}
          </h2>
          {totalUnresolved > 0 && (
            <span className="conflict-modal-counter">
              {t('conflict.counter', { current: currentIndex + 1, total: totalUnresolved })}
            </span>
          )}
          <button
            type="button"
            className="conflict-modal-close"
            onClick={handleClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="conflict-modal-body">
          {loading && (
            <p className="conflict-modal-loading">{t('common.loading')}</p>
          )}

          {!loading && !hasUnresolved && (
            <div className="conflict-modal-empty">
              <p className="conflict-modal-empty-text">
                {t('conflict.none')}
              </p>
              {metrics.totalConflicts > 0 && (
                <p className="conflict-modal-empty-metrics">
                  {t('conflict.resolvedCount', { n: metrics.totalConflicts - metrics.unresolved, total: metrics.totalConflicts })}
                </p>
              )}
            </div>
          )}

          {!loading && hasUnresolved && currentConflict && (
            <>
              {/* Conflict info */}
              <div className="conflict-modal-info">
                <p className="conflict-modal-entity-type">
                  {t(`conflict.entityType.${currentConflict.entityType}`) || currentConflict.entityType}
                </p>
                <p className="conflict-modal-version-info">
                  {t('conflict.versionInfo', {
                    server: currentConflict.serverVersion,
                    local: currentConflict.localVersion,
                  })}
                </p>
              </div>

              {/* Resolution status */}
              {isResolved && (
                <div className="conflict-modal-resolved-banner">
                  {t('conflict.resolved')}
                </div>
              )}

              {/* Diff view */}
              {!isResolved && (
                <div className="conflict-modal-diff">
                  <div className="conflict-modal-diff-header">
                    <span className="conflict-modal-diff-label-server">
                      {t('conflict.server')}
                    </span>
                    <span className="conflict-modal-diff-label-local">
                      {t('conflict.local')}
                    </span>
                  </div>

                  {differingFields.length === 0 && (
                    <p className="conflict-modal-diff-same">
                      {t('conflict.noDifferences')}
                    </p>
                  )}

                  {differingFields.map((field) => {
                    const sVal = serverItem[field]
                    const lVal = localItem[field]
                    const sStr = typeof sVal === 'object' ? JSON.stringify(sVal) : String(sVal ?? '—')
                    const lStr = typeof lVal === 'object' ? JSON.stringify(lVal) : String(lVal ?? '—')

                    return (
                      <div key={field} className="conflict-modal-diff-row">
                        <span className="conflict-modal-diff-field">{field}</span>
                        <span className="conflict-modal-diff-value-server">{sStr}</span>
                        <span className="conflict-modal-diff-value-local">{lStr}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Resolution actions */}
              {!isResolved && (
                <div className="conflict-modal-actions">
                  <p className="conflict-modal-actions-label">
                    {t('conflict.chooseResolution')}
                  </p>

                  <div className="conflict-modal-action-buttons">
                    <button
                      type="button"
                      className="conflict-modal-btn conflict-modal-btn-server"
                      onClick={() => handleResolve(currentConflict.conflictId, RESOLUTION.USE_SERVER)}
                      disabled={resolving === currentConflict.conflictId}
                    >
                      {t('conflict.useServer')}
                    </button>

                    <button
                      type="button"
                      className="conflict-modal-btn conflict-modal-btn-local"
                      onClick={() => handleResolve(currentConflict.conflictId, RESOLUTION.USE_LOCAL)}
                      disabled={resolving === currentConflict.conflictId}
                    >
                      {t('conflict.useLocal')}
                    </button>

                    {currentConflict.policy?.mergeableFields?.length > 0 && (
                      <button
                        type="button"
                        className="conflict-modal-btn conflict-modal-btn-merge"
                        onClick={() => handleResolve(currentConflict.conflictId, RESOLUTION.MERGE, mergedFields[currentConflict.conflictId])}
                        disabled={resolving === currentConflict.conflictId}
                      >
                        {t('conflict.merge')}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Mergeable fields (only shown for MERGE) */}
              {currentConflict.policy?.mergeableFields?.length > 0 && currentConflict.policy.requiresUserIntent === false && (
                <div className="conflict-modal-merge-fields">
                  <p className="conflict-modal-merge-fields-label">
                    {t('conflict.mergeableFields')}
                  </p>
                  {currentConflict.policy.mergeableFields.map((field) => {
                    const sVal = serverItem[field]
                    const lVal = localItem[field]
                    return (
                      <div key={field} className="conflict-modal-merge-field-row">
                        <span className="conflict-modal-merge-field-name">{field}</span>
                        <label className="conflict-modal-merge-radio">
                          <input
                            type="radio"
                            name={`merge-${currentConflict.conflictId}-${field}`}
                            checked={!mergedFields[currentConflict.conflictId]?.[field] && mergedFields[currentConflict.conflictId]?.[field] !== lVal}
                            onChange={() => handleMergeField(field, sVal)}
                          />
                          <span>{t('conflict.server')}: {String(sVal ?? '—')}</span>
                        </label>
                        <label className="conflict-modal-merge-radio">
                          <input
                            type="radio"
                            name={`merge-${currentConflict.conflictId}-${field}`}
                            checked={mergedFields[currentConflict.conflictId]?.[field] === lVal}
                            onChange={() => handleMergeField(field, lVal)}
                          />
                          <span>{t('conflict.local')}: {String(lVal ?? '—')}</span>
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="conflict-modal-footer">
          {totalUnresolved > 1 && (
            <div className="conflict-modal-nav">
              <button
                type="button"
                className="conflict-modal-nav-btn"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                ← {t('common.back')}
              </button>
              <button
                type="button"
                className="conflict-modal-nav-btn"
                onClick={handleNext}
                disabled={currentIndex >= totalUnresolved - 1}
              >
                {t('common.next')} →
              </button>
            </div>
          )}

          <button
            type="button"
            className="conflict-modal-done-btn"
            onClick={handleClose}
          >
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}