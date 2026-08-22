// SmartFeedbackInbox.jsx — AI-powered smart feedback inbox (M4 P1, #307).
// Consumes merged #306 AI triage data to organize feedback into smart queue
// states, display opportunity cards, and enable one-click triage.
//
// Security:
//   - All AI/data responses are guarded: malformed/missing triage data degrades
//     gracefully (never dark-screens the PWA).
//   - XSS-safe rendering: all untrusted strings go through fbText() guard.
//   - No unnecessary PII/secrets displayed: only authorName (public display
//     name) is shown; email/code/private fields are never rendered.
//   - User confirmation before mutation: accept/merge actions require confirm().
//
// Queue states (derived from AI triage):
//   - Needs attention: security/performance classifications or critical priority
//   - New: unclassified feedback (no triage data yet)
//   - Bugs: bug classification
//   - Ideas: enhancement classification
//   - Opportunities: enhancement + high/critical priority
//   - Shipped: done/wontfix/duplicate status

import { useCallback, useEffect, useMemo, useState } from 'react'
import * as feedbackApi from '../api/feedback'
import { t } from '../i18n'
import { deviceLabel } from '../utils/appInfo'

// ---------------------------------------------------------------------------
// Guard helpers (mirror AdminPanel.jsx patterns)
// ---------------------------------------------------------------------------

function fbText(v) {
  return typeof v === 'string' ? v : ''
}

function fmtDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function pct(v) {
  return `${Math.round(num(v) * 100)}%`
}

// ---------------------------------------------------------------------------
// Classification label mapping (mirrors #306 allow-lists)
// ---------------------------------------------------------------------------

const CLASSIFICATION_LABELS = new Set([
  'bug', 'enhancement', 'documentation', 'security', 'performance',
])

const PRIORITY_LEVELS = new Set(['critical', 'high', 'medium', 'low'])

function classificationLabel(label) {
  if (CLASSIFICATION_LABELS.has(label)) {
    return t(`admin.smartInbox.classification.${label}`)
  }
  return t('admin.smartInbox.classification.unknown')
}

function priorityLabel(priority) {
  if (PRIORITY_LEVELS.has(priority)) {
    return t(`admin.smartInbox.priority.${priority}`)
  }
  return priority || '—'
}

// ---------------------------------------------------------------------------
// Queue state derivation
// ---------------------------------------------------------------------------

// Derive the smart queue state for a feedback item based on its triage data
// and current status. Returns one of: 'needsAttention', 'new', 'bugs',
// 'ideas', 'opportunities', 'shipped'.
function queueState(item) {
  const status = item?.status || 'open'
  const triage = item?.triage || {}

  // Shipped states: done/wontfix/duplicate are terminal.
  if (status === 'done' || status === 'wontfix' || status === 'duplicate') {
    return 'shipped'
  }

  // Needs attention: security/performance or critical priority.
  const classification = triage.classification?.label
  const priority = triage.priority
  if (classification === 'security' || classification === 'performance') {
    return 'needsAttention'
  }
  if (priority === 'critical') {
    return 'needsAttention'
  }

  // Opportunities: enhancement + high/critical priority.
  if (classification === 'enhancement' && (priority === 'high' || priority === 'critical')) {
    return 'opportunities'
  }

  // Bugs: bug classification.
  if (classification === 'bug') {
    return 'bugs'
  }

  // Ideas: enhancement classification (non-high-priority).
  if (classification === 'enhancement') {
    return 'ideas'
  }

  // New: no triage data or unclassified.
  if (!triage.classification) {
    return 'new'
  }

  // Fallback: documentation/performance without critical priority → new.
  return 'new'
}

// ---------------------------------------------------------------------------
// Queue tab config
// ---------------------------------------------------------------------------

const QUEUE_TABS = [
  { id: 'needsAttention', icon: '\u26A0' },
  { id: 'new', icon: '\uD83C\uDD95' },
  { id: 'bugs', icon: '\uD83D\uDC1B' },
  { id: 'ideas', icon: '\uD83D\uDCA1' },
  { id: 'opportunities', icon: '\u2B50' },
  { id: 'shipped', icon: '\u2713' },
]

// ---------------------------------------------------------------------------
// OpportunityCard — displays a single AI-triaged feedback item as an
// opportunity card with summary, type, area, priority, confidence, affected
// users, similar reports, and one-click triage actions.
// ---------------------------------------------------------------------------

