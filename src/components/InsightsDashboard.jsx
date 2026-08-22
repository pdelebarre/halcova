// InsightsDashboard.jsx — Collection insights dashboard (FEAT-9.4, #335).
//
// Shows AI-generated collection insights: completion suggestions,
// "you might like" recommendations, and gap analysis. Also shows
// deterministic collection stats (genre distribution, decade spread,
// format breakdown) that are always available without AI.
//
// Security:
//   - XSS-safe: all AI-generated text is rendered through React's
//     auto-escaping (JSX text content, never dangerouslySetInnerHTML).
//   - Data-minimization: only canonical metadata is sent to the model.
//   - "AI suggests; app decides": suggestions are advisory only — no
//     auto-execution. Every suggestion card carries a disclaimer.
//   - Estimated values are clearly labelled as estimates.
//   - Expensive AI generation is cached server-side (5 min TTL).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { countBy, decadeOf } from '../utils/browse'
import { t } from '../i18n'
import * as authApi from '../api/auth'
import './InsightsDashboard.css'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

// Guarded string — AI-generated text is untrusted but rendered through
// React's auto-escaping (JSX text content). This is a defense-in-depth
// guard so a non-string value never crashes the render.
function safeString(v) {
  return typeof v === 'string' ? v : ''
}

// Guarded number — AI-generated numbers are untrusted.
function safeNum(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// Stat card (reused from AdminPanel pattern)
// ---------------------------------------------------------------------------

function StatCard({ label, value, caption, className = '' }) {
  return (
    <dl className={`insight-stat-card ${className}`.trim()}>
      <dt className="insight-stat-label">{label}</dt>
      <dd className="insight-stat-value">{value}</dd>
      {caption ? <dd className="insight-stat-caption">{caption}</dd> : null}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Suggestion card — renders a single completion suggestion or recommendation
// ---------------------------------------------------------------------------

function SuggestionCard({ item, evidenceLabel }) {
  const title = safeString(item.title)
  const subtitle = safeString(item.subtitle)
  const artist = safeString(item.artist)
  const reason = safeString(item.reason)
  const evidence = safeString(item.evidence)
  const isEstimated = !!item.estimated

  return (
    <div className="insight-suggestion-card">
      <div className="insight-suggestion-main">
        <span className="insight-suggestion-title">{title}</span>
        {subtitle && <span className="insight-suggestion-sub">{subtitle}</span>}
        {artist && <span className="insight-suggestion-artist">{artist}</span>}
        <span className="insight-suggestion-reason">{reason}</span>
        {evidence && (
          <span className="insight-suggestion-evidence">
            {evidenceLabel ? evidenceLabel.replace('{evidence}', evidence) : evidence}
          </span>
        )}
      </div>
      {isEstimated && (
        <span className="insight-estimated-badge">{t('admin.insights.completions.estimated')}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gap card — renders a single collection gap
// ---------------------------------------------------------------------------

function GapCard({ item }) {
  const description = safeString(item.description)
  const reason = safeString(item.reason)
  const evidence = safeString(item.evidence)
  const isEstimated = !!item.estimated

  return (
    <div className="insight-suggestion-card">
      <div className="insight-suggestion-main">
        <span className="insight-suggestion-title">{description}</span>
        <span className="insight-suggestion-reason">{reason}</span>
        {evidence && (
          <span className="insight-suggestion-evidence">
            {t('admin.insights.gaps.evidence', { evidence })}
          </span>
        )}
      </div>
      {isEstimated && (
        <span className="insight-estimated-badge">{t('admin.insights.completions.estimated')}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function InsightsDashboard({ items = [], collectionType = 'records', onClose }) {
  // Tab: 'stats' (deterministic, no AI) | 'ai' (AI-generated insights)
  const [tab, setTab] = useState('stats')

  // AI insights state
  const [insights, setInsights] = useState(null)
  const [insightsLoading, setInsightsLoading] = useState(false)
  const [insightsError, setInsightsError] = useState('')
  const [insightsFetchedAt, setInsightsFetchedAt] = useState('')
  const [insightsCached, setInsightsCached] = useState(false)

  // Deterministic stats (computed client-side, no AI needed)
  const genres = useMemo(() => countBy(items, (it) => [it.genre].filter(Boolean)), [items])
  const decades = useMemo(() => countBy(items, (it) => [decadeOf(it.year)]), [items])
  const formats = useMemo(() => countBy(items, (it) => [it.format].filter(Boolean)), [items])

  const generateInsights = useCallback(async () => {
    if (items.length === 0) return
    setInsightsLoading(true)
    setInsightsError('')
    setInsights(null)
    try {
      // Data-minimization: send only canonical fields
      const canonicalItems = items.map((it) => ({
        id: it.id,
        title: it.title || '',
        subtitle: it.subtitle || '',
        artist: it.artist || '',
        genre: it.genre || '',
        year: it.year || '',
        format: it.format || '',
        label: it.label || '',
      }))
      const res = await authApi.adminAiInsights({ collectionType, items: canonicalItems })
      setInsights(res?.insights || null)
      setInsightsCached(!!res?.cached)
      setInsightsFetchedAt(new Date().toISOString())
    } catch (err) {
      setInsightsError(err?.message || t('admin.insights.error'))
    } finally {
      setInsightsLoading(false)
    }
  }, [items, collectionType])

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('admin.insights.title')}>
      <div className="sheet insights-sheet">
        <div className="sheet-header">
          <h2>{t('admin.insights.title')}</h2>
          <button type="button" className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        {/* Tab bar: Stats | AI Insights */}
        <div className="insights-tabs" role="tablist" aria-label={t('admin.insights.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'stats'}
            className={`insights-tab${tab === 'stats' ? ' active' : ''}`}
            onClick={() => setTab('stats')}
          >
            {t('admin.insights.section.stats')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'ai'}
            className={`insights-tab${tab === 'ai' ? ' active' : ''}`}
            onClick={() => setTab('ai')}
          >
            {t('admin.insights.title')}
          </button>
        </div>

        <div className="insights-scroll">
          {/* ================================================================
              STATS TAB — deterministic, no AI needed
              ================================================================ */}
          {tab === 'stats' && (
            <section>
              <h3 className="insights-h3">{t('admin.insights.section.stats')}</h3>

              {/* Total items */}
              <div className="insights-total">
                <StatCard
                  label={t('admin.insights.stats.total')}
                  value={items.length.toLocaleString()}
                />
              </div>

              {/* Genre distribution */}
              <section className="insights-section">
                <h4 className="insights-h4">{t('admin.insights.stats.genre')}</h4>
                {genres.length === 0 ? (
                  <p className="insights-empty">{t('admin.insights.stats.noGenres')}</p>
                ) : (
                  <dl className="insights-list">
                    {genres.map((g) => (
                      <div key={g.label} className="insights-row">
                        <dt>{g.label}</dt>
                        <dd>{g.count}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              {/* Decade spread */}
              <section className="insights-section">
                <h4 className="insights-h4">{t('admin.insights.stats.decade')}</h4>
                {decades.length === 0 ? (
                  <p className="insights-empty">{t('admin.insights.stats.noDecades')}</p>
                ) : (
                  <dl className="insights-list">
                    {decades.map((d) => (
                      <div key={d.label} className="insights-row">
                        <dt>{d.label}</dt>
                        <dd>{d.count}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>

              {/* Format breakdown */}
              <section className="insights-section">
                <h4 className="insights-h4">{t('admin.insights.stats.format')}</h4>
                {formats.length === 0 ? (
                  <p className="insights-empty">{t('admin.insights.stats.noFormats')}</p>
                ) : (
                  <dl className="insights-list">
                    {formats.map((f) => (
                      <div key={f.label} className="insights-row">
                        <dt>{f.label}</dt>
                        <dd>{f.count}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            </section>
          )}

          {/* ================================================================
              AI INSIGHTS TAB — AI-generated suggestions
              ================================================================ */}
          {tab === 'ai' && (
            <section>
              <h3 className="insights-h3">{t('admin.insights.title')}</h3>
              <p className="insights-subtitle">{t('admin.insights.subtitle')}</p>

              {/* Generate button */}
              {!insights && !insightsLoading && !insightsError && (
                <div className="insights-generate-area">
                  {items.length === 0 ? (
                    <p className="insights-empty">{t('admin.insights.empty')}</p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={generateInsights}
                    >
                      {t('admin.insights.generate')}
                    </button>
                  )}
                </div>
              )}

              {/* Loading state */}
              {insightsLoading && (
                <p className="insights-status">{t('admin.insights.generating')}</p>
              )}

              {/* Error state */}
              {insightsError && !insightsLoading && (
                <p className="insights-error" role="alert">
                  {insightsError}
                  <button type="button" className="btn btn-ghost btn-sm insights-retry" onClick={generateInsights}>
                    {t('admin.insights.retry')}
                  </button>
                </p>
              )}

              {/* AI disclaimer */}
              {insights && (
                <p className="insights-disclaimer">{t('admin.insights.disclaimer')}</p>
              )}

              {/* Cached indicator */}
              {insights && insightsCached && insightsFetchedAt && (
                <p className="insights-cached">
                  {t('admin.insights.cached', { time: fmtDate(insightsFetchedAt) })}
                </p>
              )}

              {/* Completion suggestions */}
              {insights?.completionSuggestions && insights.completionSuggestions.length > 0 && (
                <section className="insights-section">
                  <h4 className="insights-h4">{t('admin.insights.section.completions')}</h4>
                  <div className="insights-suggestion-list">
                    {insights.completionSuggestions.map((item, i) => (
                      <SuggestionCard
                        key={i}
                        item={item}
                        evidenceLabel={t('admin.insights.completions.evidence')}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* "You might like" recommendations */}
              {insights?.recommendations && insights.recommendations.length > 0 && (
                <section className="insights-section">
                  <h4 className="insights-h4">{t('admin.insights.section.recommendations')}</h4>
                  <div className="insights-suggestion-list">
                    {insights.recommendations.map((item, i) => (
                      <SuggestionCard
                        key={i}
                        item={item}
                        evidenceLabel={t('admin.insights.recommendations.evidence')}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Collection gaps */}
              {insights?.gaps && insights.gaps.length > 0 && (
                <section className="insights-section">
                  <h4 className="insights-h4">{t('admin.insights.section.gaps')}</h4>
                  <div className="insights-suggestion-list">
                    {insights.gaps.map((item, i) => (
                      <GapCard key={i} item={item} />
                    ))}
                  </div>
                </section>
              )}

              {/* Empty state for AI tab */}
              {!insights && !insightsLoading && !insightsError && items.length > 0 && (
                <p className="insights-empty">{t('admin.insights.completions.empty')}</p>
              )}
            </section>
          )}
        </div>

        <div className="sheet-actions insights-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {t('common.done')}
          </button>
        </div>
      </div>
    </div>
  )
}