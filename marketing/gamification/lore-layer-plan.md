# The Halcova Library — content & curation plan (contents-first pivot)

**Owner:** Marketing Manager (curation, fact-checking, quarterly fact-sweep)
**Branch:** `docs/gamification-content-pivot` · **Status:** durable strategy — the
single source of truth for the Halcova Library content layer
**Relates to:** `marketing/gamification/copy-bank.md` (§12 lore slots),
`marketing/gamification/requirements.md`, `marketing/gamification/concept.md`,
`docs/gamification-phase0.md` (data matrix)
**Working pack scaffold:** `marketing/gamification/lore/` (this plan's templates
and the starter `foundations` pack).

---

## 1. The pivot statement

> Games in Halcova run on **what the records and books mean** — the artist and
> author, the story behind the work, the era it came from, the genre it birthed,
> the label or publisher that released it, and how it connects to everything
> else in your collection. They do **not** run on *when you added them*.

The directive that drove this pivot: *"trivia about when the user added an item
is stupid."* `dateAdded`-based trivia is retired. Concretely, from the
gamification suite we cut:

- the quiz prompt `quiz.newestOldest` ("Which did you add first?"), which reads
  `dateAdded`;
- the wrong-answer miss-reveal clause *"you added {title} in {date}"* (and its
  `revealAdded` variant) — the teaching reveal now tells the **story**, not the
  date;
- the **Impulse Buyer** persona archetype + its verdict line and its
  `oneDayBurst` / `busiestMonth` stats — all `dateAdded`-burst based;
- the **Impulse Buyer** badge (`badge.impulseBuyer`, "10 added in a day");
- the optional add-streak mechanic;
- the `quest.scanRecent` quest ("scan the record you bought last week");
- persona inputs `busiestMonth` / `oneDayBurst`.

In their place, games draw on a **curated knowledge layer — the Halcova
Library**: a precached, fact-checked lore bank keyed to artists and authors
(enriched stable ids), with deterministic metadata facts as the honest fallback
when a given item isn't in the bank. The copy changes are tracked in
`copy-bank.md`; this document is the *content and curation* contract that makes
that copy truthful.

Why contents-first is on-brand and on-product:

- It serves the four discovery pillars (what you like / remember / should buy
  next / learned) with **substance**, not self-reference. "When did I add this?"
  teaches nothing; "here's the story behind Kind of Blue" does.
- It keeps the game board the *collection* (the arcade promise) while adding a
  **neutral, curated** layer — the Library — so the games are never only about
  the user's own data entry habits.
- It is **offline-safe** by construction: the Library ships precached with the
  PWA shell (like the scanner `.wasm`), so the quiz and stories deal entirely
  on-device.

---

## 2. Content taxonomy (T1–T8)

Every Library entry belongs to exactly one taxonomy tier. The tier drives the
entry's schema, its matchKeys emphasis, and its localization posture. Each tier
below carries truthful record **and** book examples (the "both kinds" contract —
one shared flow, parameterized crate/shelf).

| Tier | Name | What it is | Records example (truthful) | Books example (truthful) |
| --- | --- | --- | --- | --- |
| **T1** | Artist / author one-liner | A single durable, sourced fact about a person — the kind you'd drop in a sentence. | Miles Davis — *Kind of Blue* (1959) is the best-selling jazz album ever (RIAA multi-platinum; widely reported). | Ursula K. Le Guin — *The Left Hand of Darkness* (1969) won both the Hugo and the Nebula, a rare double. |
| **T2** | Story behind the work | The origin/anecdote behind a specific record or book. | "Feeling Good" was written by Anthony Newley & Leslie Bricusse for the 1964 musical *The Roar of the Greasepaint – The Smell of the Crowd* — not by Nina Simone, who made it hers. | *Frankenstein* (1818) was started during the "year without a summer" (1816), at the Villa Diodati ghost-story contest; Mary Shelley was 18. |
| **T3** | Era context | What was true of the world/music/literature in a year or decade — a snapshot your item lives in. | The 45 rpm single (RCA Victor, 1949) and the 12" LP (Columbia, 1948) defined the 1950s record store. | The Gutenberg Bible (c. 1455) is the earliest major book printed with movable type in Europe. |
| **T4** | Genre origins | Where a genre/category came from, and its foundational figures. | The term "rock and roll" appears in blues records from the 1920s; DJ Alan Freed popularized it for the new genre in the early 1950s. | Edgar Allan Poe's *The Murders in the Rue Morgue* (1841) is widely credited as the first modern detective story. |
| **T5** | Label / publisher lore | The imprint behind the item — its founding, its signature sound/design. | Blue Note Records was founded in 1939 in New York by Alfred Lion; Francis Wolff joined in 1941 — together they shaped the label's sound and look. | Penguin Books was founded by Allen Lane in 1935; its first ten sixpenny paperbacks are credited with starting the paperback revolution. |
| **T6** | Connections | A documented link between an item, an artist/author, and someone or something else in the cultural web. | Miles Davis played on Charlie Parker's *Birth of the Cool* sessions (1949–50), the record that gave cool jazz its name. | J.R.R. Tolkien and C.S. Lewis were members of the Oxford literary circle the Inklings, reading drafts aloud to each other. |
| **T7** | Awards & durable records | Prizes and "still true" superlatives — durable, verifiable, dated. | *Thriller* (1982) is the best-selling album of all time — a durable, widely documented record. | *One Hundred Years of Solitude* (1967) won Gabriel García Márquez the Nobel Prize in Literature (1982). |
| **T8** | Fun-fact templates | Reusable, computed or sourced template lines (rotating post-add toasts, share-card sublines). | "Your crate now spans `{n}` years of music." (computed) · "{title} was recorded in one take, legend says." (sourced, T2) | "Your shelf holds `{n}` pages." (computed) · "The author wrote {title} in {city} in {n} weeks." (sourced, T2) |

