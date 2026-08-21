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
//   - Screen-reader accessible (role="dialog", aria-modal, aria-describedby, focus trap).
//   - Warns before closing with unresolved conflicts.
//   - Shows conflict count: "Conflict 1 of 3".
//   - Resolved conflicts show a confirmation state with resolution type.

import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { useConflicts } from '../hooks/useConflicts'
import { RESOLUTION } from '../utils/conflictResolver'
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
  const [resolvedTypes, setResolvedTypes] = useState({}) // conflictId -> resolution type string
  const [mergedFields, setMergedFields] = useState({})
  const [warnedBeforeClose, setWarnedBeforeClose] = useState(false)
  const dialogRef = useRef(null)
  const descriptionId = 'conflict-dialog-desc'

  const currentConflict = conflicts[currentIndex] || null
  const totalUnresolved = conflicts.length

  // MAJOR 4: Auto-focus on modal open — focus the first focusable element
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return
    const firstFocusable = dialog.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (firstFocusable) {
      firstFocusable.focus()
    } else {
      dialog.focus()
    }
  }, [open])

  // MAJOR 3: Focus trap — keep tab focus within the modal while open
  useEffect(() => {
    if (!open) return

    const dialog = dialogRef.current
    if (!dialog) return

    const focusableSelector =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return

      const focusableElements = dialog.querySelectorAll(focusableSelector)
      if (focusableElements.length === 0) {
        e.preventDefault()
        return
      }

      const firstFocusable = focusableElements[0]
      const lastFocusable = focusableElements[focusableElements.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if focus is on first element, wrap to last
        if (document.activeElement === firstFocusable) {
          e.preventDefault()
          lastFocusable.focus()
        }
      } else {
        // Tab: if focus is on last element, wrap to first
        if (document.activeElement === lastFocusable) {
          e.preventDefault()
          firstFocusable.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // Reset index when conflicts change
  const resetState = useCallback(() => {
    setCurrentIndex(0)
    setResolvedIds(new Set())
    setResolvedTypes({})
    setMergedFields({})
    setWarnedBeforeClose(false)
  }, [])

  // MAJOR 5: Warn before close when unresolved conflicts exist
  const handleClose = useCallback(() => {
    const hasUnresolved = conflicts.length > 0 && resolvedIds.size < conflicts.length
    if (hasUnresolved && !warnedBeforeClose) {
      setWarnedBeforeClose(true)
      // Use a brief state toggle to show the warning message in the UI
      return
    }
    resetState()
    onClose()
  }, [conflicts.length, resolvedIds.size, warnedBeforeClose, resetState, onClose])

  const handleResolve = useCallback(async (conflictId, resolution) => {
    if (!conflictId) return
    setResolving(conflictId)

    const mergedItem = resolution === RESOLUTION.MERGE
      ? mergedFields[conflictId] || undefined
      : undefined

    const ok = await resolveConflict(conflictId, resolution, mergedItem)
    if (ok) {
      setResolvedIds((prev) => new Set([...prev, conflictId]))
      // MINOR 10: Store the resolution type for the banner
      const resolutionLabels = {
        [RESOLUTION.USE_SERVER]: t('conflict.server'),
        [RESOLUTION.USE_LOCAL]: t('conflict.local'),
        [RESOLUTION.MERGE]: t('conflict.merge'),
      }
      setResolvedTypes((prev) => ({
        ...prev,
        [conflictId]: resolutionLabels[resolution] || resolution,
      }))

      // MINOR 6: Auto-advance after resolution — brief delay then next or close
      setTimeout(() => {
        setResolving(null)
        if (currentIndex < conflicts.length - 1) {
          setCurrentIndex((i) => i + 1)
        } else {
          // All resolved — leave on last conflict showing resolved banner
          setResolving(null)
        }
      }, 800)
    } else {
      setResolving(null)
    }
  }, [resolveConflict, mergedFields, currentIndex, conflicts.length])

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
  const resolutionType = currentConflict ? resolvedTypes[currentConflict.conflictId] : null
  const isLastConflict = currentIndex >= totalUnresolved - 1
  const shouldWarn = warnedBeforeClose && hasUnresolved && resolvedIds.size < totalUnresolved

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('conflict.title')}
        aria-describedby={descriptionId}
        onClick={(e) => e.stopPropagation()}
        // Make the dialog itself focusable for the focus trap
        tabIndex={-1}
      >
        {/* Hidden description for screen readers (MAJOR 9) */}
        <div id={descriptionId} className="visually-hidden">
          {t('conflict.dialogDescription', { count: totalUnresolved })}
        </div>

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

        {/* MAJOR 5: Warn before close banner */}
        {shouldWarn && (
          <div className="conflict-modal-warn-banner" role="alert">
            {t('conflict.warnBeforeClose', { remaining: totalUnresolved - resolvedIds.size })}
            <button
              type="button"
              className="conflict-modal-warn-confirm"
              onClick={() => { resetState(); onClose() }}
            >
              {t('conflict.warnConfirmClose')}
            </button>
            <button
              type="button"
              className="conflict-modal-warn-dismiss"
              onClick={() => setWarnedBeforeClose(false)}
            >
              {t('conflict.warnCancel')}
            </button>
          </div>
        )}

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

              {/* Resolution status — MINOR 10: include resolution type */}
              {isResolved && (
                <div className="conflict-modal-resolved-banner">
                  {resolutionType
                    ? t('conflict.resolvedWith', { type: resolutionType })
                    : t('conflict.resolved')}
                </div>
              )}

              {/* Diff view */}
              {!isResolved && (
                <div className="conflict-modal-diff">
                  <div className="conflict-modal-diff-header">
                    <span className="conflict-modal-diff-label-field">
                      {t('conflict.field')}
                    </span>
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
                      {/* MINOR 7: loading spinner */}
                      {resolving === currentConflict.conflictId ? (
                        <span className="conflict-modal-spinner" aria-hidden="true" />
                      ) : null}
                      {t('conflict.useServer')}
                    </button>

                    <button
                      type="button"
                      className="conflict-modal-btn conflict-modal-btn-local"
                      onClick={() => handleResolve(currentConflict.conflictId, RESOLUTION.USE_LOCAL)}
                      disabled={resolving === currentConflict.conflictId}
                    >
                      {resolving === currentConflict.conflictId ? (
                        <span className="conflict-modal-spinner" aria-hidden="true" />
                      ) : null}
                      {t('conflict.useLocal')}
                    </button>

                    {currentConflict.policy?.mergeableFields?.length > 0 && (
                      <button
                        type="button"
                        className="conflict-modal-btn conflict-modal-btn-merge"
                        onClick={() => handleResolve(currentConflict.conflictId, RESOLUTION.MERGE, mergedFields[currentConflict.conflictId])}
                        disabled={resolving === currentConflict.conflictId}
                      >
                        {resolving === currentConflict.conflictId ? (
                          <span className="conflict-modal-spinner" aria-hidden="true" />
                        ) : null}
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
                    const currentMergedValue = mergedFields[currentConflict.conflictId]?.[field]
                    return (
                      <div key={field} className="conflict-modal-merge-field-row">
                        <span className="conflict-modal-merge-field-name">{field}</span>
                        <label className="conflict-modal-merge-radio">
                          <input
                            type="radio"
                            name={`merge-${currentConflict.conflictId}-${field}`}
                            // CRITICAL 2: fixed checked expression — server radio checked when value === sVal
                            checked={currentMergedValue === sVal}
                            onChange={() => handleMergeField(field, sVal)}
                          />
                          <span>{t('conflict.server')}: {String(sVal ?? '—')}</span>
                        </label>
                        <label className="conflict-modal-merge-radio">
                          <input
                            type="radio"
                            name={`merge-${currentConflict.conflictId}-${field}`}
                            checked={currentMergedValue === lVal}
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