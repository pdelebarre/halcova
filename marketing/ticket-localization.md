# Ticket — `feat/localization`: 7-language i18n, per-user preference + switcher

**For:** Front End Developer (implement) · **Owner:** Marketing Manager
**Branch:** `feat/localization` (off `main`, **after** `chore/rename-alcove`
merges — both touch the same string lines) → PR. **Never `main`.**
**Plan:** `marketing/localization-plan.md` · **Copy:** `marketing/localization-dictionary.md`

> Languages: **EN** (default) + FR · NL · PT-BR · DE · ES · IT. Each user picks
> a language; can switch anytime in Settings; defaults to browser language with
> EN fallback. All dictionary content is Marketing-owned (`[VALIDATE]` native
> testers) — your job is the plumbing, not the wording.

---

## 1. Architecture to implement (per plan §3)

1. **`src/i18n/locales/{en,fr,nl,pt-BR,de,es,it}.js`** — dictionaries keyed by
   message key (content from `localization-dictionary.md`; EN = shipped baseline).
2. **`src/i18n/index.js`** — exports:
   - `t(key, params)` — ICU-lite interpolation (`{name}`, `{n}`) + pluralization
     via `Intl.PluralRules` (e.g. `filtersActive`). Reads the **current locale
     from a module-level singleton** so non-component code (API errors, catalog)
     can call it too; missing key → EN fallback (never throw — dark-screen
     safety, no error boundary).
   - `LocaleContext` + `useLocale()` hook + `<LocaleProvider>`.
3. **`src/main.jsx`** — mount `<LocaleProvider>`.
4. **Per-user storage** — helper in `src/utils/session.js`:
   `runout.locale.<userId>` (mirror the Discogs-token pattern in
   `src/api/discogs.js`). Resolution: saved → `navigator.language` mapped to
   nearest supported → `en`. Persist on change.
5. **Switcher** — language `<select>` in `src/components/SettingsModal.jsx`
   (endonyms from dict `languageName`); changing it saves + re-renders.
6. **`index.html`** — set `<html lang>` from the active locale (in app init);
   **keep `<title>`/meta EN for now** `[VALIDATE]`.
7. **Catalog `.copy` refactor** (§4) — single source of truth in dictionaries.

---

## 2. Hardcoded strings → `t()` (exact scope, by file)

Replace literals with the dictionary keys (all in `localization-dictionary.md`).

