# marketing/ — Runout rebrand workspace

**Current decision (locked 2026-08-12): rename the public brand to `Alcove`.**

## Authoritative files (use these)

| File | What it is |
| --- | --- |
| `rename-alcove.md` | **Final rename plan** — decision, rationale, brand architecture, international summary, legal checklist, full rollout map, measurement, next steps |
| `copy-kit-alcove.md` | **Final copy kit** — taglines, positioning, descriptions, store-listing drafts, launch posts, per-market messaging + glossary |
| `ticket-rename-alcove.md` | **Dev implementation ticket** — exact file/line scope, keep-list, verification, definition of done |
| `name-check-alcove-7-languages.md` | **Native-speaker check sheet** — 7-language pronunciation/meaning/vibe validation to run before launch |
| `brief-alcove-icon.md` | **Icon design brief** — for the UI/UX Expert (Figma), with real dark/gold tokens and maskable constraints |
| `handoff-rename-alcove.md` | **Coordination handoff** — who does what, dependency map, "name day" checklist |
| `private-test-plan.md` | **Private-test plan** — friends & family circle (FR/NL/PT-BR/DE/ES/IT), setup, feedback form, go/no-go |
| `private-test-invite.md` | **Invite copy** — EN master + FR/NL/PT-BR/DE/ES/IT drafts, with personal-code placeholders |
| `localization-plan.md` | **Localization plan** — 7 languages, per-user preference + switcher, architecture, rollout |
| `localization-dictionary.md` | **Translation dictionary (v1)** — EN/FR/NL/PT-BR/DE/ES/IT content for every key, `[VALIDATE]` |
| `ticket-localization.md` | **Dev implementation ticket** — exact file/string scope for `feat/localization`, non-string fixes, tests, DoD |

## Launch campaign — "What lives in your alcove?" (2026-08-13)

Public viral launch across **X · Instagram · Facebook · WhatsApp**, curiosity-first
progressive reveal, video produced in **PicsArt**.

| File | What it is |
| --- | --- |
| `campaign-viral-launch.md` | **Master plan** — concept, info-control ladder, 5 phases, channel strategy, calendar, KPIs/UTM, risks, gates |
| `campaign-copy-bank.md` | **Post copy** — every caption/hook/thread per day & platform, hashtags, translation notes |
| `campaign-picsart-video-spec.md` | **Video production spec** — brand kit (dark `#16130F` + gold), 14 storyboarded assets (V1–V14), PicsArt techniques |
| `campaign-whatsapp-playbook.md` | **Personal WhatsApp sequence** — segments, invite flow, statuses, codes are private, admin workload |

> Campaign Phases 1–2 are **name-free** (safe to run now). Phase 3 (name reveal)
> is gated on the `chore/rename-alcove` branch + legal/domain gate + icon.

## Iteration history (drafts — superseded, kept for reference)

| File | Round | Proposal |
| --- | --- | --- |
| `rename-strategy.md` | 1 | Original strategy — "Trove" (rejected on sound) |
| `rename-strategy-round2.md` | 2 | Sound-first menu — Cove / Lore / etc. |
| `rename-strategy-round3.md` | 3 | Treasure × cozy menu — Keepsake / Cove / Coffer / etc. |
| `rename-strategy-round4-international.md` | 4 | 7-language sound check — narrowed to cognate family → Alcove chosen |

## Open items `[VALIDATE]`

1. Native-speaker pronunciation/meaning check (EN/FR/PT/NL/DE/ES/IT).
2. Trademark + domain + app-store + social-handle check for "Alcove".
3. New app icon mark on the dark `#16130F` theme.
4. Implement rollout items in `rename-alcove.md` §6 on a `chore/rename-alcove` branch.
5. Localization dictionaries validated by native testers (FR/NL/PT-BR/DE/ES/IT) before the `feat/localization` branch ships.
