import { t } from '../i18n'
import { useOfflineSyncStatus } from '../hooks/useOfflineSyncStatus'
import './SyncStatus.css'

// M2 Offline Sync Status UI (#159; ADR-0016 UX rules, ADR-0019 Dec 12).
//
// Surfaces the offline/pending/synchronized/conflict-or-error states for the
// collector journey, and explains when an action is queued. It reads from the
// offline mirror (source === 'offline') and the outbox summary (read-only
// interface, #292). It NEVER writes and NEVER fabricates a pending/untracked
// mutation — a failed online action is surfaced by the collection layer, not
// silently converted into an untracked local change here.
//
// SECURITY: every message rendered here is a static, localized string. No raw
// exception, token, access code or private collection content is ever shown.
// Error states use a safe generic message (no secrets).
//
// The component renders a compact status strip ONLY when there is something
// meaningful to communicate: an offline copy is showing, there are queued/
// conflicted/failed operations, or (online, nothing pending) a "synced" line
// when the user is actively syncing. It is thumb-friendly and safe-area-aware
// (see SyncStatus.css).
export default function SyncStatus({
  source = null,
  mirroredAt = null,
  syncId = 0,
  onSyncNow,
}) {
  const { online, summary } = useOfflineSyncStatus({
    source,
    mirroredAt,
    syncId,
  })

  const showingOfflineCopy = source === 'offline'
  const pendingCount = summary.pending
  const needsAttention = summary.conflict > 0 || summary.error > 0

  // Only render when there is something meaningful to communicate: an offline
  // copy is showing, operations are queued, or operations need attention. A
  // live, fully-synced, idle view renders nothing (the live data itself is the
  // synchronized state) — matching OnlineIndicator's avoid-always-on principle.
  if (!showingOfflineCopy && !needsAttention && pendingCount === 0) return null

  const detail =
    mirroredAt ? new Date(mirroredAt).toLocaleString() : ''

  return (
    <div className="sync-status" role="status" aria-live="polite">
      <div className="sync-status-body">
        {showingOfflineCopy && (
          <p className="sync-status-line sync-status-offline-copy">
            {t('offline.mirrorCopy', { at: detail })}
          </p>
        )}

        {/* M2 #159: "All changes synced" — surfaced after a successful Sync-now
            / queue drain (online, nothing pending, nothing needing attention).
            Only shown inside the already-rendered strip (never always-on). */}
        {online && !needsAttention && pendingCount === 0 && (
          <p className="sync-status-line sync-status-synced">
            {t('offline.synced')}
          </p>
        )}

        {pendingCount > 0 && (
          <p className="sync-status-line sync-status-pending">
            {t('offline.pending', { n: pendingCount })}
          </p>
        )}

        {needsAttention && (
          <p className="sync-status-line sync-status-attention">
            {t('offline.needsAttention')}
          </p>
        )}

        {!online && pendingCount > 0 && (
          <p className="sync-status-line sync-status-queued-hint">
            {t('offline.queuedHint')}
          </p>
        )}
      </div>

      {(pendingCount > 0 || needsAttention) && onSyncNow && (
        <button
          type="button"
          className="sync-status-sync-now"
          onClick={onSyncNow}
        >
          {t('offline.syncNow')}
        </button>
      )}
    </div>
  )
}