| File | Keys to use |
| --- | --- |
| `src/App.jsx` | `common.loading`, `kind.records`, `kind.books`, `common.signOut`, `auth.noCollections` ({name}) |
| `src/AuthScreen.jsx` | `auth.tagline`, `auth.haveCode`, `auth.requestAccess`, `auth.enterCode`, `auth.pasteTip`, `auth.signIn`/`auth.signingIn`, `auth.requestToStart`, `auth.yourName`, `auth.requesting`, `auth.requestSent`, `auth.requestSentBody`, `common.back` |
| `src/AdminPanel.jsx` | `common.close`, `common.loading`, `admin.pendingRequests` ({n}), `admin.noPending`, `admin.requestedOn` ({date}), `admin.approve`, `admin.reject`, `admin.grantAccess`, `admin.whichCollections`, `admin.generateCode`, `common.cancel`, `admin.accessCodeFor` ({name}), `admin.shareCodeHint`, `admin.copied` / `common.copy`, `common.done`, `admin.members` ({n}), `admin.noMembers`, `admin.disabled`, `kind.recordsAccess`/`kind.booksAccess`, `admin.hideCode`/`admin.showCode`, `admin.disable`/`admin.enable`, `admin.delete`, `admin.deleteConfirm`, `common.close` |
| `src/components/Header.jsx` | `header.collectionType`, `header.account`, `header.accountLabel` ({name}), `common.settings`, `common.adminPanel`, `common.signOut` |
| `src/components/SettingsModal.jsx` | `common.settings`, `common.close`, `settings.recordsHelp`, `settings.booksHelp`, **+ new**: `settings.language`, `settings.languageHint`, `languageName` options |
| `src/components/ScannerModal.jsx` | `scan.startingCamera`, `scan.aimAtBarcode`, `scan.cameraDenied`, `scan.cameraFail`, `scan.restartingCamera`, `scan.scanBarcode`, `scan.cancelScan`, `scan.torchOn`/`scan.torchOff`, `scan.retryCamera`, `common.retry`, `scan.enterManually` |
| `src/components/ManualAddModal.jsx` | `add.searchResults`, `add.lookingUpDiscogs`, `add.noMatchDiscogs`, `add.addRecordManually`, `add.addByHand`, `common.close`, `add.artist`, `add.titleRequired`, `add.format`, `add.year`, `add.label`, `add.catalogNumber`, `add.genre`, `add.backToSearch`, `add.addToCrate`, `add.findRecord`, `add.findAnotherWay`, `add.searchPlaceholderRecord`, `add.searchDiscogs`, `add.skipSearchAddByHand` |
| `src/components/BookManualAddModal.jsx` | same shape with book keys: `add.lookingUpGoogle`, `add.noMatchGoogle`, `add.addBookManually`, `add.author`, `add.publisher`, `add.category`, `add.addToShelf`, `add.findBook`, `add.searchPlaceholderBook`, `add.searchGoogleBooks` |
| `src/components/FilterSheet.jsx` | fallbacks → `common.close`, `toolbar.all`, `toolbar.noArtists`/`toolbar.noAuthors`, `toolbar.reset`, `common.done`, `toolbar.filter`, `toolbar.filterBy` ({artistLabel}) |
| `src/components/SortMenu.jsx` | `toolbar.sortBy` |
| `src/components/ListView.jsx` | `list.jumpToLetter`, `list.jumpTo` ({l}), `list.collectionList`, `list.collectionItem` fallback |
| `src/components/EmptyState.jsx` | `list.nothingMatches`, `list.tryDifferentSearch`, `clearFilters`, empty-state fallbacks |
| `src/components/MatchPicker.jsx` | `add.lookingUp` default (`common.loading`), `noMatch` default, `common.close`, `add.searchByTitle` (`add.searchByTitleInstead`), `add.addManually` |
| `src/components/ScanResult.jsx` | `detail.albumByArtist` ({album},{artist}) aria, `common.close`, `detail.viewInCollection` |
| `src/components/AlbumDetail.jsx` | `common.close`, meta labels (`add.format`, `add.year`, `add.label`, `add.catalogNumber`, `detail.country`, `add.genre`, `detail.barcode`), `detail.tracklist`, `common.loading`, `detail.tracklistError`, `detail.noTracklist`, `detail.notes`, `detail.notesPlaceholderRecord`, `detail.couldNotSaveNotes` |
| `src/components/BookDetail.jsx` | `common.close`, meta labels (`add.format`, `add.year`, `add.publisher`, `detail.pages`, `detail.isbn`, `detail.categories`), `detail.aboutThisBook`, `common.loading`, `detail.descriptionError`, `detail.notes`, `detail.notesPlaceholderBook`, `detail.couldNotSaveNotes` |
| `src/components/Toolbar.jsx` | `toolbar.recentlyAdded`, `toolbar.artistAZ`, `add.year`, `toolbar.searchCollection`, `toolbar.all`, `toolbar.filter`, `toolbar.filtersActive` ({n}, plural), `toolbar.clearSearch`, `toolbar.sortBy`, `toolbar.gridView`, `toolbar.listView` |
| `src/CollectionView.jsx` | `common.scan` (FAB label ×2), `view.isThisIt`, `scan.startingCamera` (Suspense fallback), `common.tryAgain`, `view.couldNotReach` ({error}), `view.couldNotSave`, `view.lookupsNotConfigured` ({lookupName}) |

---

## 3. API error strings — translate at render time (design note)

The API modules (`src/api/collection.js`, `auth.js`, `discogs.js`, `books.js`)
currently surface English messages and already carry **error codes**
(`NO_TOKEN`, `BAD_TOKEN`, `RATE_LIMIT`, `HTTP_ERROR`). Prefer:

