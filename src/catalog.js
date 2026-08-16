// A "catalog" is everything the shared collection flow needs to know about one
// kind of thing we catalog (records or books): which API to look it up on,
// which components render it, and the copy used for labels/toasts/empty states.
//
// Records and books share the same item shape — title stored as "Artist -
// Author - Title", plus year/label/genre/coverImage/barcode — so one flow in
// CollectionView.jsx drives both.

import * as discogs from './api/discogs'
import * as books from './api/books'
import { t } from './i18n'
import { splitArtistTitle } from './utils/match'
import { decadeOf } from './utils/browse'
import AlbumCard from './components/AlbumCard'
import AlbumGrid from './components/AlbumGrid'
import AlbumDetail from './components/AlbumDetail'
import ManualAddModal from './components/ManualAddModal'
import BookCard from './components/BookCard'
import BookGrid from './components/BookGrid'
import BookDetail from './components/BookDetail'
import BookManualAddModal from './components/BookManualAddModal'

// The gamification suite (Phase 1 § Play — rollout-plan.md §1) is NOT a
// compile-time flag. The "Play" entry point is gated per account by the
// member's `features.games` entitlement (admin-granted on approve / toggled
// per member in the admin panel). The owner has it by default; demo visitors
// do not. See App.jsx (`gamesEnabled`) and AdminPanel.jsx.

