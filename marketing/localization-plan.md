# Localization Plan — Hokan in 8 languages (user-switchable)

**Owner:** Marketing Manager (copy) + Front End Developer (implementation)
**Status:** Ready to hand off · **Date:** 2026-08-12
**Languages:** EN (default) · FR · NL · PT-BR · DE · ES · IT
**Validated by:** the private-test circle now covers all six non-EN languages
(FR · NL · BR · DE · ES · IT) natively.
**Copy source of truth:** `marketing/localization-dictionary.md`

---

## 1. Goal

Support the 7 target languages in-app. Each user **chooses their language**
(preference saved per user) and can **switch anytime** from Settings. Defaults
to the browser language, falling back to EN.

## 2. Language set

| Code | Name (endonym — shown in the switcher) | Tested by |
| --- | --- | --- |
| `en` | English | baseline (product language) |
| `fr` | Français | FR testers |
| `nl` | Nederlands | NL testers |
| `pt-BR` | Português (Brasil) | BR testers |
| `de` | Deutsch | DE testers |
| `es` | Español | ES testers (added) |
| `it` | Italiano | IT testers (added) |

## 3. Architecture (grounded in this codebase)

- **New `src/i18n/` module:**
  - `locales/{en,fr,nl,pt-BR,de,es,it}.js` — dictionaries keyed by message key
    (content from `localization-dictionary.md`).
  - `index.js` — `t(key, params)` with ICU-lite interpolation (`{name}`, `{n}`)
    and pluralization via `Intl.PluralRules`; plus a `LocaleContext` +
    `useLocale()` hook and a `<LocaleProvider>` mounted in `main.jsx`.
- **Per-user preference** — store exactly like the Discogs token:
  `localStorage.runout.locale.<userId>` (see `src/api/discogs.js` for the
  pattern; add a small helper in `src/utils/session.js`). Resolution order:
  saved preference → `navigator.language` mapped to nearest supported → `en`.
- **Switcher** — a language `<select>` in `SettingsModal.jsx` (endonyms);
  changing it persists and re-renders immediately.
- **Catalog `.copy` refactor** — the copy today lives in `recordsCatalog.copy` /
  `booksCatalog.copy` as strings + functions. Move the strings into the
  dictionaries and make `.copy` a thin mapping to keys, parameterizing
  kind differences (`{collectionLabel}` = crate/shelf, `{lookupName}` =
  Discogs/Google Books). This removes the per-kind duplication.
- **Hardcoded literals** — replace with `t()` across the ~18 files in the
  inventory (`AuthScreen`, `AdminPanel`, `SettingsModal`, `ScannerModal`,
  both `ManualAddModal`s, `FilterSheet`, `SortMenu`, `ListView`, `EmptyState`,
  `MatchPicker`, `ScanResult`, `AlbumDetail`, `BookDetail`, `Toolbar`,
  `CollectionView`) and the API error tables.
- **Fallback safety** — keep the `copy.x || t('x')` pattern so a missing key
  never crashes (dark-screen safety; no error boundary).

## 4. Non-string locale fixes (behavior — easy to miss)

| Area | Today | Change |
| --- | --- | --- |
| `ListView` `letterOf` | buckets non-`[A-Z]` under `#` | use `Intl.Collator`/`localeCompare` so É, Á, Ö, Ü, Ç bucket correctly |
| Sorting (CollectionView/Toolbar) | `.toLowerCase()` compare | `.localeCompare(…, locale)` for accent-insensitive order |
| `fmtDate` (AdminPanel), `Number(count).toLocaleString()` (Toolbar) | default locale | pass the active locale |
| `index.html` `<html lang="en">` | static | set from the active locale |
| PWA manifest + meta description | EN | **keep EN for the private test**; localize in a later pass `[VALIDATE]` |
| RTL | n/a | all 7 languages are LTR — no RTL work |

## 5. Scope / string inventory

Full inventory captured (catalog `.copy` + hardcoded strings across ~18 files +
API error tables + `index.html`). The dictionary in
`localization-dictionary.md` is the **v1 contract** — Marketing owns it; native
testers validate it; the Front End Developer wires it to `t()` keys.

## 6. Rollout & handoff

- **Branch:** `feat/localization`, off `main`, after `chore/rename-alcove`
  merges (both touch the same string lines — avoid the merge conflict).
- **Order:**
  1. i18n scaffold + EN (baseline — existing tests must stay green).
  2. Wire catalog `.copy` → `t()`.
  3. Replace hardcoded literals.
  4. Switcher + per-user storage.
  5. Non-string locale fixes (§4).
  6. Add tests (§7).
  7. Import FR/NL/PT-BR/DE/ES/IT dictionaries.
  8. Native validation via the private circle.
- **Tests:** default EN keeps the suite green; add a test that switching locale
  changes a key string; unit-test `t()` interpolation/pluralization and
  `letterOf` with accented letters.

## 7. Handoff note (to the Front End Developer)

- `localization-dictionary.md` = keys + 7-language content (v1, `[VALIDATE]`).
- Do **not** localize the `Alcove` wordmark, `RU-…` code format, `ISBN`,
  `Discogs`/`Google Books` proper nouns, or record/book **example placeholders**
  (e.g. "Kind of Blue") unless the testers ask.
- Keep the private-test feedback form Q8 updated: testers now check their own
  language, not just request it.

## 8. Open items `[VALIDATE]`

- Native confirmation of all dictionary entries (6 non-EN languages; EN = shipped baseline).
- ICU pluralization for `{n} active`, `Pending requests ({n})`, `Members ({n})`.
- Whether to localize PWA manifest + meta now or later (recommend later).
- Confirm `pt-BR` (Brazilian) vs `pt-PT` — circle is Brazil, so `pt-BR`.
