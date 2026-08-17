# The Halcova Library — lore pack workspace

The **Halcova Library** is the curated, fact-checked knowledge layer that powers
contents-first games in the arcade (quiz, stories, quests, lore toasts). It is
keyed to artists/authors (enriched stable ids) with deterministic **Computed**
metadata as the honest fallback.

**Authoritative strategy:** `marketing/gamification/lore-layer-plan.md`.
This folder is the *working content* — the packs that ship (precached with the
PWA shell) and the templates that keep them honest.

**Owned by:** Marketing Manager (curation, fact-checking, quarterly fact-sweep).
The Marketing Manager writes the packs; a Front End Developer wires the keys
into the catalog `.copy` — never the reverse.

---

## 1. Where things live

```text
lore/
├── README.md            ← this file: structure, schema, workflow
└── <pack>/
    ├── pack.json                 # the entries (canonical schema below)
    ├── sources.md                # source ledger: {claim, source1, source2, lastVerified, verifiedBy}
    ├── localization-notes.md     # per-locale voice, [VALIDATE]/[CULT] flags, local-hero pointers
    └── validation-log.md         # sign-off log (who checked what, when)
```

The starter pack is `foundations/` — genre origins, era snapshots, and
label/publisher lore with the highest hit-rate per item. It is a **template**,
not the 500-entry bank.

## 2. The rules (non-negotiable)

- **Two independent sources** per claim, logged in `sources.md`.
- **Durable over fluctuating** — facts that stay true; no live ratings, no
  moving chart positions.
- **Contested?** Follow the `[DISPUTED]` ladder: omit → uncontested core →
  present both sides.
- **Never invented.** Every surfaced line is either **Computed** (from the
  player's own data) or **Sourced** (from this bank). There is no third bucket.
- **Never reproduce lyrics.** Book quotes: short + attributed, else paraphrase.
  Living people: sourced, non-defamatory, kind — or omit.
- Sourced lines carry the attribution **"From the Halcova Library"**
  (`lore.attribution` in `copy-bank.md` §12).

## 3. Entry schema (canonical)

```jsonc
{
  "id": "F-0003",            // pack-scoped id: <PACK>-NNNN
  "taxonomy": "T4",          // T1–T8 — see lore-layer-plan.md §2
  "kind": "records",         // records | books | both
  "fact": {
    "text": "…",             // UNIVERSAL truth — same in every locale, single source of truth
    "voice": "…"             // OPTIONAL localizable wrapper (brand voice: dark #16130F + gold, cozy-collector, funny-but-kind)
  },
  "matchKeys": {
    "artist": [],            // records: artist / books: author — resolved via splitArtistTitle
    "title": [],             // work-specific entries only
    "label": [],             // records: label / books: publisher
    "genre": [],             // records: genre / books: category
    "year": null             // exact year, or [start, end] range for era snapshots
  },
  "flags": ["FACT"],         // FACT | VALIDATE | CULT | DISPUTED (may combine)
  "sources": ["S-0001"],     // → sources.md ledger rows
  "lastVerified": "YYYY-MM-DD",
  "verifiedBy": "Marketing Manager"
}
```

### matchKeys — how an entry finds its items

Entries match items in a collection through `splitArtistTitle` (the app's own
splitter — never reimplement it) plus the item's plain fields:

| matchKey | Records source | Books source |
| --- | --- | --- |
| `artist` | the artist side of `splitArtistTitle(title)` | the author side of `splitArtistTitle(title)` |
| `title` | the album/song side of `splitArtistTitle(title)` | the book title side of `splitArtistTitle(title)` |
| `label` | item `label` | item publisher (books use `label` for publisher) |
| `genre` | item `genre[]` | item `genre[]` (category) |
| `year` | item `year` | item `year` |

A match is a hit on **any** key (an entry with `genre: ["Jazz"]` covers every
jazz item; an entry with `artist: ["Miles Davis"]` covers every Miles item; a
both-key entry narrows). `year` supports a single year or an inclusive
`[start, end]` range (era snapshots). Entries are matched against **enriched
stable ids** when available (`discogsId` / author id) — feasibility is a
`[VALIDATE]` handoff; the content is id-agnostic.

## 4. Flags

| Flag | Meaning | Who clears it |
| --- | --- | --- |
| `[FACT]` | Verified, sourced, ledger-tracked truth | Marketing Manager at write time |
| `[VALIDATE]` | Needs product/native validation before it ships (data availability, localized voice) | Front End Dev (data) / native testers (voice) |
| `[CULT]` | Culturally specific — needs a local-hero pack, not a straight translation | Marketing Manager + native testers |
| `[DISPUTED]` | Contested claim — ships only its uncontested core or both sides (§4 of the plan) | Marketing Manager |

## 5. Editorial workflow

1. **Pick a gap** (from coverage notes in `pack.json` or the quarterly sweep).
2. **Draft the entry** in the taxonomy tier that fits; keep `fact.text`
   universal and dry; add a `voice` wrapper only when it earns its place.
3. **Two sources** → add/confirm `sources.md` ledger rows.
4. **Run the honesty check**: is it Sourced-and-verified, or does it fall back
   to Computed? If neither — cut it.
5. **Flag it**: `[FACT]` on verification; `[DISPUTED]` per the ladder; `[CULT]`
   if it belongs in a local-hero pack; `[VALIDATE]` for anything gated on app
   data we haven't confirmed.
6. **Sign off in `validation-log.md`** (date, checker, verdict).
7. **Hand off to Front End Developer** with the exact `copy-bank.md` §12 key(s)
   — never edit `src/` yourself.

## 6. Why foundations-first

`foundations/` covers T3/T4/T5 (genre origins, era snapshots, label/publisher
lore). Those have the highest **hit-rate per entry** — one genre-origin entry
covers every item in that genre, so a small pack gives the quiz and stories a
wide deal before the per-artist bank (T1/T2/T6/T7) catches up. The 500-entry
launch target and the honest ~50–70% coverage model are in
`lore-layer-plan.md` §8.
