# Ticket — `chore/rename-Halcova`: rebrand "Runout" → "Halcova"

**For:** Front End Developer (implement) · **Owner:** Marketing Manager
**Branch:** `chore/rename-Halcova` (off `main`) → PR to `main` — **never commit to `main`**
**Copy source:** `marketing/copy-kit-Halcova.md` (§2–§3)

> Decision, rationale, and open `[VALIDATE]` items live in
> `marketing/rename-Halcova.md`. Scope below is exact.

---

## 1. MUST change — public / user-visible surfaces

| # | File | Line | Current | Change to |
| --- | --- | --- | --- | --- |
| 1 | `src/components/Header.jsx` | 52 | `<span className="wordmark">Runout</span>` | `<span className="wordmark">Halcova</span>` |
| 2 | `src/AuthScreen.jsx` | 48, 66, 99, 138 | `<h1 className="auth-wordmark">Runout</h1>` (×4) | `Halcova` |
| 3 | `src/App.jsx` | 46 | `<h1 className="auth-wordmark">Runout</h1>` | `Halcova` |
| 4 | `src/__tests__/header-toolbar.test.jsx` | 29 | `screen.getByText('Runout')` | `screen.getByText('Halcova')` |
| 5 | `index.html` | 9 | `apple-mobile-web-app-title` = `Runout` | `Halcova` |
| 6 | `index.html` | 16 | `<title>Runout — Records &amp; Books</title>` | `<title>Halcova — Records &amp; Books</title>` |
| 7 | `index.html` | 10 | current `meta description` | use `copy-kit-Halcova.md` §3 short description |
| 8 | `vite.config.js` | 12 | `name: 'Runout — Records & Books'` | `name: 'Halcova — Records & Books'` |
| 9 | `vite.config.js` | 13 | `short_name: 'Runout'` | `short_name: 'Halcova'` |
| 10 | `vite.config.js` | 14 | current `description` | use `copy-kit-Halcova.md` §3 |
| 11 | `public/*` | — | `favicon.png`, `apple-touch-icon.png`, `icon-*.png` | **new mark — GATED on design `[VALIDATE]`** (see §5) |
| 12 | `README.md` | 1–67 | brand text ("Runout is a progressive web app…") | brand text → "Halcova"; **keep all `RUNOUT_ADMIN_KEY` / `runout-collection` / `runout-library` / `RU-…` identifiers** |
| 13 | `docs/functional.md`, `docs/technical.md`, `docs/design-redesign.md` | — | brand references | brand references → "Halcova"; **keep technical identifiers** |

**Rule of thumb for docs:** replace the *brand name in prose*; never touch
env vars, store names, storage keys, or the access-code format.

---

## 2. KEEP — internal identifiers (do not change in this ticket)

| Identifier | Location | Why |
| --- | --- | --- |
| `runout.session` (localStorage) | `src/utils/session.js` | renaming logs users out |
| `runout_discogs_token_*` | `src/api/discogs.js` | per-user token key |
| `runout.view.<kind>` | `src/CollectionView.jsx` | view-preference keys |
| User-Agent `RunoutRecordCollector/1.0` | `src/api/discogs.js` | Discogs expects a stable UA |
| `RUNOUT_ADMIN_KEY` env | `README.md` / netlify | deployment + auth |
| Blob stores `runout-identity`, `runout-collection`, `runout-library` | `netlify/functions/_shared/users.js` | data |
| `--runout-gold: #C9A227` token | `src/index.css` | design token; renaming is a *separate optional chore* (§4) |
| Tests asserting internal keys | `src/__tests__/listview.test.jsx`, `src/api/discogs.test.js` | keep as-is |

> A full internal rename (env, stores, keys, CSS token) is out of scope here.
> If wanted later, do it as its own migration chore with the Tester + Netlify
> Backend agents.

---

## 3. Copy to use

- Short description / meta / PWA description → `copy-kit-Halcova.md` §3
  (the ≤160-char line).
- **Do not change** the catalog `.copy` taglines:
  `recordsCatalog.copy.emptyTagline` (`"your crate, cataloged"`) and
  `booksCatalog.copy.emptyTagline` (`"your shelf, cataloged"`). The wordmark is
  component markup, not `.copy`.

---

## 4. Optional (nice-to-have, separate chore) — `[VALIDATE]`

- Rename `--runout-gold` → `--Halcova-gold` across `src/` CSS (touches ~15
  files). Low value, high churn — do only if the team wants a clean sweep.

---

## 5. Gated on others (do not block implementation, but ship in order)

- **Icons `[VALIDATE]`** — new mark on the dark `#16130F` theme (Figma / UI/UX
  Expert). Do not ship the stale Runout icon with the Halcova name. Meanwhile,
  the code + manifest rename can land on the branch.
- **Native-speaker + legal checks `[VALIDATE]`** — `marketing/name-check-Halcova-7-languages.md`
  and `rename-Halcova.md` §5. None block the code change; all block the public
  launch ("name day").

---

## 6. Verification (run before opening the PR)

1. **Leftover scan:** `grep -rn "Runout" src/ index.html vite.config.js README.md docs/`
   — every remaining hit must be an internal identifier from §2 (keys, UA,
   env, CSS token), not a visible brand name.
2. `npm run lint`
3. `npm test` (the `header-toolbar.test.jsx` assertion must pass with "Halcova")
4. `npm run build` — regenerates the PWA manifest + precache with the new name.
5. **Vite stale-transform gotcha:** after editing `index.html` / `vite.config.js`,
   re-request the page or restart the dev server before debugging.
6. Manual spot-check: header wordmark, auth screen wordmark, and (after build +
   install) the home-screen app name.

---

## 7. Definition of done

- [ ] Wordmark = `Halcova` in `Header.jsx`, `AuthScreen.jsx` (×4), `App.jsx`
- [ ] Test updated and passing
- [ ] `index.html` + `vite.config.js` brand/SEO/PWA names updated
- [ ] `README.md` + docs brand prose updated; internal identifiers untouched
- [ ] `npm run lint`, `npm test`, `npm run build` green
- [ ] Leftover-scan shows only §2 identifiers
- [ ] On `chore/rename-Halcova`, PR opened to `main`, not pushed directly