**Rules for examples:** T1–T7 are *curated facts* (sourced, ledger-tracked).
T8 is a mix — computed lines (already in the app, e.g. fun-fact toasts) and
sourced lines. Nothing is invented; see §7 (honesty contract).

---

## 3. Sourcing & fact-checking rules

**Two independent sources, always.** No entry ships with fewer than two
independent, citable sources. "Independent" means not both derived from the same
single upstream (e.g. a press release and a news story quoting that release do
not count as two).

**The source ledger.** Every claim is logged in `sources.md` with exactly this
shape (one row per claim):

```text
{ claim, source1, source2, lastVerified, verifiedBy }
```

- `claim` — a short, disambiguated statement (ties to an entry id + tier).
- `source1` / `source2` — stable references (title + publisher/institution +
  URL; prefer institutional sources: libraries, museums, archives, official
  artist/author/label/publisher channels, peer-reviewed reference works).
- `lastVerified` — ISO date of the most recent verification sweep.
- `verifiedBy` — the human/role who verified (Marketing Manager owns it; the
  quarterly fact-sweep updates it).

**Durable over fluctuating.** Prefer facts that stay true: founding years,
publication/release years, documented events, awards, "first/only" records that
are stable in the reference record. Avoid ratings, chart positions still moving,
commercial claims ("sold out"), unverified personal trivia, and anything that
depends on a live API. A claim that is true *today but not necessarily next
quarter* does not belong in the Library.

**Enriched stable ids.** Entries key to the artist/author's **stable id**
(`discogsId` for records, `googleBooksId`/author id for books) plus the slug
from `splitArtistTitle`. This is what makes a fact follow the item across
editions, pressings, and translations. (Feasibility of enriching ids at
add-time and matching at render-time is a Front End/Netlify handoff — flagged
`[VALIDATE]` in `copy-bank.md` §12.3; the *content* layer is id-agnostic and
ships regardless.)

---

## 4. Contested-facts policy `[DISPUTED]`

Some great lore is genuinely contested. The Library has a three-step policy:

1. **Omit** — if a claim is both contested *and* peripheral, it simply doesn't
   ship. The Library is a depth layer, not a gossip column.
2. **Uncontested core** — strip the claim to what every serious source agrees
   on, and ship that. Example (T4, records): the "first rock and roll record"
   is disputed, but the *uncontested core* is that several early-1950s records
   are candidates and **"Rocket 88" (1951, Jackie Brenston with Ike Turner's
   Kings of Rhythm) is the most frequently named**. Ship the core; tag the entry
   `[DISPUTED]`.
3. **Present both sides** — where the contest itself is the story, present both
   positions fairly, each with its sources, in the same entry (never one side
   wearing the label of fact). Example: who first *published* a blues song —
   "Dallas Blues" (Hart Wand, 1912) vs "Memphis Blues" (W.C. Handy, 1912) —
   phrase as "among the first," cite both.

`[DISPUTED]` is a **flag on the entry** (see `pack.json`), and contested entries
never receive a `[FACT]`-only status. When in doubt, the safest step up the
ladder (omit → core → both sides) wins.

---

## 5. Truthfulness & legal rules

These are non-negotiable and apply to every entry in every locale.

- **Never reproduce lyrics** — no lyric excerpts, however short, in any entry,
  toast, story, or share card. Song titles and album titles are fine (facts,
  not creative text).
- **Book quotes** — a *short* attributed quote (a line or two, properly
  attributed to the author and work) is acceptable where it is the cleanest way
  to make the point; otherwise **paraphrase**. Never reproduce a passage of any
  length. When quoting, keep it minimal and always attributed.
