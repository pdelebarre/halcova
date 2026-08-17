# Localization notes — foundations pack

Facts are universal; **voice localizes** (see `lore-layer-plan.md` §7). This
file tracks the per-locale voice work, `[VALIDATE]`/`[CULT]` flags, and
local-hero pack pointers.

## Locales

en (master) · en-GB (canon variant: facts identical, voice/spelling per en-GB)
· fr · nl · pt-BR · de · es · it

## Voice vs fact rule

`fact.text` is the single source of truth and is **not** translated into a
different fact. Only `fact.voice` (and any surrounding copy) localizes. A
localized voice may re-phrase humor but must never change the meaning of the
fact it wraps.

## Flags in this pack

| Entry | Flag | Note |
| --- | --- | --- |
| F-0002 | `[VALIDATE]` (voice) | "rock and roll" term travels; check the 1920s-record framing reads cleanly in each locale |
| F-0008 | `[CULT]` | UK-punk reference is a local hero in the UK/en-GB canon; other locales need their own punk/local era snapshot or omit |
| F-0014 | `[CULT]` | Astérix is a fr (and FR-reading) local hero; de/nl/pt-BR/es/it get their own local-hero T4 entry, not a straight translation |
| F-0015 | `[VALIDATE]` | "graphic novel" term nuance — native check on the term in each language before it ships |

## Local-hero pack pointers

Each locale may carry a small set of homegrown T4/T5 entries on top of the
universal bank, flagged `[CULT]` and scoped by `locale` in their own
`pack.json`:

- **fr:** Astérix (F-0014) · chanson française / Serge Gainsbourg T4 ·
  Éditions Gallimard T5
- **en-GB:** punk 1977 (F-0008) · British Library / Penguin UK T5
- **nl:** Nijntje / Dick Bruna T4 · De Bezige Bij T5
- **pt-BR:** Tropicália / Caetano Veloso T4 · Editora Companhia das Letras T5
- **de:** Krautrock T4 · Suhrkamp T5
- **es:** García Márquez / el Boom T4 · (publisher T5 TBD)
- **it:** Lucio Battisti / canzone d'autore T4 · Einaudi T5

Local-hero entries follow the same ledger + fact rules and get their own
`validation-log.md` rows.

## Open voice `[VALIDATE]` (hand off to native testers before locale ships)

All `fact.voice` lines in this pack, plus the copy-bank §12 lore slots they
plug into.
