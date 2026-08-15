# marketing/ — Runout rebrand workspace

**Current decision (2026-08-13): the public brand is `Halcova`** — the earlier `Hokan` and `Halcova` names are **superseded** (their docs are kept for reference).

## Authoritative files

| File | What it is |
| --- | --- |
| `copy-kit-halcova.md` | **Halcova copy kit** — taglines, positioning, descriptions, store-listing drafts, launch posts, per-market messaging + glossary (the live brand) |
| `review-benefits-humor.md` | **Benefits & humor layer** — review of the launch set + the reusable benefit bank (feature → benefit → payoff) and the humor voice/joke bank the campaign files now draw from |
| `brief-halcova-icon.md` | **Halcova icon brief** — for the UI/UX Expert: dark/gold tokens, **barcode element required** (the icon must show a code bar) |
| `private-test-plan.md` | **Private-test plan** — friends & family circle (FR/NL/PT-BR/DE/ES/IT), setup, feedback form, go/no-go |
| `private-test-invite.md` | **Invite copy** — EN master + FR/NL/PT-BR/DE/ES/IT drafts, with personal-code placeholders |
| `localization-plan.md` | **Localization plan** — 7 languages, per-user preference + switcher, architecture, rollout |
| `localization-dictionary.md` | **Translation dictionary (v1)** — EN/FR/NL/PT-BR/DE/ES/IT content for every key, `[VALIDATE]` |
| `localization-dictionary-addendum.md` | **Dictionary addendum (v1.1)** — new keys from `specs/` (C1/C2 + A5/B5 Phase 1), EN master + 6 translations, `[VALIDATE]` |
| `ticket-localization.md` | **Dev implementation ticket** — exact file/string scope for `feat/localization`, non-string fixes, tests, DoD |
| `rename-Halcova.md` | *Superseded* — earlier "rename to Halcova" plan (kept for reference) |
| `copy-kit-Halcova.md` | *Superseded* — earlier "Halcova" copy kit (kept for reference) |
| `ticket-rename-Halcova.md` | *Superseded* — earlier rename dev ticket (model for a new Hokan→Halcova ticket) |
| `name-check-Halcova-7-languages.md` | *Superseded* — earlier Halcova name check (a Halcova version is needed) |
| `brief-Halcova-icon.md` | *Superseded* — earlier Halcova icon brief (use `brief-halcova-icon.md`) |
| `handoff-rename-Halcova.md` | *Superseded* — earlier coordination handoff (kept for reference) |

## Launch campaign — "What lives in your halcova?" (2026-08-13)

Public viral launch across **X · Instagram · Facebook · WhatsApp · YouTube**,
curiosity-first progressive reveal, video produced in **PicsArt**. Brand: **Halcova**.

| File | What it is |
| --- | --- |
| `campaign-viral-launch.md` | **Master plan** — concept, info-control ladder, 5 phases, channel strategy, calendar, KPIs/UTM, risks, gates |
| `campaign-copy-bank.md` | **Post copy** — every caption/hook/thread per day & platform, hashtags, translation notes |
| `campaign-picsart-video-spec.md` | **Video production spec** — brand kit (dark `#16130F` + gold), 14 storyboarded assets (V1–V14), PicsArt techniques |
| `campaign-whatsapp-playbook.md` | **Personal WhatsApp sequence** — segments, invite flow, statuses, codes are private, admin workload |
| `campaign-landing-page.md` | **Landing page copy** — SEO/meta, hero→access sections (from `copy-kit-halcova.md` §4) + ready-to-paste UTM links per channel |
| `campaign-youtube-playbook.md` | **YouTube channel plan** — Shorts mirror of the campaign + weekly long-form, channel setup, SEO titles/descriptions/hashtags, thumbnails, UTM, KPIs |

> Campaign Phases 1–2 are **name-free** (safe to run now). Phase 3 (name reveal)
> is gated on the Hokan→Halcova code rename + legal/domain gate + icon (with a barcode).

> **Benefits & humor layer (2026-08-13):** the campaign set now leads with
> benefits ("never rebuy", "finally know what you own") and carries a wry,
> self-deprecating collector humor voice. Benefit bank + joke bank:
> `review-benefits-humor.md`.

## Product specs (drafts — for review, not implemented)

| File | What it is |
| --- | --- |
| `specs/activation-scan-and-onboarding.md` | C1 "Add & scan next" loop + C2 empty-state onboarding — copy keys + component touchpoints for the Front End Developer |
| `specs/lending-polish-and-reminders.md` | A5 lending polish + B5 reminders (Phase 1 device-native only) — copy keys + touchpoints, B5 Phase 2/3 flagged as future ADR |

## Iteration history (drafts — superseded, kept for reference)

| File | Round | Proposal |
| --- | --- | --- |
| `rename-strategy.md` | 1 | Original strategy — "Trove" (rejected on sound) |
| `rename-strategy-round2.md` | 2 | Sound-first menu — Cove / Lore / etc. |
| `rename-strategy-round3.md` | 3 | Treasure × cozy menu — Keepsake / Cove / Coffer / etc. |
| `rename-strategy-round4-international.md` | 4 | 7-language sound check — narrowed to cognate family → Halcova chosen |

> **Final name (2026-08-13): `Halcova`** — supersedes the "Halcova" decision; the
> campaign and copy kit now use Halcova.

## Open items `[VALIDATE]`

> **Backlog grooming (2026-08-15):** launch gates now tracked as GitHub tickets —
> **#119** icon, **#120** legal/domain/handles, **#121** landing page + Request access +
> UTM/analytics. Full prioritized backlog + PM handoff: `backlog-grooming-launch-handoff.md`.

1. Native-speaker pronunciation/meaning check for **Halcova** (a coined word) across EN/FR/PT/NL/DE/ES/IT.
2. Trademark + domain + social-handle check for "Halcova" → **GitHub #120**.
3. Halcova icon **with a barcode element** — approved by Marketing, PNGs in `public/` (`brief-halcova-icon.md`) → **GitHub #119**.
4. ~~Hokan→Halcova code rename~~ — **DONE: code is already fully renamed to Halcova** (index.html, vite.config.js, wordmarks, 8 locales); "Runout"/"Hokan" survive only as internal env/store names. No rename ticket needed.
5. Localization dictionaries validated by native testers (FR/NL/PT-BR/DE/ES/IT) before the `feat/localization` branch ships.