- **Living people — libel rules.** For living artists/authors/label figures:
  only *verifiable, sourced, non-defamatory* facts. No rumors, no private-life
  material, no negative claims without two solid sources, nothing a reasonable
  person could read as insulting or defamatory. When in doubt: omit (the
  "durable, kind, true" test — if a fact can't pass all three, it doesn't ship).
- **No invented praise or numbers.** No fabricated quotes, awards, sales
  figures, or testimonials. Every number is either computed from the user's own
  data or sourced in the ledger.
- **Flag anything needing product validation.** Claims that depend on app data
  we haven't confirmed (e.g. `notes` presence, enriched-id availability) carry
  `[VALIDATE]` until the owning engineer confirms — never shipped as settled
  fact.

---

## 6. Honesty contract — Computed vs Sourced vs never-Invented

Every line a player sees in the arcade is one of exactly two things, and the
Library draws a hard line between them. There is no third bucket.

| Bucket | What it is | Example | Attribution |
| --- | --- | --- | --- |
| **Computed** | Derived on-device from the player's own item data at render time. Numbers are computed, never hardcoded. No curation, no ledger. | "Your crate spans 47 years." · "You own 5 by Miles Davis." | none needed (obviously about *their* collection) |
| **Sourced** | Curated lore from the Halcova Library — fact-checked, ledger-tracked, two-source minimum. | "Kind of Blue is the best-selling jazz album ever." | **"From the Halcova Library"** (`lore.attribution`) |

**never-Invented:** anything that is neither computed-from-their-data nor
sourced-and-verified does **not** appear. No guessing, no half-remembered facts,
no "probably." A player who can't get a fact is fine — the fallback path (§8)
is deterministic metadata, and it is *still* computed, never invented.

The **"From the Halcova Library"** attribution (`lore.attribution`) appears on
every Sourced line, on every lore quiz question, and on every lore story card —
so the player always knows *which* bucket they're in. Sourced facts localize
their voice but not their truth (see §8).

---

## 7. Localization — facts universal, voice localizes

**The fact is the same in every language.** "Blue Note was founded in 1939"
does not change for fr, nl, pt-BR, de, es, it, or en-GB. What localizes is
**voice** — the wrapper sentence, the humor, the cultural framing. This is why
each entry separates `fact.text` (universal, single source of truth) from
`fact.voice` (localizable wrapper).

Three flags govern localization, carried from `copy-bank.md` conventions:

- `[FACT]` — the statement is a verified fact (sourced, ledger-tracked). Never
  translated into a different fact; translate only the voice.
- `[VALIDATE]` — native-speaker check required for the *voice/humor* of the
  localized line before it ships to that locale (same regime as the rest of the
  copy bank).
- `[CULT]` — culturally specific: the fact or reference needs a **local-hero
  pack** rather than a straight translation (e.g. an entry about Astérix as a
  French touchstone is a `fr` local-hero entry; the same *slot* in another
  locale needs its own local hero or an omit-and-fallback decision).

**Local-hero packs** for fr, nl, pt-BR, de, es, it (and the en-GB canon as the
UK variant of EN master): each locale can carry a small set of homegrown T4/T5
entries — the artists, authors, genres, and imprints that *their* collection is
likely to hold — on top of the universal bank. Local-hero entries follow the
same ledger and fact rules; they're just locale-scoped in `pack.json`
(`locale` field) and flagged `[CULT]`. en-GB is a **canon variant**: facts
identical, voice/spelling per en-GB.

---

## 8. Launch coverage sizing

Honest sizing, not a promise of universality. The Library is a **curated
layer**, so coverage is deliberately bounded and measured in beta.

**Core 500 bank (launch target):**

| Slice | Count | Contents |
| --- | --- | --- |
| Record facts | ~300 | T1–T7 entries keyed to high-frequency artists/labels/genres (the artists a typical crate actually holds) |
| Book facts | ~200 | T1–T7 entries keyed to high-frequency authors/publishers/genres |
| Foundations | ~30 | T3/T4/T5 genre-origin + era + label/publisher lore — **high hit-rate**: a foundation matches *any* item in that genre/label, so it covers items whose specific artist isn't in the bank yet |

**Coverage on a typical mixed 40-item collection:** honest estimate **~50–70%**
of items surface at least one Sourced fact. The rest are **not** dead — they
fall back to **Computed** deterministic metadata (year/era/decade stats,
genre-count, artist-frequency — the existing Shelf Stories facts tier), which
always exists for any item with a `year`/`genre`.