export const recordsCatalog = {
  kind: 'records',
  entity: 'record',
  collectionLabel: 'crate', // used in t() interpolation
  searchPlaceholder: 'Search your crate…',
  storage: 'records',
  api: discogs,
  getDetail: discogs.getReleaseDetail,
  lookupName: 'Discogs',
  formats: ['LP', 'EP', 'CD', '7"', '12"'],
  genreLabel: 'Genre',
  artistLabel: 'artist',
  artistPlaceholder: 'All artists',
  sortOptions: [
    { value: 'added', label: 'Recently added' },
    { value: 'artist', label: 'Artist A–Z' },
    { value: 'year', label: 'Year' },
    { value: 'format', label: 'Format' },
  ],
  // The Aisles (§ Phase 2): browse axes for the aisle picker. Each axis knows
  // how to extract its bin value(s) from an item; bins are counted client-side.
  browseAxes: [
    { id: 'genre', label: 'Genre', value: (item) => (item.genre || []).map((g) => String(g).trim()).filter(Boolean) },
    { id: 'artist', label: 'Artist', value: (item) => [splitArtistTitle(item.title).artist].filter(Boolean) },
    { id: 'decade', label: 'Decade', value: (item) => [decadeOf(item.year)] },
    { id: 'format', label: 'Format', value: (item) => (item.formatType ? [item.formatType] : []) },
    { id: 'label', label: 'Label', value: (item) => (item.label ? [item.label] : []) },
  ],
  components: {
    Card: AlbumCard,
    Grid: AlbumGrid,
    Detail: AlbumDetail,
    ManualAdd: ManualAddModal,
  },
  detailLink: (item) => `https://www.discogs.com/release/${item.discogsId}`,
  detailLinkLabel: 'View on Discogs ↗',
  // Community reviews (Task 6): the provider id that anchors a review thread.
  reviewKey: (item) => item.discogsId,
  // Room theme (epic #95, T2 #110): the per-kind accent scope, provided by
  // App.jsx's ThemeProvider and applied as CSS variables on the collection
  // container in CollectionView.jsx. Values are CSS custom-property references
  // into the T1 token layer (src/index.css). Records = gold — exactly today's
  // look (a visual no-op). `accentText` / `ambient` are neutral-core references
  // until the room gets its own color.
  theme: {
    accent: 'var(--kind-records-accent)',
    accentText: 'var(--color-bg)',
    ambient: 'var(--color-surface-1)',
  },
  copy: {
    emptyIcon: 'empty-disc',
    // Kind-specific overrides for the shared collection flow.
    // Components use t() as the primary source; these are fallbacks / overrides.
    emptyTitle: 'Your crate is empty',
    emptySub: 'Scan the barcode on a sleeve to catalog your first record.',
    emptyTagline: 'your crate, cataloged',
    emptyBtn: 'Scan a record',
    // C2 onboarding (issue #88): three micro-steps replace the single
    // emptySub sentence. Step 3 uses the generic "collection" noun (not
    // "crate") to match the localized arrays and avoid DE/IT gender agreement.
    emptySteps: ['Scan the barcode', 'Confirm the match', "Done — it's in your collection"],
    // C2.4 (issue #88): persistent, non-blocking hint under the Scan button
    // in the empty state when Records lookups have no Discogs token.
    noTokenHint: 'Records lookups need a Discogs token — add yours in Settings.',
    // C2.3 (issue #85): "Try a sample" — a curated item fed straight into the
    // result flow (no lookup, no token, no network) so a new user sees a full
    // result sheet in ~10s. `isSample` marks the candidate read-only at every
    // write boundary — it can never be added / wishlisted / converted.
    trySample: 'Try a sample',
    trySampleNote: 'This is a sample — add your own item to start your collection.',
    // C2.3 (issue #85): the on-brand pill + safe primary on a sample's result
    // sheet. EN-primary for now; other locales fall back via i18n until the
    // native-speaker pass lands.
    trySampleBadge: 'Sample',
    trySampleCta: "That's the idea",
    loading: 'Loading your crate…',
    addToast: 'Added to your crate',
    removeLabel: 'Remove from crate',
    lookingUp: 'Looking it up on Discogs…',
    noMatch: 'No matches found on Discogs.',
    resultGood: { label: 'Not in your crate yet', sub: "You don't have this one." },
    resultOwned: { label: 'Already in your crate', sub: 'This exact record is already yours.' },
    resultSame: { label: 'You already own this album', sub: 'Different pressing or format — check before buying.' },
    sameHeading: 'Other pressings you own',
    moreBy: (name, n) => `More by ${name} in your crate (${n})`,
    nothingElseBy: (name) => `Nothing else by ${name} in your crate`,
    moreRelated: (n) => `and ${n} more`,
    scanNext: 'Scan next',
    // C1.1: scan-sourced results offer "Add & scan next" as the primary; the
    // plain "Add" demotes to a ghost slot so the scanning burst continues.
    addAndScanNext: 'Add & scan next',
    // C1.4: momentum toast — a factual per-session "added today" count (no
    // XP/badges). Function override; i18n `catalog.addedCount` is the fallback.
    addedCount: (n) => `Added — ${n} today`,
    add: 'Add to crate',
    manualTitleRequired: 'Add a title — give this record a name first.',
    fabMenu: { label: 'Add options', scan: 'Scan barcode', searchTitle: 'Search by title', manual: 'Enter manually', scanCover: 'Scan cover' },
    // Cover OCR (§ cover-scan-ocr): photograph a sleeve with no readable
    // barcode and read the artist/title off it on-device.
    coverScan: {
      title: 'Scan a cover',
      help: 'Frame the front of the cover so the artist and title are readable.',
      capture: 'Capture',
      choosePhoto: 'Choose a photo',
      retake: 'Retake',
      identifying: 'Reading the cover…',
      noText: "Couldn't read the cover — try a clearer photo or enter the details manually.",
      searching: 'Looking it up…',
      timedOut: 'Reading the cover took too long — try again or pick a different photo.',
      error: 'Something went wrong with the camera or photo.',
      close: 'Cancel cover scan',
    },
    filterSheet: {
      artist: 'Artist',
      noArtists: 'No matching artists',
      clearArtist: 'Clear artist filter',
    },
    // The Floor (§ Phase 1): sectioned home — New arrivals / On loan / Pinned
    // shelves, then "Browse all". `dive` opens a random item.
    floor: {
      newArrivals: { title: 'New arrivals', kicker: 'Fresh in' },
      onLoan: { title: 'On loan', kicker: 'Out in the world' },
      pinned: { title: 'Pinned', kicker: 'Your picks' },
      browseAll: { title: 'Browse all', kicker: 'Everything' },
      dive: 'Crate dive',
      diveAria: 'Open a random record from your crate',
      pin: 'Pin to top',
      unpin: 'Unpin',
      pinnedToast: 'Pinned to your picks',
      unpinnedToast: 'Removed from your picks',
    },
    // Wishlist (§ Fix): a list of UNOWNED wants (e.g. scanned in a shop).
    // Not part of the owned crate until the user converts it.
    wishlist: {
      button: 'Wishlist',
      title: 'Your wishlist',
      empty: 'Your wishlist is empty — scan something in a shop and add it here.',
      // D-7 (#171): free-only note in the wishlist empty state — wants are
      // unlimited and never count toward the 10-item cap.
      freeNote: "Wants are unlimited and don't use a spot on your plan.",
      addToCrate: 'Add to crate',
      addToCrateToast: 'Added to your crate',
      remove: 'Remove from wishlist',
      removeConfirm: 'Remove from wishlist?',
      removeToast: 'Removed from your wishlist',
      ownIt: 'Own it',
      addedToast: 'Added to your wishlist',
      addToWishlist: 'Add to wishlist',
      resultWishlisted: { label: 'In your wishlist', sub: 'Add it to your crate when you own it.' },
      // Whole-card rows: tapping a wishlist row opens the full Detail sheet.
      openDetailAria: 'Open details for {title}',
    },
    browse: {
      label: 'Browse',
      title: 'Browse your crate',
      clear: 'Clear browse',
      empty: 'Nothing to show here yet.',
    },
    // Paywall (ADR-0003 S6): self-serve upgrade copy for the shared paywall
    // bottom sheet. Crate wording via `{collectionLabel}`; the generic
    // billing/legal copy lives in i18n (`paywall.*`) as the fallback. The
    // modal reads these with optional chaining and falls back to t().
    paywall: {
      title: t('paywall.title', { collectionLabel: 'crate' }),
      body: t('paywall.body', { collectionLabel: 'crate', cap: '10' }),
      cta: t('paywall.cta'),
      secondary: t('paywall.secondary'),
      priceLine: t('paywall.priceLine'),
      creating: t('paywall.creating'),
      checkoutError: t('paywall.checkoutError'),
      offline: t('paywall.offline'),
      stillPending: t('paywall.stillPending'),
      successToast: t('paywall.successToast', { collectionLabel: 'crate' }),
      plan: 'lifetime',
      reason: {
        cap: {
          title: t('paywall.reason.cap.title', { collectionLabel: 'crate' }),
          body: t('paywall.reason.cap.body', { collectionLabel: 'crate', cap: '10' }),
        },
        feature: {
          title: t('paywall.reason.feature.title'),
          body: t('paywall.reason.feature.body'),
        },
        upgrade: {
          title: t('paywall.reason.upgrade.title'),
          body: t('paywall.reason.upgrade.body'),
        },
        expired: {
          title: t('paywall.reason.expired.title'),
          body: t('paywall.reason.expired.body'),
        },
      },
    },
    // Free-tier guidance (free-tier-guidance.md §4 D-2, #143/#144): the plan
    // banner's counter + hints read i18n `plan.*` directly (t()) — the only
    // catalog override here is `nearLimitHint`, a FUNCTION so pluralization is
    // safe (mirrors the `addedCount` override above; i18n
    // `plan.nearLimitHint` is the non-EN fallback).
    // [VALIDATE — owner sign-off on #139] The onboard-note wording ("no card,
    // no expiry"), the public plan name ("Premium") and the near-limit
    // thresholds (8/9 of 10) are pending owner confirmation on ticket #139.
    // Adjust the strings in src/i18n/locales/en.js and FREE_PLAN_NEAR_LIMIT in
    // src/CollectionView.jsx when the owner decides.
    plan: {
      nearLimitHint: (remaining) =>
        remaining === 1 ? '1 spot left' : `${remaining} spots left`,
    },
    search: {
      results: (n, q) => `${n} ${n === 1 ? 'match' : 'matches'} for “${q}”`,
      clear: 'Clear search results',
      recentTitle: 'Recent searches',
      clearRecent: 'Clear recent',
      didYouMeanPrefix: 'Did you mean',
      done: 'Done',
    },
    stats: {
      button: 'Stats',
      title: 'Your crate, by the numbers',
      total: (n) => `${n} ${n === 1 ? 'item' : 'items'}`,
      byGenre: 'By genre',
      byDecade: 'By decade',
      empty: 'Nothing to count yet — add some items first.',
    },
    // Gamification (Phase 1 § Play): release 1.1 Collection Persona + share
    // card. Copy bridges t() (EN master in the i18n locales; other locales
    // inherit via fallback until the native-speaker pass lands — copy-bank §11).
    gamif: {
      nav: t('gamif.nav'),
      hint: t('gamif.hint', { collectionLabel: 'crate' }),
      persona: {
        title: t('gamif.persona.title'),
        headline: t('gamif.persona.headline', { collectionLabel: 'crate' }),
        emptyTitle: t('gamif.persona.emptyTitle', { entity: 'record' }),
        emptySub: t('gamif.persona.emptySub', { entity: 'record' }),
        loading: t('gamif.persona.loading', { collectionLabel: 'crate' }),
        share: t('gamif.persona.share'),
        shared: t('gamif.persona.shared'),
        hashtag: t('gamif.persona.hashtag'),
        tagline: t('gamif.persona.tagline'),
        stats: {
          count: t('gamif.persona.stat.count'),
          genres: t('gamif.persona.stat.genres'),
          artists: t('gamif.persona.stat.artists'),
          topDecade: t('gamif.persona.stat.topDecade'),
          topDecadePct: t('gamif.persona.stat.topDecadePct'),
          decades: t('gamif.persona.stat.decades'),
          labels: t('gamif.persona.stat.labels'),
          countries: t('gamif.persona.stat.countries'),
          artistAlbums: t('gamif.persona.stat.artistAlbums'),
          pressingsOfOne: t('gamif.persona.stat.pressingsOfOne'),
          albumsTwice: t('gamif.persona.stat.albumsTwice'),
          notesCount: t('gamif.persona.stat.notesCount'),
          oneDayBurst: t('gamif.persona.stat.oneDayBurst'),
          busiestMonth: t('gamif.persona.stat.busiestMonth'),
          jazzPct: t('gamif.persona.stat.jazzPct'),
        },
        archetypes: {
          'crate-digger': { name: t('gamif.persona.crateDigger'), verdict: t('gamif.persona.verdict.crateDigger') },
          'time-traveler': { name: t('gamif.persona.timeTraveler'), verdict: t('gamif.persona.verdict.timeTraveler') },
          'genre-tourist': { name: t('gamif.persona.genreTourist'), verdict: t('gamif.persona.verdict.genreTourist') },
          completist: { name: t('gamif.persona.completist'), verdict: t('gamif.persona.verdict.completist') },
          'impulse-buyer': { name: t('gamif.persona.impulseBuyer'), verdict: t('gamif.persona.verdict.impulseBuyer') },
          'one-timer': { name: t('gamif.persona.oneTimer'), verdict: t('gamif.persona.verdict.oneTimer') },
          'variant-collector': { name: t('gamif.persona.variantCollector'), verdict: t('gamif.persona.verdict.variantCollector') },
          'sophisticate': { name: t('gamif.persona.sophisticate'), verdict: t('gamif.persona.verdict.sophisticate') },
          fallback: { name: t('gamif.persona.fallback'), verdict: t('gamif.persona.verdict.fallback') },
        },
      },
      // Play surface tabs (release 1.2 / 1.3 / 1.4)
      tabs: {
        persona: t('gamif.tab.persona'),
        progression: t('gamif.tab.progression'),
        quiz: t('gamif.tab.quiz'),
        stories: t('gamif.tab.stories'),
      },
      // Release 1.2 — XP / levels / badges panel copy (issue #45)
      progression: {
        title: t('gamif.progression.title'),
        level: t('gamif.progression.level'),
        xp: t('gamif.progression.xp'),
        toNext: t('gamif.progression.toNext'),
        maxLevel: t('gamif.progression.maxLevel'),
        badgesTitle: t('gamif.progression.badgesTitle'),
        badgeLocked: t('gamif.progression.badgeLocked'),
        badgeComingSoon: t('gamif.progression.badgeComingSoon'),
        unlockToast: t('gamif.progression.unlockToast'),
        levelToast: t('gamif.progression.levelToast'),
        emptyTitle: t('gamif.progression.emptyTitle', { entity: 'record' }),
        emptySub: t('gamif.progression.emptySub', { entity: 'record' }),
        share: t('gamif.progression.share'),
        shared: t('gamif.progression.shared'),
        shareHeadline: t('gamif.progression.shareHeadline'),
        shareTagline: t('gamif.progression.shareTagline'),
        statXp: (n) => t('gamif.progression.statXp', { n: String(n) }),
        statItems: (n) => `${Number(n || 0)} ${Number(n) === 1 ? 'record' : 'records'}`,
        xpLabel: t('gamif.progression.xpLabel'),
        toastClose: t('gamif.progression.toastClose'),
        levels: [
          { title: t('gamif.level.records.1'), toast: t('gamif.levelToast.recordsTail') },
          { title: t('gamif.level.records.2'), toast: t('gamif.levelToast.recordsTail') },
          { title: t('gamif.level.records.3'), toast: t('gamif.levelToast.recordsTail') },
          { title: t('gamif.level.records.4'), toast: t('gamif.levelToast.recordsTail') },
          { title: t('gamif.level.records.5'), toast: t('gamif.levelToast.recordsTail') },
        ],
      },
      // Release 1.2 — badge names + unlock lines (copy-bank.md §5)
      badges: {
        digger: { name: t('gamif.badge.digger.name'), line: t('gamif.badge.digger.line') },
        pageturner: { name: t('gamif.badge.pageturner.name'), line: t('gamif.badge.pageturner.line') },
        'genre-tourist': { name: t('gamif.badge.genre-tourist.name'), line: t('gamif.badge.genre-tourist.line') },
        'time-traveler': { name: t('gamif.badge.time-traveler.name'), line: t('gamif.badge.time-traveler.line') },
        completist: { name: t('gamif.badge.completist.name'), line: t('gamif.badge.completist.line') },
        'impulse-buyer': { name: t('gamif.badge.impulse-buyer.name'), line: t('gamif.badge.impulse-buyer.line') },
        'sleeve-sleuth': { name: t('gamif.badge.sleeve-sleuth.name'), line: t('gamif.badge.sleeve-sleuth.line') },
        'balanced-diet': { name: t('gamif.badge.balanced-diet.name'), line: t('gamif.badge.balanced-diet.line') },
        'one-timer': { name: t('gamif.badge.one-timer.name'), line: t('gamif.badge.one-timer.line') },
        'variant-hoarder': { name: t('gamif.badge.variant-hoarder.name'), line: t('gamif.badge.variant-hoarder.line') },
        'friend-of-crate': { name: t('gamif.badge.friend-of-crate.name'), line: t('gamif.badge.friend-of-crate.line') },
        'quiz-whiz': { name: t('gamif.badge.quiz-whiz.name'), line: t('gamif.badge.quiz-whiz.line') },
      },
      // Release 1.3 — Crate Quiz + streaks (issue #50). Copy bridges t()
      // (EN master in the i18n locales); the engine stays pure — prompts and
      // yes/no labels feed buildQuiz so its payloads are localized.
      quiz: {
        title: t('gamif.quiz.title'),
        intro: t('gamif.quiz.intro', { collectionLabel: 'crate' }),
        start: t('gamif.quiz.start'),
        lockedTitle: t('gamif.quiz.lockedTitle'),
        lockedSub: t('gamif.quiz.lockedSub', { entity: 'record', collectionLabel: 'crate' }),
        questionCount: t('gamif.quiz.questionCount'),
        next: t('gamif.quiz.next'),
        done: t('gamif.quiz.done'),
        score: t('gamif.quiz.score'),
        perfect: t('gamif.quiz.perfect'),
        streak: t('gamif.quiz.streak', { collectionLabel: 'crate' }),
        alreadyPlayed: t('gamif.quiz.alreadyPlayed'),
        revealAdded: t('gamif.quiz.revealAdded'),
        notesSay: t('gamif.quiz.notesSay'),
        correctOrder: t('gamif.quiz.correctOrder'),
        tapOrder: t('gamif.quiz.tapOrder'),
        teaserStreak: t('gamif.quiz.teaserStreak'),
        yes: t('gamif.quiz.yes'),
        no: t('gamif.quiz.no'),
        correct: [
          t('gamif.quiz.correct.1', { collectionLabel: 'crate' }),
          t('gamif.quiz.correct.2'),
          t('gamif.quiz.correct.3'),
        ],
        wrongReveal: t('gamif.quiz.wrongReveal'),
        wrongRevealNoNotes: t('gamif.quiz.wrongRevealNoNotes'),
        wrongRevealNotesOnly: t('gamif.quiz.wrongRevealNotesOnly'),
        wrongRevealNoDate: t('gamif.quiz.wrongRevealNoDate'),
        wrongYearReveal: t('gamif.quiz.wrongYearReveal'),
        wrongYearRevealNoNotes: t('gamif.quiz.wrongYearRevealNoNotes'),
        wrongYearRevealNotesOnly: t('gamif.quiz.wrongYearRevealNotesOnly'),
        wrongYearRevealNoDate: t('gamif.quiz.wrongYearRevealNoDate'),
        optionCorrect: t('gamif.quiz.optionCorrect'),
        optionWrong: t('gamif.quiz.optionWrong'),
        questions: {
          guessYear: t('gamif.quiz.prompt.guessYear'),
          nameThatArtist: t('gamif.quiz.prompt.nameArtist'),
          newestOldest: t('gamif.quiz.prompt.newestOldest'),
          stillYours: t('gamif.quiz.prompt.stillYours'),
          sortShelf: t('gamif.quiz.prompt.sortShelf'),
        },
      },
      // Release 1.4 — Shelf Stories panel copy (issue #44)
      stories: {
        headline: t('gamif.stories.headline', { collectionLabel: 'crate' }),
        emptyTitle: t('gamif.stories.emptyTitle'),
        emptySub: t('gamif.stories.emptySub', { entity: 'record' }),
        quest: t('gamif.stories.quest'),
        questSoon: t('gamif.stories.questSoon'),
        prev: t('gamif.stories.prev'),
        next: t('gamif.stories.next'),
        counter: t('gamif.stories.counter'),
        goToStory: t('gamif.stories.goToStory'),
        cards: {
          'year-span': { title: t('gamif.story.year-span.title'), body: t('gamif.story.year-span.body') },
          'decade-bias': { title: t('gamif.story.decade-bias.title'), body: t('gamif.story.decade-bias.body') },
          'era-lesson': { title: t('gamif.story.era-lesson.title'), body: t('gamif.story.era-lesson.body') },
          'country-mix': { title: t('gamif.story.country-mix.title'), body: t('gamif.story.country-mix.body') },
          series: { title: t('gamif.story.series.title'), body: t('gamif.story.series.body') },
          'one-timer': { title: t('gamif.story.one-timer.title'), body: t('gamif.story.one-timer.body') },
          'notes-coverage': { title: t('gamif.story.notes-coverage.title'), body: t('gamif.story.notes-coverage.body') },
          'total-pages': { title: t('gamif.story.total-pages.title'), body: t('gamif.story.total-pages.body') },
        },
      },
    },
    views: {
      title: 'Saved views',
      savePlaceholder: 'Name this view…',
      save: 'Save view',
      rename: 'Rename',
      delete: 'Delete view',
      empty: 'No saved views yet.',
      summary: (n) => `${n} ${n === 1 ? 'filter' : 'filters'}`,
    },
    lending: {
      section: t('lending.section'),
      statusOut: (name, date) => t('lending.statusOut', { name, date }),
      due: (date) => t('lending.due', { date }),
      overdue: t('lending.overdue'),
      overdueSince: (date) => t('lending.overdueSince', { date }),
      notOnLoan: t('lending.notOnLoan'),
      lend: t('lending.lend'),
      lendTitle: (entity) => t('lending.lendTitle', { entity }),
      borrower: t('lending.borrower'),
      borrowerPlaceholder: t('lending.borrowerPlaceholder'),
      contact: t('lending.contact'),
      dueDate: t('lending.dueDate'),
      confirmLend: t('lending.confirmLend'),
      nameRequired: t('lending.nameRequired'),
      return: t('lending.return'),
      returnConfirm: t('lending.returnConfirm'),
      lentToast: (name) => t('lending.lentToast', { name }),
      returnedToast: t('lending.returnedToast'),
      badge: t('lending.badge'),
      badgeOverdue: t('lending.badgeOverdue'),
      // A5.6 (#117): aria-labels for the on-loan card icon (deep-links to the
      // lend card). badge/badgeOverdue above stay as tooltip/fallback text.
      manageLoan: (name) => t('lending.manageLoan', { name }),
      manageLoanOverdue: (name) => t('lending.manageLoanOverdue', { name }),
      filter: t('lending.filter'),
      filterHint: t('lending.filterHint'),
      history: t('lending.history'),
      historyLent: (date) => t('lending.historyLent', { date }),
      historyReturned: (date) => t('lending.historyReturned', { date }),
      // A5 lending polish (#90/#92): Remind + contact actions + due presets.
      remind: t('lending.remind'),
      remindMessage: (name, title, dueText) =>
        t('lending.remindMessage.base', { name, title }) + (dueText ? t('lending.remindMessage.due', { date: dueText }) : ''),
      remindCopied: (name) => t('lending.remindCopied', { name }),
      due1w: t('lending.due1w'),
      due2w: t('lending.due2w'),
      due1m: t('lending.due1m'),
      overdueCount: (n) => t('lending.overdueCount', { n }),
      historyCapNote: t('lending.historyCapNote'),
      contactCall: t('lending.contactCall'),
      contactEmail: t('lending.contactEmail'),
      contactMessage: t('lending.contactMessage'),
    },
    view: {
      showing: (n, m) => `Showing ${Number(n || 0).toLocaleString()} of ${Number(m || 0).toLocaleString()}`,
      backToTop: 'Back to top',
    },
    // Community reviews (Task 6) — shared ReviewsSection copy. Full strings
    // live in i18n (`reviews.*`); this bridge lets a catalog override the
    // section title and composer labels, and `{entity}` interpolates at the
    // call site for kind-appropriate empty-state wording.
    reviews: {
      section: t('reviews.section'),
      save: t('reviews.save'),
      update: t('reviews.update'),
      postedToast: t('reviews.postedToast'),
      updatedToast: t('reviews.updatedToast'),
      posting: t('reviews.posting'),
      saving: t('reviews.saving'),
    },
  },
}

