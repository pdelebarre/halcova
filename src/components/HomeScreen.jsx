import { useMemo } from 'react'
import { t } from '../i18n'
import { splitArtistTitle } from '../utils/match'
import SyncStatus from './SyncStatus'
import SectionHeader from './SectionHeader'
import CoverShelf from './CoverShelf'
import './HomeScreen.css'

/**
 * Home Screen — M2 collector home redesign (#320).
 *
 * Answers three questions:
 *   1. What I own — collection stats, item count, on-loan count
 *   2. What's new — recent additions shelf (new arrivals)
 *   3. What can I do next — action prompts (scan, search, manual add)
 *
 * Integrates:
 *   - Offline-copy indicator via SyncStatus (#159/#289)
 *   - Conflict resolution badge (#161)
 *
 * SECURITY RULES:
 *   - Never renders user credentials in the UI
 *   - All displayed text is static localized strings
 *   - Item metadata (title, artist) is rendered via the existing card
 *     component which applies isDangerousContent guarding (#409/#315)
 *   - Malformed/missing data degrades gracefully (defensive reads)
 */
export default function HomeScreen({
  catalog,
  items = [],
  wishlistItems = [],
  status,
  source,
  mirroredAt,
  mutationSeq,
  conflictCount = 0,
  onSyncNow,
  onOpenItem,
  onScan,
  onScanCover,
  onManualAdd,
  onOpenWishlist,
  onOpenCollection,
  onOpenConflicts,
  lendingEnabled = false,
  isDemo = false,
  isFree = false,
}) {
  const ownedItems = useMemo(() => items.filter((it) => !it.wishlist), [items])

  // NEW_ARRIVALS_COUNT — how many of the most recently added items to feature.
  const NEW_ARRIVALS_COUNT = 5

  // Recent additions: sorted by dateAdded, newest first.
  const recentAdditions = useMemo(() => {
    if (ownedItems.length === 0) return []
    return [...ownedItems]
      .sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0))
      .slice(0, NEW_ARRIVALS_COUNT)
  }, [ownedItems])

  // Items currently on loan.
  const onLoanItems = useMemo(() => {
    if (!lendingEnabled) return []
    return ownedItems.filter((it) => it.lending)
  }, [ownedItems, lendingEnabled])

  const hasItems = ownedItems.length > 0
  const { Card } = catalog?.components || {}

  // Genres present in the collection, grouped by count
  const genres = useMemo(() => {
    const genreMap = new Map()
    for (const item of ownedItems) {
      const genreList = item.genre
      if (!genreList) continue
      if (Array.isArray(genreList)) {
        for (const g of genreList) genreMap.set(g, (genreMap.get(g) || 0) + 1)
      } else if (typeof genreList === 'string') {
        genreMap.set(genreList, (genreMap.get(genreList) || 0) + 1)
      }
    }
    return [...genreMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
  }, [ownedItems])

  // SECURITY: never render raw metadata strings — card component handles
  // isDangerousContent guarding. We pass items through the existing pipeline.

  return (
    <div className="home-screen" data-kind={catalog?.kind || 'records'}>
      {/* Offline-copy indicator (#159/#289) — appears only when browsing the
          local mirror. SyncStatus handles its own visibility. */}
      <div className="home-sync-area">
        <SyncStatus
          source={source}
          mirroredAt={mirroredAt}
          syncId={mutationSeq}
          onSyncNow={onSyncNow}
        />

        {/* Conflict resolution badge (#161) — when conflicts exist, show a
            compact entry point above the home content. */}
        {conflictCount > 0 && onOpenConflicts && (
          <button
            type="button"
            className="home-conflict-badge"
            onClick={onOpenConflicts}
            aria-label={t('home.conflictsBadge', { n: conflictCount })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            <span>{t('home.conflictsBadge', { n: conflictCount })}</span>
          </button>
        )}
      </div>

      {/* Greeting / status section */}
      <header className="home-greeting">
        <h1 className="home-greeting-title">{catalog?.copy?.homeTitle || t('home.greeting')}</h1>
        {hasItems && (
          <p className="home-greeting-count">
            {t('home.collectionCount', { n: ownedItems.length })}
          </p>
        )}
      </header>

      {/* What I own — stats row (owned counts, on loan, wishlist) */}
      {hasItems && (
        <section className="home-stats" aria-label={t('home.whatYouOwn')}>
          <div className="home-stat">
            <span className="home-stat-value">{ownedItems.length}</span>
            <span className="home-stat-label">{t('home.owned')}</span>
          </div>
          {lendingEnabled && (
            <div className="home-stat">
              <span className="home-stat-value">{onLoanItems.length}</span>
              <span className="home-stat-label">{t('home.onLoan')}</span>
            </div>
          )}
          <button
            type="button"
            className="home-stat home-stat-action"
            onClick={onOpenWishlist}
            aria-label={t('home.wishlist')}
          >
            <span className="home-stat-value">{wishlistItems.length}</span>
            <span className="home-stat-label">{t('home.wishlist')}</span>
          </button>
        </section>
      )}

      {/* Browse by genre — when items exist */}
        {hasItems && genres.length > 0 && (
          <section className="home-section" aria-labelledby="home-genres-heading">
            <SectionHeader
              id="home-genres-heading"
              title={t('home.browseByGenre')}
            />
            <div className="home-genre-list">
              {genres.map(([genre, count]) => (
                <button
                  key={genre}
                  type="button"
                  className="home-genre-chip"
                  onClick={() => onOpenCollection(catalog.kind, { genre })}
                >
                  <span className="home-genre-name">{genre}</span>
                  <span className="home-genre-count">{count}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* What's new — most recent additions shelf */}
      {recentAdditions.length > 0 && Card && (
        <section className="home-section" aria-labelledby="home-recent-heading">
          <SectionHeader
            id="home-recent-heading"
            kicker={catalog?.copy?.floor?.newArrivals?.kicker || ''}
            title={t('home.recentTitle')}
            count={recentAdditions.length}
          />
          <CoverShelf
            items={recentAdditions}
            Card={Card}
            onOpen={onOpenItem}
            lendingEnabled={lendingEnabled}
            copy={catalog?.copy || {}}
            label={t('home.recentTitle')}
          />
        </section>
      )}

      {/* What can I do next — action prompts */}
      <section className="home-section home-actions" aria-label={t('home.whatNext')}>
        {!hasItems && (
          <div className="home-empty">
            <div className="home-empty-icon" aria-hidden="true" />
            <p className="home-empty-title">{t('home.emptyTitle')}</p>
            <p className="home-empty-sub">{t('home.emptySub')}</p>
          </div>
        )}

        {/* Quick action buttons — thumb-friendly 44px min touch targets */}
        <div className="home-action-grid">
          {!isDemo && (
            <button
              type="button"
              className="home-action-btn home-action-scan"
              onClick={onScan}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 7V4a1 1 0 011-1h3M17 3h3a1 1 0 011 1v3M21 17v3a1 1 0 01-1 1h-3M7 21H4a1 1 0 01-1-1v-3" />
                <path d="M7 12h10" />
              </svg>
              <span className="home-action-label">{t('home.tryScan')}</span>
            </button>
          )}
          {!isDemo && (
            <button
              type="button"
              className="home-action-btn"
              onClick={onScanCover}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span className="home-action-label">{t('coverScan.title')}</span>
            </button>
          )}
          {!isDemo && (
            <button
              type="button"
              className="home-action-btn"
              onClick={onManualAdd}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <span className="home-action-label">{t('home.trySearch')}</span>
            </button>
          )}
        </div>

        {/* View full collection — when items exist */}
        {hasItems && (
          <button
            type="button"
            className="home-view-all-btn"
            onClick={onOpenCollection}
          >
            <span>{t('home.viewCollection')}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        )}
      </section>
    </div>
  )
}