**The quiz always deals.** Every lore question type in `copy-bank.md` §3
(`quiz.loreFact`, `quiz.artistFact`, `quiz.yearContext`, `quiz.connection`) can
be dealt two ways: from a Sourced Library fact when the item is in the bank, or
from a Computed metadata fact otherwise. No question is ever skipped for lack of
lore. (This mirrors the existing quiz rule that items missing `coverImage`/`year`
are excluded from the pool — but the *fallback*, never a dead-end, is the
contract here.)

**Measurement:** the beta tracks `loreHits / itemsSeen` per collection and per
genre to validate the 50–70% estimate and steer the next pack's curation toward
the gaps. Numbers that come back below estimate get a targeted author/label pack
before international launch.

---

## 9. Content-pack file structure

Every pack lives under `marketing/gamification/lore/<pack>/` (the working
scaffold is the `foundations` pack):

```text
lore/
├── README.md                     # how a pack is structured, entry schema, matchKeys, editorial workflow
└── <pack>/
    ├── pack.json                 # the entries (schema below) + pack metadata + coverage notes
    ├── sources.md                # the source ledger: {claim, source1, source2, lastVerified, verifiedBy}
    ├── localization-notes.md     # per-locale voice notes, [VALIDATE]/[CULT] flags, local-hero pack pointers
    └── validation-log.md         # sign-off log: who checked what, when, and what was flagged/cleared
```

**Per-entry schema** (canonical — identical in `pack.json`, `README.md`, and
this plan):

```jsonc
{
  "id": "F-0003",            // pack-scoped id: <PACK>-NNNN
  "taxonomy": "T4",          // T1–T8 (§2)
  "kind": "records",         // records | books | both
  "fact": {
    "text": "…",             // UNIVERSAL truth — single source of truth, same in every locale
    "voice": "…"             // OPTIONAL localizable wrapper (brand voice); may be absent
  },
  "matchKeys": {             // how the entry finds items in a collection
    "artist": ["Jackie Brenston"],  // records: artist / books: author — resolved via splitArtistTitle
    "title": ["Rocket 88"],         // the specific work, when the entry is work-specific
    "label": [],                    // records: label / books: publisher
    "genre": ["Rock and roll"],     // records: genre / books: category
    "year": [1951]                  // exact year, or range for era snapshots
  },
  "flags": ["FACT", "DISPUTED"],    // FACT | VALIDATE | CULT | DISPUTED (may combine)
  "sources": ["S-0004", "S-0005"],  // → sources.md ledger rows
  "lastVerified": "2026-08-17",
  "verifiedBy": "Marketing Manager"
}
```

Pack metadata (`pack.json` top level): `schemaVersion`, `pack` id, `name`,
`description`, `locale` (the master is `en`; local-hero packs carry their
locale), and `coverage` notes (expected hit-rate, gaps to fill next).

---

## 10. Ownership map

| Responsibility | Owner | Cadence |
| --- | --- | --- |
| **Curation** — taxonomy placement, matchKeys, entry writing | Marketing Manager | ongoing; per-pack milestones |
| **Fact-checking** — two-source verification, ledger maintenance, `[DISPUTED]` calls | Marketing Manager | every entry before it ships |
| **Quarterly fact-sweep** — re-verify `lastVerified` on every live entry, retire anything that stopped being true, update the ledger | Marketing Manager | quarterly, on a fixed calendar (next: 2026-11-01) |
| **Copy integration** — lore slots into the catalog `.copy` / i18n keys | Front End Developer (per `copy-bank.md` §12; Marketing Manager hands off the exact keys, never edits `src/`) | at implementation |
| **Precaching** — Library ships precached with the PWA shell | Netlify Backend / PWA (`vite.config.js` — keep the pack in `globPatterns`, mirroring the scanner `.wasm` rule) | at implementation |
| **Matching feasibility** — enriched stable ids, `splitArtistTitle` match at render | Whole Stack Architect + Front End Developer (`[VALIDATE]` in `copy-bank.md` §12.3) | before launch |
| **Native-speaker validation** — localized voice for fr, nl, pt-BR, de, es, it | Private-circle native testers (same regime as the Phase 0 humor pass) | before each locale ships |

**Open decisions (`[VALIDATE]`, not blocked on content):** enriched-id matching
feasibility; where the Library is stored/precached (a JSON pack vs a function —
content is format-agnostic, prefer a precached static pack for offline);
whether `notes` are present in the client model for `quiz.missNotes`.

---

## 11. What this plan does NOT do

- It is **content**, not code. The Marketing Manager owns the Library and the
  pack files; the app implementation (matching, precaching, rendering) is a
  Front End/Netlify handoff driven by `copy-bank.md` §12 keys.
- It does **not** invent facts, metrics, or testimonials, and it never leaks
  internals (no access codes, no admin key, no implementation details in
  player-facing copy).
- It stays on the dark `#16130F` + gold, cozy-collector brand, and it never
  teases the person — jokes target the collection.
