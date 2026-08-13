# marketing/ — Runout rebrand workspace

**Current decision (2026-08-13): the public brand is `Halcova`** — the earlier `Hokan` and `Alcove` names are **superseded** (their docs are kept for reference).

## Authoritative files

| File | What it is |
| --- | --- |
| `copy-kit-halcova.md` | **Halcova copy kit** — taglines, positioning, descriptions, store-listing drafts, launch posts, per-market messaging + glossary (the live brand) |
| `brief-halcova-icon.md` | **Halcova icon brief** — for the UI/UX Expert: dark/gold tokens, **barcode element required** (the icon must show a code bar) |
| `private-test-plan.md` | **Private-test plan** — friends & family circle (FR/NL/PT-BR/DE/ES/IT), setup, feedback form, go/no-go |
| `private-test-invite.md` | **Invite copy** — EN master + FR/NL/PT-BR/DE/ES/IT drafts, with personal-code placeholders |
| `localization-plan.md` | **Localization plan** — 7 languages, per-user preference + switcher, architecture, rollout |
| `localization-dictionary.md` | **Translation dictionary (v1)** — EN/FR/NL/PT-BR/DE/ES/IT content for every key, `[VALIDATE]` |
| `ticket-localization.md` | **Dev implementation ticket** — exact file/string scope for `feat/localization`, non-string fixes, tests, DoD |
| `rename-alcove.md` | *Superseded* — earlier "rename to Alcove" plan (kept for reference) |
| `copy-kit-alcove.md` | *Superseded* — earlier "Alcove" copy kit (kept for reference) |
| `ticket-rename-alcove.md` | *Superseded* — earlier rename dev ticket (model for a new Hokan→Halcova ticket) |
| `name-check-alcove-7-languages.md` | *Superseded* — earlier Alcove name check (a Halcova version is needed) |
| `brief-alcove-icon.md` | *Superseded* — earlier Alcove icon brief (use `brief-halcova-icon.md`) |
| `handoff-rename-alcove.md` | *Superseded* — earlier coordination handoff (kept for reference) |

## Launch campaign — "What lives in your halcova?" (2026-08-13)

Public viral launch across **X · Instagram · Facebook · WhatsApp**, curiosity-first
progressive reveal, video produced in **PicsArt**. Brand: **Halcova**.

| File | What it is |
| --- | --- |
| `campaign-viral-launch.md` | **Master plan** — concept, info-control ladder, 5 phases, channel strategy, calendar, KPIs/UTM, risks, gates |
| `campaign-copy-bank.md` | **Post copy** — every caption/hook/thread per day & platform, hashtags, translation notes |
| `campaign-picsart-video-spec.md` | **Video production spec** — brand kit (dark `#16130F` + gold), 14 storyboarded assets (V1–V14), PicsArt techniques |
| `campaign-whatsapp-playbook.md` | **Personal WhatsApp sequence** — segments, invite flow, statuses, codes are private, admin workload |
| `campaign-landing-page.md` | **Landing page copy** — SEO/meta, hero→access sections (from `copy-kit-halcova.md` §4) + ready-to-paste UTM links per channel |

> Campaign Phases 1–2 are **name-free** (safe to run now). Phase 3 (name reveal)
> is gated on the Hokan→Halcova code rename + legal/domain gate + icon (with a barcode).

## Iteration history (drafts — superseded, kept for reference)

| File | Round | Proposal |
| --- | --- | --- |
| `rename-strategy.md` | 1 | Original strategy — "Trove" (rejected on sound) |
| `rename-strategy-round2.md` | 2 | Sound-first menu — Cove / Lore / etc. |
| `rename-strategy-round3.md` | 3 | Treasure × cozy menu — Keepsake / Cove / Coffer / etc. |
| `rename-strategy-round4-international.md` | 4 | 7-language sound check — narrowed to cognate family → Alcove chosen |

> **Final name (2026-08-13): `Halcova`** — supersedes the "Alcove" decision; the
> campaign and copy kit now use Halcova.

## Open items `[VALIDATE]`

1. Native-speaker pronunciation/meaning check for **Halcova** (a coined word) across EN/FR/PT/NL/DE/ES/IT.
2. Trademark + domain + social-handle check for "Halcova".
3. Halcova icon **with a barcode element** — approved by Marketing, PNGs in `public/` (`brief-halcova-icon.md`).
4. Hokan→Halcova code rename on a `chore/rename-halcova` branch (new dev ticket).
5. Localization dictionaries validated by native testers (FR/NL/PT-BR/DE/ES/IT) before the `feat/localization` branch ships.