- APIs keep throwing **codes** (not prose); components map code → `t('err.*')`
  at render (dictionary §12).
- The `Request failed ({status})` fallback becomes `t('err.requestFailed', {status})`.

> Because `t()` is a module singleton (not a hook), it's safe to call from
> non-component code if you prefer keeping message strings — but codes +
> render-time translation is cleaner and keeps the dictionary single-source.

---

## 4. Catalog `.copy` refactor (src/catalog.js)

- Dictionaries become the single source of truth; the `recordsCatalog.copy` /
  `booksCatalog.copy` blocks become **thin getters** that call `t()` with kind
  parameters so components barely change:
  - `{collectionLabel}` → `crate` (records) / `shelf` (books)
  - `{lookupName}` → `Discogs` / `Google Books`
- Keep the `.copy` shape and function signatures (e.g. `moreBy(name, n)`,
  `filtersActive(n)`, `view.showing(n, m)`) so `CollectionView` and friends
  don't need rewiring — they just receive translated values per render.
- Keep the `copy.x || t('fallbackKey')` pattern for dark-screen safety.

---

## 5. Non-string locale fixes (from plan §4)

| Area | Change |
| --- | --- |
| `ListView` `letterOf` | bucket by `Intl.Collator`/`localeCompare` — accented letters (É, Á, Ö, Ü, Ç) group correctly, not under `#` |
| Sorting (`CollectionView`, `Toolbar`) | `.localeCompare(…, locale)` for accent-insensitive order |
| `fmtDate` (AdminPanel), `Number(count).toLocaleString()` (Toolbar) | pass the active locale |
| `index.html` `<html lang>` | set from active locale |

---

## 6. KEEP — do not translate

- **`Alcove`** wordmark (proper noun), `RU-…` code format, `ISBN`, `Discogs`,
  `Google Books`.
- **Example placeholders** ("Miles Davis", "Kind of Blue", "1959",
  "Columbia", "you@example.com") — examples, not UI.
- **PWA manifest + meta description** stay EN for now `[VALIDATE]`.
- **Internal identifiers** from the rename keep-list (session/token keys, UA,
  `RUNOUT_ADMIN_KEY`, blob stores, `--runout-gold`) — untouched.
- Emoji glyphs (🔦/💡/✓/✕) — not translatable.

---

## 7. Tests to add

1. `src/i18n/i18n.test.js` — `t()` interpolation, pluralization
   (`filtersActive` 1 vs 5), **missing-key → EN fallback** (no throw).
2. Storage helper — `runout.locale.<userId>` read/write/reset; resolution
   order (saved → browser → en).
3. Locale switch — changing language in Settings changes a rendered string
   (default EN keeps the existing suite green).
4. `letterOf` with accented letters (É → under E, not `#`).

---

## 8. Verification

1. `npm run lint` · `npm test` · `npm run build`.
2. Default EN: existing tests green, no wording change.
3. Manual: switch to each locale in Settings; scan/add/detail flows render the
   locale (spot-check FR, PT-BR, DE).
4. Leftover scan for hardcoded English in `src/` (grep for the known literals
   from §2); remaining hits must only be KEEP items (§6).
5. **Vite stale-transform gotcha:** after editing `index.html`/`vite.config.js`,
   re-request the page or restart the dev server before debugging.

---

## 9. Definition of done

- [ ] `src/i18n/` module + 7 locale files wired; `LocaleProvider` mounted
- [ ] Per-user locale storage + browser-fallback resolution
- [ ] Settings language switcher works and persists
- [ ] Catalog `.copy` backed by dictionaries (crate/shelf + Discogs/Google params)
- [ ] All §2 files translated via `t()`; API errors via codes
- [ ] §5 non-string locale fixes in
- [ ] Tests from §7 pass; `npm run lint`/`test`/`build` green
- [ ] Dictionary `[VALIDATE]` note sent to testers (FR/NL/PT-BR/DE/ES/IT)
- [ ] On `feat/localization`, PR opened to `main`, not pushed directly
