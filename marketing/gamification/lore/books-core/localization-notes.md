# Localization notes — books-core pack

Facts are universal; **voice localizes** (see `lore-layer-plan.md` §7). This
file tracks the per-locale voice work, `[VALIDATE]`/`[CULT]` flags, and
local-hero pack pointers for `books-core/pack.json` (BC-0001…BC-0030).

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
| BC-0003 / BC-0004 (Austen) | En-GB canon variant is natural; the Prince Regent reference (BC-0004) needs a light historical note in locales where the Regency is less familiar. |
| BC-0015 / BC-0016 (García Márquez) | This is a **local-hero** figure for `es` — the es locale carries a deeper local-hero entry; keep this universal entry as-is for the other locales. |
| BC-0017 (Murakami) | Local-hero affinity for any locale with a large Japanese-literature readership; the voice line needs native validation in every locale. |
| BC-0020 (Christie / The Mousetrap) | "London's West End" is the factual anchor; fine universally, but voice should not assume West End familiarity outside EN locales. |
| BC-0025 (Slaughterhouse-Five) | The book's famous refrain is a quotation — the voice line only alludes to the novel's reputation, never quoting text. Keep it a paraphrase, never a passage. |
| BC-0030 (A Christmas Carol) | Christmas is global, but "revived interest in Christmas traditions" is UK-historical — keep the fact, localize the framing of the holiday. |

## Local-hero pack pointers (books)

Each locale may carry a small set of homegrown T1/T2/T4/T5 entries on top of
the universal bank, flagged `[CULT]` and scoped by `locale` in their own
`pack.json`:

- **en-GB:** Dickens serialization T3 (see Foundations F-0031) · Virginia Woolf
  T5 publisher (Hogarth Press) · Penguin UK
- **fr:** Proust ("À la recherche du temps perdu") · Éditions Gallimard T5 ·
  Astérix (Foundations F-0014)
- **nl:** Multatuli ("Max Havelaar") · Nijntje / Dick Bruna T4 · De Bezige Bij T5
- **pt-BR:** Machado de Assis · Jorge Amado · Editora Companhia das Letras T5
- **de:** Thomas Mann · Hermann Hesse · Suhrkamp T5
- **es:** Borges · Gabriel García Márquez (deeper) · "el Boom" T4
  (Foundations F-0027) · (publisher T5 TBD)
- **it:** Italo Calvino · Primo Levi · Einaudi T5

Local-hero entries follow the same ledger + fact rules and get their own
`validation-log.md` rows.

## Open voice `[VALIDATE]` (hand off to native testers before locale ships)

All `fact.voice` lines in this pack, plus the copy-bank §12 lore slots they
plug into. The brand voice (warm, witty, teases the collection never the
person) must survive translation. The en-GB canon variant localizes spelling
only; facts stay identical.