function OpportunityCard({ item, onAccept, onMerge, onRefresh, busy }) {
  const triage = item?.triage || {}
  const classification = triage.classification || {}
  const dups = Array.isArray(triage.duplicateCandidates) ? triage.duplicateCandidates : []
  const [expanded, setExpanded] = useState(false)
  const [detailExpanded, setDetailExpanded] = useState(false)

  const isLowConfidence = triage.isLowConfidence === true
  const canOneClick = !isLowConfidence && classification.confidence >= 0.7

  return (
    <div className={`smart-opp-card${isLowConfidence ? ' is-low-confidence' : ''}`}>
      {/* Card header: summary + primary action */}
      <div className="smart-opp-header">
        <div className="smart-opp-summary">
          <span className={`smart-opp-classification is-${classification.label || 'unknown'}`}>
            {classificationLabel(classification.label)}
          </span>
          <span className={`smart-opp-priority is-${triage.priority || 'medium'}`}>
            {priorityLabel(triage.priority)}
          </span>
          {isLowConfidence && (
            <span className="smart-opp-warning" title={t('admin.smartInbox.recommendation.lowConfidence')}>
              {t('admin.smartInbox.recommendation.review')}
            </span>
          )}
        </div>
        <p className="smart-opp-headline">{fbText(triage.summary) || fbText(item?.message)?.slice(0, 120) || '\u2014'}</p>
      </div>

      {/* Primary recommended action — visually dominant */}
      <div className="smart-opp-action">
        {canOneClick ? (
          <button
            type="button"
            className="btn btn-primary smart-opp-accept"
            disabled={busy === item.id}
            onClick={() => onAccept(item)}
          >
            {busy === item.id ? t('admin.feedback.saving') : t('admin.smartInbox.recommendation.accept')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost smart-opp-review"
            disabled={busy === item.id}
            onClick={() => setExpanded(!expanded)}
          >
            {t('admin.smartInbox.recommendation.review')}
          </button>
        )}
        {dups.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-sm smart-opp-merge"
            disabled={busy === item.id}
            onClick={() => onMerge(item)}
          >
            {busy === item.id ? t('admin.feedback.saving') : t('admin.smartInbox.recommendation.merge')}
          </button>
        )}
      </div>

      {/* Expanded details — progressive disclosure */}
      {expanded && (
        <div className="smart-opp-details">
          <dl className="smart-opp-meta">
            <div>
              <dt>{t('admin.smartInbox.opportunity.type')}</dt>
              <dd>{classificationLabel(classification.label)}</dd>
            </div>
            <div>
              <dt>{t('admin.smartInbox.opportunity.area')}</dt>
              <dd>{fbText(triage.productArea) || '\u2014'}</dd>
            </div>
            <div>
              <dt>{t('admin.smartInbox.opportunity.priority')}</dt>
              <dd>{priorityLabel(triage.priority)}</dd>
            </div>
            <div>
              <dt>{t('admin.smartInbox.opportunity.confidence')}</dt>
              <dd>{pct(classification.confidence)}</dd>
            </div>
            <div>
              <dt>{t('admin.smartInbox.opportunity.affectedUsers')}</dt>
              <dd>{fbText(item?.authorName) || '\u2014'}</dd>
            </div>
          </dl>

          {/* Duplicate candidates */}
          {dups.length > 0 && (
            <section className="smart-opp-dups">
              <h4 className="smart-opp-dups-title">{t('admin.smartInbox.opportunity.similarReports')}</h4>
              <ul className="smart-opp-dups-list">
                {dups.map((dup, i) => (
                  <li key={dup.feedbackId || i} className="smart-opp-dup-item">
                    <span className="smart-opp-dup-id">{fbText(dup.feedbackId)}</span>
                    <span className="smart-opp-dup-score">
                      {t('admin.smartInbox.opportunity.score')}: {pct(dup.score)}
                    </span>
                    <span className="smart-opp-dup-evidence">{fbText(dup.evidence)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Original feedback — progressive disclosure */}
          <div className="smart-opp-feedback">
            <button
              type="button"
              className="smart-opp-toggle"
              onClick={() => setDetailExpanded(!detailExpanded)}
              aria-expanded={detailExpanded}
            >
              {detailExpanded
                ? t('admin.smartInbox.detail.showLess')
                : t('admin.smartInbox.detail.showMore')}
            </button>
            {detailExpanded && (
              <div className="smart-opp-feedback-detail">
                <h4>{t('admin.smartInbox.detail.originalFeedback')}</h4>
                <p className="smart-opp-message">{fbText(item?.message) || '\u2014'}</p>
                <h4>{t('admin.smartInbox.detail.technicalDetails')}</h4>
                <dl className="smart-opp-tech">
                  <div>
                    <dt>{t('admin.feedback.route')}</dt>
                    <dd>{fbText(item?.url) || '\u2014'}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.feedback.version')}</dt>
                    <dd>{fbText(item?.appVersion) || '\u2014'}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.feedback.device')}</dt>
                    <dd>{deviceLabel(fbText(item?.userAgent)) || '\u2014'}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.feedback.from')}</dt>
                    <dd>{fbText(item?.authorName) || '\u2014'}</dd>
                  </div>
                  <div>
                    <dt>{t('admin.feedback.date')}</dt>
                    <dd>{fmtDateTime(item?.createdAt) || '\u2014'}</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SmartFeedbackInbox — the main component
// ---------------------------------------------------------------------------

export default function SmartFeedbackInbox({ onClose }) {
  const [allItems, setAllItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeQueue, setActiveQueue] = useState('needsAttention')
  const [busy, setBusy] = useState(null) // item id with an op in flight
  const [msg, setMsg] = useState('')

  // Load feedback items with triage data.
  const loadItems = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const items = await feedbackApi.listFeedback()
      const itemsWithTriage = Array.isArray(items) ? items : []

      // Fetch triage data for items that don't have it yet.
      const enriched = await Promise.all(
        itemsWithTriage.map(async (item) => {
          if (item?.triage) return item
          const triage = await feedbackApi.fetchFeedbackTriage(item.id)
          return { ...item, triage: triage || undefined }
        })
      )
      setAllItems(enriched)
    } catch (err) {
      setAllItems([])
      setError(err?.message || t('admin.smartInbox.error'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadItems() }, [loadItems])

  // Group items by queue state.
  const queueGroups = useMemo(() => {
    const groups = {}
    for (const tab of QUEUE_TABS) {
      groups[tab.id] = []
    }
    for (const item of allItems) {
      const qs = queueState(item)
      if (groups[qs]) {
        groups[qs].push(item)
      } else {
        groups.needsAttention.push(item) // fallback
      }
    }
    return groups
  }, [allItems])

  const activeItems = queueGroups[activeQueue] || []

  // One-click accept: mark as in_progress (high-confidence recommendation).
  async function handleAccept(item) {
    if (busy) return
    if (!window.confirm(t('admin.smartInbox.recommendation.confirmAccept'))) return
    setBusy(item.id)
    setMsg('')
    try {
      const updated = await feedbackApi.updateFeedback({ id: item.id, status: 'in_progress' })
      if (updated?.id) {
        setAllItems((items) => items.map((i) => (i.id === updated.id ? { ...updated, triage: i.triage } : i)))
      } else {
        await loadItems()
      }
      setMsg(t('admin.smartInbox.recommendation.accepted'))
    } catch (err) {
      setMsg(err?.message || '')
    } finally {
      setBusy(null)
    }
  }

  // One-click merge: mark as duplicate.
  async function handleMerge(item) {
    if (busy) return
    if (!window.confirm(t('admin.smartInbox.recommendation.confirmMerge'))) return
    setBusy(item.id)
    setMsg('')
    try {
      const updated = await feedbackApi.updateFeedback({ id: item.id, status: 'duplicate' })
      if (updated?.id) {
        setAllItems((items) => items.map((i) => (i.id === updated.id ? { ...updated, triage: i.triage } : i)))
      } else {
        await loadItems()
      }
      setMsg(t('admin.smartInbox.recommendation.merged'))
    } catch (err) {
      setMsg(err?.message || '')
    } finally {
      setBusy(null)
    }
  }

  // Count badge for each queue tab.
  const queueCounts = useMemo(() => {
    const counts = {}
    for (const tab of QUEUE_TABS) {
      counts[tab.id] = (queueGroups[tab.id] || []).length
    }
    return counts
  }, [queueGroups])

  return (
    <section className="smart-inbox">
      <h3 className="admin-h3">{t('admin.smartInbox.title')}</h3>
      <p className="admin-sub">{t('admin.smartInbox.subtitle')}</p>

      {msg && <p className="sheet-status" role="status">{msg}</p>}
      {error && (
        <p className="sheet-error" role="alert">
          {error}
          <button type="button" className="btn btn-ghost btn-sm admin-fb-retry" onClick={loadItems}>
            {t('admin.smartInbox.retry')}
          </button>
        </p>
      )}

      {/* Queue tabs */}
      <div className="smart-queue-tabs" role="tablist" aria-label={t('admin.smartInbox.title')}>
        {QUEUE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeQueue === tab.id}
            className={`smart-queue-tab${activeQueue === tab.id ? ' active' : ''}`}
            onClick={() => setActiveQueue(tab.id)}
          >
            <span className="smart-queue-icon" aria-hidden="true">{tab.icon}</span>
            <span className="smart-queue-label">{t(`admin.smartInbox.queue.${tab.id}`)}</span>
            {queueCounts[tab.id] > 0 && (
              <span className="admin-badge smart-queue-count">{queueCounts[tab.id]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Queue content */}
      {loading ? (
        <p className="sheet-status">{t('common.loading')}</p>
      ) : activeItems.length === 0 ? (
        <p className="sheet-empty">{t('admin.smartInbox.queue.empty')}</p>
      ) : (
        <div className="smart-queue-items">
          {activeItems.map((item) => (
            <OpportunityCard
              key={item.id}
              item={item}
              onAccept={handleAccept}
              onMerge={handleMerge}
              onRefresh={loadItems}
              busy={busy}
            />
          ))}
        </div>
      )}
    </section>
  )
}