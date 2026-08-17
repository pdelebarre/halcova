# Localization notes — records-core pack

Facts are universal; **voice localizes** (see `lore-layer-plan.md` §7). This
file tracks the per-locale voice work, `[VALIDATE]`/`[CULT]` flags, and
local-hero pack pointers for `records-core/pack.json` (RC-0001…RC-0050).

Work item: `(FEAT-EPIC-5, #277)` — Halcova Library lore content packs.

## Locales

en (master) · en-GB (canon variant: facts identical, voice/spelling per en-GB)
· fr · nl · pt-BR · de · es · it

## Voice vs fact rule

`fact.text` is the single source of truth and is **not** translated into a
different fact. Only `fact.voice` (and any surrounding copy) localizes. A
localized voice may re-phrase humor but must never change the meaning of the
fact it wraps.

## Facts needing care per locale

| Entry | Note |
| --- | --- |
| RC-0011 (Space Oddity / Apollo 11) | The BBC-in-coverage fact is EN/UK-centric in framing; keep the fact, localize the wrapper (each locale had its own Moon-landing broadcast moment). |
| RC-0033 (Woodstock anthem) | "The Star-Spangled Banner" is a US reference; fine as a universal fact, but the *meaning* of performing it lands differently outside the US — voice must not editorialize on US politics. Keep it neutral. |
| RC-0037 (Born to Run / Landau review) | The "rock and roll's future" line is a US critic's quote — short attributed paraphrase only, and check it reads cleanly translated. |
| RC-0029 (Dylan Nobel) | Nobel is universal; the "first songwriter" framing should be double-checked per locale (some literary traditions frame it differently). |
| RC-0045 (Daft Punk) / RC-0047 (Adele) | Both acts are widely known globally; Grammy specifics are US institutions — check the award framing reads naturally in each locale's music culture. |

## Local-hero pack pointers (records)

Each locale may carry a small set of homegrown T1/T2/T4/T5 entries on top of
the universal bank, flagged `[CULT]` and scoped by `locale` in their own
`pack.json`:

- **en-GB:** British Invasion era snapshots (Foundations F-0024) · The Jam /
  Madness (mod/2-tone) · Island Records T5
- **fr:** chanson française · Serge Gainsbourg · Édith Piaf · (label T5 TBD)
- **nl:** Nederpop · Golden Earring · (label T5 TBD)
- **pt-BR:** Tropicália · Caetano Veloso · Gilberto Gil · (label T5 TBD)
- **de:** Krautrock · Kraftwerk · Neu! · (label T5 TBD)
- **es:** rock en español · (label T5 TBD)
- **it:** canzone d'autore · Lucio Battisti · Fabrizio De André · (label T5 TBD)

Local-hero entries follow the same ledger + fact rules and get their own
`validation-log.md` rows.

## Open voice `[VALIDATE]` (hand off to native testers before locale ships)

All `fact.voice` lines in this pack, plus the copy-bank §12 lore slots they
plug into. The brand voice (warm, witty, teases the collection never the
person) must survive translation. The en-GB canon variant localizes spelling
only; facts stay identical.
