# Similar-item check — copy handoff (translation-ready)

Owner: Front End Developer · Source: Marketing (international copy) · Date: 2026-08-15
Requirements: `docs/similar-item-check-requirements.md` (decisions confirmed).

This file is the **copy** for the similar-item check. It lists the exact `src/catalog.js`
`.copy` keys to add/change and the i18n strings for all 8 supported locales. It does not
edit app code — the developer wires it.

---

## 1. Where the strings live today

- Shown banner/label copy comes from `src/catalog.js` → `recordsCatalog.copy` and
  `booksCatalog.copy` (currently hardcoded English).
- `src/i18n/locales/*.js` already define `catalog.resultSameLabel` / `catalog.resultSameSub`,
  but those keys are **not consumed** by `ScanResult.jsx` today — it renders
  `copy.resultSame` from the catalog. **Localization gap**: the result banner is currently
  English-only in every locale.
- **Recommendation (part of this work):** wire the banner label/sub through `t()` keys so
  all locales translate, using the existing `{collectionLabel}` / `{artistLabel}`
  interpolation. Strings below are provided for every locale either way.

## 2. Catalog `.copy` keys — exact en source strings

### `recordsCatalog.copy` (`src/catalog.js`, ~line 80)

| Key | Value (en) | Notes |
| --- | --- | --- |
| `resultSame` (keep) | label `You already own this album` · sub `Different pressing or format — check before buying.` | L2 caution — unchanged |
| **`resultPossible` (new)** | label `Maybe you already own this` · sub `A similar title by this artist is already in your crate — check before buying.` | L4b muted "possible" tone |
| **`reasonFormat` (new)** | `(format) => \`on ${format}\`` | shown on related rows: "on CD · 1997" |
| **`reasonPressing` (new)** | `another pressing` | same master, same format |
| **`wishlistSimilarNote` (new)** | `Also in your wishlist` | small note on a similar (non-exact) wishlist row |

### `booksCatalog.copy` (`src/catalog.js`, ~line 481)

| Key | Value (en) | Notes |
| --- | --- | --- |
| `resultSame` (keep) | label `You already own this book` · sub `Different edition — check before buying.` | L3 caution — unchanged |
| **`resultLanguage` (new)** | label `You already own this book` · sub `(lang) => \`You already have this in ${lang}.\`` | L4 — same work, different language |
| **`resultPossible` (new)** | label `Maybe you already own this` · sub `A similar title by this author is already on your shelf — check before buying.` | L4b muted "possible" tone |
| **`reasonLanguage` (new)** | `(lang) => \`in ${lang}\`` | shown on related rows: "in French · 2005" |
| **`reasonEdition` (new)** | `another edition` | |
| **`wishlistSimilarNote` (new)** | `Also in your wishlist` | |

## 3. i18n keys — all 8 locales

Add these keys to each `src/i18n/locales/*.js`, in the `catalog.` block next to
`catalog.resultSameLabel/Sub`.

| Key | en / en-GB | fr | de | es | it | nl | pt-BR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `catalog.resultPossibleLabel` | Maybe you already own this | Peut-être possédez-vous déjà ceci | Vielleicht hast du das schon | Puede que ya tengas esto | Forse ce l'hai già | Misschien heb je dit al | Talvez você já tenha isto |
| `catalog.resultPossibleSub` | A similar title by this {artistLabel} is already in your {collectionLabel} — check before buying. | Un titre similaire de cet {artistLabel} est déjà dans votre {collectionLabel} — vérifiez avant d'acheter. | Ein ähnlicher Titel dieses {artistLabel}s ist bereits in deinem {collectionLabel} — vor dem Kauf prüfen. | Un título similar de este {artistLabel} ya está en tu {collectionLabel} — comprueba antes de comprar. | Un titolo simile di questo {artistLabel} è già nel tuo {collectionLabel} — controlla prima di acquistare. | Een vergelijkbare titel van deze {artistLabel} staat al in je {collectionLabel} — controleer voor aankoop. | Um título semelhante deste {artistLabel} já está no seu {collectionLabel} — verifique antes de comprar. |
| `catalog.resultLanguageSub` | You already have this in {language}. | Vous l'avez déjà dans {language}. | Das hast du bereits auf {language}. | Ya lo tienes en {language}. | Lo hai già in {language}. | Je hebt dit al in {language}. | Você já tem isto em {language}. |
| `catalog.reasonFormat` | on {format} | sur {format} | auf {format} | en {format} | in {format} | op {format} | em {format} |
| `catalog.reasonLanguage` | in {language} | dans {language} | auf {language} | en {language} | in {language} | in {language} | em {language} |
| `catalog.reasonEdition` | another edition | une autre édition | eine andere Ausgabe | otra edición | un'altra edizione | een andere editie | outra edição |
| `catalog.reasonPressing` | another pressing | un autre pressage | eine andere Pressung | otra edición | un'altra stampa | een andere persing | outra prensagem |
| `catalog.wishlistSimilarNote` | Also in your wishlist | Aussi dans votre liste d'envies | Auch in deiner Wunschliste | También en tu lista de deseos | Anche nella tua lista dei desideri | Ook in je verlanglijst | Também na sua lista de desejos |

> Note on register: existing locale files use informal address for de/it/es/nl and
> formal "vous" for fr; pt-BR uses "você". The strings above match those registers.

## 4. Glossary & interpolation notes

- `{collectionLabel}` = **crate** (records) / **shelf** (books) — never translate the token;
  it comes from the catalog and is already interpolated by `t()`.
- `{artistLabel}` = **artist** (records) / **author** (books) — already in `catalog.artistLabel`.
- `{language}` = localized display name of the ISO code Google Books returns (`fr`, `en`, …).
  Resolve in code with `Intl.DisplayNames([locale], { type: 'language' })` so each locale
  shows its own endonym; do not hardcode a single mapping in copy.
- `{format}` = Discogs format string (LP, CD, 7", 12", Cassette) — keep as-is; only the
  preposition is localized (`on`/`sur`/`auf`/…).
- Use the existing em dash " — " and ellipsis "…" style already used in each locale file.

## 5. Copy-validation flags (do not ship the claim before the code supports it)

- `resultLanguage` copy promises a language match — only wire it when L4 detection
  (language + author + title/`seriesId`) is implemented. Until then it stays unused.
- `resultPossible` ("Maybe you already own this") is deliberately soft to absorb
  fuzzy-match false positives. Before shipping outside EN, sanity-check the
  false-positive rate on a real collection so the muted tier doesn't nag.
- `reasonPressing` ("another pressing") only appears when two items share `masterId` with
  the same `formatType` — keep the same-format-doubles behavior per decision Q3.

## 6. Release-note line (optional, for the changelog)

> Runout now flags similar items before you add them — a book you already have in another
> edition or language, or a record you own in another format — so you can check your crate
> or shelf before you buy.

(localized with the app's release notes if needed)