export const booksCatalog = {
  kind: 'books',
  entity: 'book',
  collectionLabel: 'shelf', // used in t() interpolation
  searchPlaceholder: 'Search your shelf…',
  storage: 'books',
  api: books,
  getDetail: books.getBookDetail,
  lookupName: 'Google Books',
  formats: [], // books are looked up by ISBN — no format chips
  genreLabel: 'Category',
  artistLabel: 'author',
  artistPlaceholder: 'All authors',
  sortOptions: [
    { value: 'added', label: 'Recently added' },
    { value: 'artist', label: 'Author A–Z' },
    { value: 'title', label: 'Title A–Z' },
    { value: 'year', label: 'Year' },
  ],
  // The Aisles (§ Phase 2): browse axes for the aisle picker. Books have no
  // series field in the item shape, so the axes cover the data we actually have.
  browseAxes: [
    { id: 'category', label: 'Category', value: (item) => (item.genre || []).map((g) => String(g).trim()).filter(Boolean) },
    { id: 'author', label: 'Author', value: (item) => [splitArtistTitle(item.title).artist].filter(Boolean) },
    { id: 'year', label: 'Year', value: (item) => (item.year ? [String(item.year)] : []) },
  ],
  components: {
    Card: BookCard,
    Grid: BookGrid,
    Detail: BookDetail,
    ManualAdd: BookManualAddModal,
  },
  detailLink: (item) => item.infoLink || `https://books.google.com/books?id=${item.googleBooksId}`,
  detailLinkLabel: 'View on Google Books ↗',
  // Community reviews (Task 6): the provider id that anchors a review thread.
  reviewKey: (item) => item.googleBooksId,
  // Room theme (epic #95, T2 #110): same shape as records, but the accent is
  // the NEUTRAL PLACEHOLDER --kind-books-accent until T3 (#104) picks the
  // Phase 0 color. The wiring must work; a books color must NOT be invented.
  theme: {
    accent: 'var(--kind-books-accent)',
    accentText: 'var(--color-bg)',
    ambient: 'var(--color-surface-1)',
  },
  copy: {
    emptyIcon: 'empty-book',
    // Kind-specific overrides for the shared collection flow.
    emptyTitle: 'Your shelf is empty',
    lending: {
      section: t('lending.section'),
      statusOut: (name, date) => t('lending.statusOut', { name, date }),
      due: (date) => t('lending.due', { date }),
      overdue: t('lending.overdue'),
      overdueSince: (date) => t('lending.overdueSince', { date }),
      notOnLoan: t('lending.notOnLoan'),
      lend: t('lending.lend'),
      lendTitle: (entity) => t('lending.lendTitle', { entity }),
      borrower: t('lending.borrower'),
      borrowerPlaceholder: t('lending.borrowerPlaceholder'),
      contact: t('lending.contact'),
      dueDate: t('lending.dueDate'),
      confirmLend: t('lending.confirmLend'),
      nameRequired: t('lending.nameRequired'),
      return: t('lending.return'),
      returnConfirm: t('lending.returnConfirm'),
      lentToast: (name) => t('lending.lentToast', { name }),
      returnedToast: t('lending.returnedToast'),
      badge: t('lending.badge'),
      badgeOverdue: t('lending.badgeOverdue'),
      // A5.6 (#117): aria-labels for the on-loan card icon (deep-links to the
      // lend card). badge/badgeOverdue above stay as tooltip/fallback text.
      manageLoan: (name) => t('lending.manageLoan', { name }),
      manageLoanOverdue: (name) => t('lending.manageLoanOverdue', { name }),
      filter: t('lending.filter'),
      filterHint: t('lending.filterHint'),
      history: t('lending.history'),
      historyLent: (date) => t('lending.historyLent', { date }),
      historyReturned: (date) => t('lending.historyReturned', { date }),
      // A5 lending polish (#90/#92): Remind + contact actions + due presets.
      remind: t('lending.remind'),
      remindMessage: (name, title, dueText) =>
        t('lending.remindMessage.base', { name, title }) + (dueText ? t('lending.remindMessage.due', { date: dueText }) : ''),
      remindCopied: (name) => t('lending.remindCopied', { name }),
      due1w: t('lending.due1w'),
      due2w: t('lending.due2w'),
      due1m: t('lending.due1m'),
      overdueCount: (n) => t('lending.overdueCount', { n }),
      historyCapNote: t('lending.historyCapNote'),
      contactCall: t('lending.contactCall'),
      contactEmail: t('lending.contactEmail'),
      contactMessage: t('lending.contactMessage'),
    },
    emptySub: 'Scan the ISBN on a book to catalog your first title.',
    emptyTagline: 'your shelf, cataloged',
    emptyBtn: 'Scan a book',
    // C2 onboarding (issue #88): same three steps as records; step 3 keeps the
    // generic "collection" noun (not "shelf") to match the localized arrays.
    emptySteps: ['Scan the barcode', 'Confirm the match', "Done — it's in your collection"],
    // C2.4 (issue #88): mirror of the records hint — CollectionView only
    // renders it for the Records catalog, but both catalogs expose the same
    // copy shape.
    noTokenHint: 'Records lookups need a Discogs token — add yours in Settings.',
    // C2.3 (issue #85): same "Try a sample" affordance as records — the sample
    // is read-only and must never reach the shelf/backend.
    trySample: 'Try a sample',
    trySampleNote: 'This is a sample — add your own item to start your collection.',
    // C2.3 (issue #85): the on-brand pill + safe primary on a sample's result
    // sheet. EN-primary for now; other locales fall back via i18n.
    trySampleBadge: 'Sample',
    trySampleCta: "That's the idea",
    loading: 'Loading your shelf…',
    addToast: 'Added to your shelf',
    removeLabel: 'Remove from shelf',
    lookingUp: 'Looking it up on Google Books…',
    noMatch: 'No matches found on Google Books.',
    resultGood: { label: 'Not on your shelf yet', sub: "You don't have this one." },
    resultOwned: { label: 'Already on your shelf', sub: 'This exact book is already yours.' },
    resultSame: { label: 'You already own this book', sub: 'Different edition — check before buying.' },
    sameHeading: 'Other editions you own',
    moreBy: (name, n) => `More by ${name} on your shelf (${n})`,
    nothingElseBy: (name) => `Nothing else by ${name} on your shelf`,
    moreRelated: (n) => `and ${n} more`,
    scanNext: 'Scan next',
    // C1.1: scan-sourced results offer "Add & scan next" as the primary; the
    // plain "Add" demotes to a ghost slot so the scanning burst continues.
    addAndScanNext: 'Add & scan next',
    // C1.4: momentum toast — a factual per-session "added today" count (no
    // XP/badges). Function override; i18n `catalog.addedCount` is the fallback.
    addedCount: (n) => `Added — ${n} today`,
    add: 'Add to shelf',
    manualTitleRequired: 'Add a title — give this book a name first.',
    fabMenu: { label: 'Add options', scan: 'Scan barcode', searchTitle: 'Search by title', manual: 'Enter manually', scanCover: 'Scan cover' },
    // Cover OCR (§ cover-scan-ocr): photograph a jacket with no readable ISBN
    // and read the title/author off it on-device.
    coverScan: {
      title: 'Scan a cover',
      help: 'Frame the front of the cover so the title and author are readable.',
      capture: 'Capture',
      choosePhoto: 'Choose a photo',
      retake: 'Retake',
      identifying: 'Reading the cover…',
      noText: "Couldn't read the cover — try a clearer photo or enter the details manually.",
      searching: 'Looking it up…',
      timedOut: 'Reading the cover took too long — try again or pick a different photo.',
      error: 'Something went wrong with the camera or photo.',
      close: 'Cancel cover scan',
    },
    filterSheet: {
      artist: 'Author',
      noArtists: 'No matching authors',
      clearArtist: 'Clear author filter',
    },
    // The Floor (§ Phase 1): sectioned home — New arrivals / On loan / Pinned
    // shelves, then "Browse all". `dive` opens a random item.
    floor: {
      newArrivals: { title: 'New arrivals', kicker: 'Fresh in' },
      onLoan: { title: 'On loan', kicker: 'Out in the world' },
      pinned: { title: 'Pinned', kicker: 'Your picks' },
      browseAll: { title: 'Browse all', kicker: 'Everything' },
      dive: 'Shelf dive',
      diveAria: 'Open a random book from your shelf',
      pin: 'Pin to top',
      unpin: 'Unpin',
      pinnedToast: 'Pinned to your picks',
      unpinnedToast: 'Removed from your picks',
    },
    // Wishlist (§ Fix): a list of UNOWNED wants (e.g. scanned in a shop).
    // Not part of the owned shelf until the user converts it.
    wishlist: {
      button: 'Wishlist',
      title: 'Your wishlist',
      empty: 'Your wishlist is empty — scan something in a shop and add it here.',
      // D-7 (#171): free-only note in the wishlist empty state — wants are
      // unlimited and never count toward the 10-item cap.
      freeNote: "Wants are unlimited and don't use a spot on your plan.",
      addToCrate: 'Add to shelf',
      addToCrateToast: 'Added to your shelf',
      remove: 'Remove from wishlist',
      removeConfirm: 'Remove from wishlist?',
      removeToast: 'Removed from your wishlist',
      ownIt: 'Own it',
      addedToast: 'Added to your wishlist',
      addToWishlist: 'Add to wishlist',
      resultWishlisted: { label: 'On your wishlist', sub: 'Add it to your shelf when you own it.' },
      // Whole-card rows: tapping a wishlist row opens the full Detail sheet.
      openDetailAria: 'Open details for {title}',
    },
    browse: {
      label: 'Browse',
      title: 'Browse your shelf',
      clear: 'Clear browse',
      empty: 'Nothing to show here yet.',
    },
    // Paywall (ADR-0003 S6): self-serve upgrade copy for the shared paywall
    // bottom sheet. Shelf wording via `{collectionLabel}`; the generic
    // billing/legal copy lives in i18n (`paywall.*`) as the fallback. The
    // modal reads these with optional chaining and falls back to t().
    paywall: {
      title: t('paywall.title', { collectionLabel: 'shelf' }),
      body: t('paywall.body', { collectionLabel: 'shelf', cap: '10' }),
      cta: t('paywall.cta'),
      secondary: t('paywall.secondary'),
      priceLine: t('paywall.priceLine'),
      creating: t('paywall.creating'),
      checkoutError: t('paywall.checkoutError'),
      offline: t('paywall.offline'),
      stillPending: t('paywall.stillPending'),
      successToast: t('paywall.successToast', { collectionLabel: 'shelf' }),
      plan: 'lifetime',
      reason: {
        cap: {
          title: t('paywall.reason.cap.title', { collectionLabel: 'shelf' }),
          body: t('paywall.reason.cap.body', { collectionLabel: 'shelf', cap: '10' }),
        },
        feature: {
          title: t('paywall.reason.feature.title'),
          body: t('paywall.reason.feature.body'),
        },
        upgrade: {
          title: t('paywall.reason.upgrade.title'),
          body: t('paywall.reason.upgrade.body'),
        },
        expired: {
          title: t('paywall.reason.expired.title'),
          body: t('paywall.reason.expired.body'),
        },
      },
    },
    // Free-tier guidance (free-tier-guidance.md §4 D-2, #143/#144): same as
    // records — `nearLimitHint` is the pluralization-safe FUNCTION override
    // (i18n `plan.nearLimitHint` is the non-EN fallback).
    // [VALIDATE — owner sign-off on #139] The onboard-note wording ("no card,
    // no expiry"), the public plan name ("Premium") and the near-limit
    // thresholds (8/9 of 10) are pending owner confirmation on ticket #139.
    plan: {
      nearLimitHint: (remaining) =>
        remaining === 1 ? '1 spot left' : `${remaining} spots left`,
    },
    // Gamification (Phase 1 § Play): release 1.1 Collection Persona + share
    // card. Copy bridges t() (EN master in the i18n locales; other locales
    // inherit via fallback until the native-speaker pass lands — copy-bank §11).
    gamif: {
      nav: t('gamif.nav'),
      hint: t('gamif.hint', { collectionLabel: 'shelf' }),
      persona: {
        title: t('gamif.persona.title'),
        headline: t('gamif.persona.headline', { collectionLabel: 'shelf' }),
        emptyTitle: t('gamif.persona.emptyTitle', { entity: 'book' }),
        emptySub: t('gamif.persona.emptySub', { entity: 'book' }),
        loading: t('gamif.persona.loading', { collectionLabel: 'shelf' }),
        share: t('gamif.persona.share'),
        shared: t('gamif.persona.shared'),
        hashtag: t('gamif.persona.hashtag'),
        tagline: t('gamif.persona.tagline'),
        stats: {
          count: t('gamif.persona.stat.countBooks'),
          genres: t('gamif.persona.stat.genresBooks'),
          artists: t('gamif.persona.stat.artistsBooks'),
          pages: t('gamif.persona.stat.pages'),
          longestBook: t('gamif.persona.stat.longestBook'),
          publishers: t('gamif.persona.stat.publishers'),
          unfinishedSeries: t('gamif.persona.stat.unfinishedSeries'),
          topAuthorPct: t('gamif.persona.stat.topAuthorPct'),
        },
        archetypes: {
          'couch-intellectual': { name: t('gamif.persona.couchIntellectual'), verdict: t('gamif.persona.verdict.couchIntellectual') },
          'series-starter': { name: t('gamif.persona.seriesStarter'), verdict: t('gamif.persona.verdict.seriesStarter') },
          'genre-hedonist': { name: t('gamif.persona.genreHedonist'), verdict: t('gamif.persona.verdict.genreHedonist') },
          'page-counter': { name: t('gamif.persona.pageCounter'), verdict: t('gamif.persona.verdict.pageCounter') },
          'one-series-wonder': { name: t('gamif.persona.oneSeriesWonder'), verdict: t('gamif.persona.verdict.oneSeriesWonder') },
          'first-edition-idealist': { name: t('gamif.persona.firstEditionIdealist'), verdict: t('gamif.persona.verdict.firstEditionIdealist') },
          fallback: { name: t('gamif.persona.fallback'), verdict: t('gamif.persona.verdict.fallback') },
        },
      },
      // Play surface tabs (release 1.2 / 1.3 / 1.4)
      tabs: {
        persona: t('gamif.tab.persona'),
        progression: t('gamif.tab.progression'),
        quiz: t('gamif.tab.quiz'),
        stories: t('gamif.tab.stories'),
      },
      // Release 1.2 — XP / levels / badges panel copy (issue #45)
      progression: {
        title: t('gamif.progression.title'),
        level: t('gamif.progression.level'),
        xp: t('gamif.progression.xp'),
        toNext: t('gamif.progression.toNext'),
        maxLevel: t('gamif.progression.maxLevel'),
        badgesTitle: t('gamif.progression.badgesTitle'),
        badgeLocked: t('gamif.progression.badgeLocked'),
        badgeComingSoon: t('gamif.progression.badgeComingSoon'),
        unlockToast: t('gamif.progression.unlockToast'),
        levelToast: t('gamif.progression.levelToast'),
        emptyTitle: t('gamif.progression.emptyTitle', { entity: 'book' }),
        emptySub: t('gamif.progression.emptySub', { entity: 'book' }),
        share: t('gamif.progression.share'),
        shared: t('gamif.progression.shared'),
        shareHeadline: t('gamif.progression.shareHeadline'),
        shareTagline: t('gamif.progression.shareTagline'),
        statXp: (n) => t('gamif.progression.statXp', { n: String(n) }),
        statItems: (n) => `${Number(n || 0)} ${Number(n) === 1 ? 'book' : 'books'}`,
        xpLabel: t('gamif.progression.xpLabel'),
        toastClose: t('gamif.progression.toastClose'),
        levels: [
          { title: t('gamif.level.books.1'), toast: t('gamif.levelToast.booksTail') },
          { title: t('gamif.level.books.2'), toast: t('gamif.levelToast.booksTail') },
          { title: t('gamif.level.books.3'), toast: t('gamif.levelToast.booksTail') },
          { title: t('gamif.level.books.4'), toast: t('gamif.levelToast.booksTail') },
          { title: t('gamif.level.books.5'), toast: t('gamif.levelToast.booksTail') },
        ],
      },
      // Release 1.2 — badge names + unlock lines (copy-bank.md §5)
      badges: {
        digger: { name: t('gamif.badge.digger.name'), line: t('gamif.badge.digger.line') },
        pageturner: { name: t('gamif.badge.pageturner.name'), line: t('gamif.badge.pageturner.line') },
        'genre-tourist': { name: t('gamif.badge.genre-tourist.name'), line: t('gamif.badge.genre-tourist.line') },
        'time-traveler': { name: t('gamif.badge.time-traveler.name'), line: t('gamif.badge.time-traveler.line') },
        completist: { name: t('gamif.badge.completist.name'), line: t('gamif.badge.completist.line') },
        'impulse-buyer': { name: t('gamif.badge.impulse-buyer.name'), line: t('gamif.badge.impulse-buyer.line') },
        'sleeve-sleuth': { name: t('gamif.badge.sleeve-sleuth.name'), line: t('gamif.badge.sleeve-sleuth.line') },
        'balanced-diet': { name: t('gamif.badge.balanced-diet.name'), line: t('gamif.badge.balanced-diet.line') },
        'one-timer': { name: t('gamif.badge.one-timer.name'), line: t('gamif.badge.one-timer.line') },
        'variant-hoarder': { name: t('gamif.badge.variant-hoarder.name'), line: t('gamif.badge.variant-hoarder.line') },
        'friend-of-crate': { name: t('gamif.badge.friend-of-crate.name'), line: t('gamif.badge.friend-of-crate.line') },
        'quiz-whiz': { name: t('gamif.badge.quiz-whiz.name'), line: t('gamif.badge.quiz-whiz.line') },
      },
      // Release 1.3 — Crate Quiz + streaks (issue #50). See records catalog
      // for the copy layout; the books side swaps crate→shelf, record→book.
      quiz: {
        title: t('gamif.quiz.title'),
        intro: t('gamif.quiz.intro', { collectionLabel: 'shelf' }),
        start: t('gamif.quiz.start'),
        lockedTitle: t('gamif.quiz.lockedTitle'),
        lockedSub: t('gamif.quiz.lockedSub', { entity: 'book', collectionLabel: 'shelf' }),
        questionCount: t('gamif.quiz.questionCount'),
        next: t('gamif.quiz.next'),
        done: t('gamif.quiz.done'),
        score: t('gamif.quiz.score'),
        perfect: t('gamif.quiz.perfect'),
        streak: t('gamif.quiz.streak', { collectionLabel: 'shelf' }),
        alreadyPlayed: t('gamif.quiz.alreadyPlayed'),
        revealAdded: t('gamif.quiz.revealAdded'),
        notesSay: t('gamif.quiz.notesSay'),
        correctOrder: t('gamif.quiz.correctOrder'),
        tapOrder: t('gamif.quiz.tapOrder'),
        teaserStreak: t('gamif.quiz.teaserStreak'),
        yes: t('gamif.quiz.yes'),
        no: t('gamif.quiz.no'),
        correct: [
          t('gamif.quiz.correct.1', { collectionLabel: 'shelf' }),
          t('gamif.quiz.correct.2'),
          t('gamif.quiz.correct.3'),
        ],
        wrongReveal: t('gamif.quiz.wrongReveal'),
        wrongRevealNoNotes: t('gamif.quiz.wrongRevealNoNotes'),
        wrongRevealNotesOnly: t('gamif.quiz.wrongRevealNotesOnly'),
        wrongRevealNoDate: t('gamif.quiz.wrongRevealNoDate'),
        wrongYearReveal: t('gamif.quiz.wrongYearReveal'),
        wrongYearRevealNoNotes: t('gamif.quiz.wrongYearRevealNoNotes'),
        wrongYearRevealNotesOnly: t('gamif.quiz.wrongYearRevealNotesOnly'),
        wrongYearRevealNoDate: t('gamif.quiz.wrongYearRevealNoDate'),
        optionCorrect: t('gamif.quiz.optionCorrect'),
        optionWrong: t('gamif.quiz.optionWrong'),
        questions: {
          guessYear: t('gamif.quiz.prompt.guessYear'),
          nameThatArtist: t('gamif.quiz.prompt.nameArtist'),
          newestOldest: t('gamif.quiz.prompt.newestOldest'),
          stillYours: t('gamif.quiz.prompt.stillYours'),
          sortShelf: t('gamif.quiz.prompt.sortShelf'),
        },
      },
      // Release 1.4 — Shelf Stories panel copy (issue #44)
      stories: {
        headline: t('gamif.stories.headline', { collectionLabel: 'shelf' }),
        emptyTitle: t('gamif.stories.emptyTitle'),
        emptySub: t('gamif.stories.emptySub', { entity: 'book' }),
        quest: t('gamif.stories.quest'),
        questSoon: t('gamif.stories.questSoon'),
        prev: t('gamif.stories.prev'),
        next: t('gamif.stories.next'),
        counter: t('gamif.stories.counter'),
        goToStory: t('gamif.stories.goToStory'),
        cards: {
          'year-span': { title: t('gamif.story.year-span.title'), body: t('gamif.story.year-span.body') },
          'decade-bias': { title: t('gamif.story.decade-bias.title'), body: t('gamif.story.decade-bias.body') },
          'era-lesson': { title: t('gamif.story.era-lesson.title'), body: t('gamif.story.era-lesson.body') },
          'country-mix': { title: t('gamif.story.country-mix.title'), body: t('gamif.story.country-mix.body') },
          series: { title: t('gamif.story.series.title'), body: t('gamif.story.series.body') },
          'one-timer': { title: t('gamif.story.one-timer.title'), body: t('gamif.story.one-timer.body') },
          'notes-coverage': { title: t('gamif.story.notes-coverage.title'), body: t('gamif.story.notes-coverage.body') },
          'total-pages': { title: t('gamif.story.total-pages.title'), body: t('gamif.story.total-pages.body') },
        },
      },
    },
    search: {
      results: (n, q) => `${n} ${n === 1 ? 'match' : 'matches'} for “${q}”`,
      clear: 'Clear search results',
      recentTitle: 'Recent searches',
      clearRecent: 'Clear recent',
      didYouMeanPrefix: 'Did you mean',
      done: 'Done',
    },
    view: {
      showing: (n, m) => `Showing ${Number(n || 0).toLocaleString()} of ${Number(m || 0).toLocaleString()}`,
      backToTop: 'Back to top',
    },
    // Community reviews (Task 6) — shared ReviewsSection copy (see records
    // catalog for the layout; wording bridges i18n `reviews.*`).
    reviews: {
      section: t('reviews.section'),
      save: t('reviews.save'),
      update: t('reviews.update'),
      postedToast: t('reviews.postedToast'),
      updatedToast: t('reviews.updatedToast'),
      posting: t('reviews.posting'),
      saving: t('reviews.saving'),
    },
  },
}
