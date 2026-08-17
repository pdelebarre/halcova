# Halcova Arcade — concept

**Working title** (pending a name-check like the Halcova rename): **Halcova Arcade** —
"your collection, but with games." This document is the creative concept behind
gamifying the app. It stays true to the real product — and to one hard rule:

> **Contents-first.** The games play the *contents of your collection*: the
> artists and authors you own, the albums and books, and the stories and history
> inside them. They never play the act of cataloging — no "which did you add
> first?", no "you added this in March 2024", no impulse-buy trivia, no
> add-streaks. `dateAdded` survives only where it already lives (sort order,
> progression timestamps) — never as a question.

Every mechanic is built from one of three honest tiers (see §7): **computed**
facts — pure functions of data the app stores (`title`, `year`, `label`,
`genre`, `style`, `country`, `formatType`, `notes`, `barcode`, `pageCount`,
`discogsId` / `googleBooksId`, plus the Phase-A content fields `artists[]`,
`tracklist`, `released`, `series`, `snippet`); **sourced** lore — the precached,
attributed "Halcova Library" (§5); and the existing `splitArtistTitle` /
`findRelated` matching and the lending feature. **Nothing invented.**

- For the elaborated, dev-ready spec → [`requirements.md`](requirements.md)
- For the actual copy → [`copy-bank.md`](copy-bank.md)

---

## 1. The insight

A collection is not a list. It is:

- a **taste fingerprint** (what you like),
- a **memory palace** (what you remember — and what you forgot you owned),
- a **wish list in disguise** (what you could buy next),
- and an **accidental autobiography** (what you learned by owning things).

A barcode scanner gets people in the door once. Games get them to come back every
day. The whole point of Halcova Arcade is to make the *existing catalog* the game
board — no leaderboards, no generic content, no invented scarcity. Only your
stuff — and the stories inside it.

The game board is the **contents**: a record is a question ("what's behind this
cover?", "what's on this pressing?", "what's the story of this label?"), and a
book is a question ("what's inside this blurb?", "what series does this belong
to?"). The answers come from what you already own — not from a log of when you
scanned it.

**The promise, in one line:**

> Catalog once. Play forever.

---

## 2. Four pillars — mapped to your four goals

| Your goal | Pillar | The hook |
| --- | --- | --- |
| "What do I **like**?" | **Persona** — *What your shelf says about you* | A funny, shareable archetype from the *contents* you own — genres, eras, artists, authors |
| "What could I **buy next**?" | **Quests** — *Crate Digger quests* | Next-buys pulled from what your collection already *says* you like |
| "What do I **remember**?" | **The Crate Quiz** — *a 60-second daily game* | Questions about the *things you own* — artist, year, label, tracklist, and the story behind them |
| "What did I **learn**?" | **Shelf Stories** — *the stories inside your shelf* | Facts, era lessons, label histories, and anecdotes — all about what you own |

The four pillars share one **progression layer** (XP, levels, badges, streaks)
and one **social layer** (share cards).

---

## 3. The core loop

```mermaid
flowchart LR
    A[Scan / add an item] --> B[XP + badge progress + a fun fact toast]
    B --> C[Daily Crate Quiz - 60 seconds]
    C --> D[Streak grows - persona updates]
    D --> E[Quests: "here's what to buy next"]
    E --> A
    C --> F[Share card - friend requests access]
    F --> A
```

- **Scan** → instant feedback (XP, a *content* fact: *"Your crate spans 47 years."*).
- **Play** → a 60-second daily quiz about the contents of your own collection;
  streaks make you come back.
- **Dig** → quests tell you exactly what to hunt next; you scan it, the loop closes.
- **Share** → a beautiful dark/gold card; a friend requests access. Fits the
  existing `#WhatsInYourHalcova` UGC campaign.

Every turn of the loop is about the things you own and what they hold — never
about when you added them. This is a **daily habit loop**: each visit is short,
personal, and ends with a reason to come back tomorrow (the streak) and a reason
to buy something (the quest).

---

## 4. The game catalog

### 4.1 Persona — "What your shelf says about you" 🎭 *(know yourself)*

A generated "collection personality" from the contents of your collection:
dominant genres, decades, formats, artists, authors. It produces **one
archetype**, **three honest stats**, and one **funny verdict** — rendered as a
shareable dark `#16130F` + gold card.

> **De-meta'd.** The Persona reads what you *own* — the genres, decades, artists,
> labels, and pages. The `dateAdded`-burst stats (busiest day, busiest month,
> "added 10 in a day") are gone: a collection's personality is its contents, not
> its cataloging log.

Record examples:

> **The Time Traveler** — *"Your crate is a time machine with a serious bias.
> 1984 called, it wants its shelf back."* Stats: 47% from the 80s · 3 decades · 1 jazz record you bought to look smart.

> **The Completist** — *"Radiohead has a full discography in here. Somewhere, a
> stranger just felt a chill."* Stats: 9/9 albums · 2 pressings of one · 0 notes.

> **The One-Timer** — *"You own exactly one record by The Smiths. That's not a
> collection, that's a teaser."*

Book examples:

> **The Couch Intellectual** — *"Your shelf reads like a syllabus for a degree you
> never finished — in a good way."*

> **The Page Counter** — *"2,304 pages and counting. Your shelf is a gym
> membership for your brain."*

Why it works: it's the **"know yourself"** hook and the single most shareable
artifact. It also updates as the collection grows, so people re-run it to see if
their personality "changed" — a repeat-visit reason.

### 4.2 The Crate Quiz — daily 60-second content games 🧠 *(what you remember)*

Every day the app deals 3–5 quick questions **built from the contents of the
member's own items** — no runtime API, works offline.

**The metadata core** (pure `year` / `genre` / `label` / `cover`, always
playable):

- **Guess the Year** — show a cover, pick between two years.
- **Name That Artist** — show a cover, three artist options (decoys are other
  artists you own — so the wrong answers are *your own* blind spots).
- **Sort the Shelf** — put three items in year order.
- **Still Yours?** *(optional warm-up)* — show a cover: "Do you still own this?"
  (you might have forgotten you have it — the punchline writes itself). The
  reveal is the treat: the item's story from the Halcova Library, not its add
  date.

**The content games** (dealt only when the Phase-A enrichment or the lore bank
has the material — see `requirements.md` §5bis):

- **Cover Memory** — name the album behind a cover (or match covers to titles).
- **Spot the Impostor** — four covers share a thread; one doesn't belong.
- **Label/Press Match** — match a record to its label and pressing.
- **The Numbers Game** — number facts: track count, page count, release year.
- **Genre Odd One Out** — "which of these is *not* a jazz record?"
- **Track Detective** (records) — "which track is *not* on this album?"
- **Blurb Match** (books) — match the book to its blurb.
- **Decade Lesson** — "what was happening in music in the year this came out?"
- **Story & Anecdote Trivia** — sourced stories about the artists you own.
- **Connections** — "what links these two records?" (same label, same era, same story).

Scoring is gentle and funny:

> *"You own 47 records from the 80s and you missed 1984. The vinyl heard that."*

> Wrong answers teach: after a miss, the game shows the real answer and the
> item's story — a sourced fact from the Halcova Library (falling back to a
> computed metadata fact when no lore entry exists), plus your `notes` when they
> exist. The add date is never shown.

Why it works: it's the **retention engine** — a 60-second daily ritual that
makes people open the app every day, literally rediscovering the *stories* they
own (and the ones they've forgotten are theirs).

### 4.3 Crate Digger Quests — the next-buy engine 🛒 *(what to buy next)*

Personalized "quests" that tell a member exactly what to hunt next, all grounded
in their own collection:

- **Finish the discography** — *"You own 3 Radiohead albums. Hunt the other 6."*
- **The Decade Gap** — *"Your 70s are weak. Add two records from before 1980."*
- **Same-artist blind spots** — reuse `findRelated`: albums by artists you own
  that you don't have yet.
- **The Variant Shelf** — *"You own two pressings of the same album. Commit to
  the variants or let one go."* (a loving jab at the duplicate data the app
  already tracks).
- **Lending quests** — tie into the existing lending feature: *"Lend a record to
  a friend and get it back"*, *"Get that overdue book home."*
- **Catalog hygiene** — *"Add notes to 5 items"*, *"Scan the record you bought
  last week but haven't cataloged yet."*

Each quest has a goal, a progress bar, and a small reward (XP + badge). It maps
1:1 to "what could I buy next" and closes the core loop (quest → buy → scan →
progress).

### 4.4 Shelf Stories — the stories inside your shelf 📖 *(learn from your collection)*

Auto-generated stories that teach and entertain, in two tiers:

**Facts tier** (computed from your data — always shown):

- **Collection facts** — *"Your crate spans 47 years of recorded music."* /
  *"Your shelf holds 2,304 pages and three unfinished series."*
- **Era lessons** — *"You're heavy on 1979–1985. Here's what was happening in
  music then — and five records you'd probably love from that era."* (education
  + next-buy in one).
- **Artist constellations** — *"Three authors wrote 40% of your shelf. Here are
  three more who write in the same lane."* (books, driven by category/genre).
- **The One-Timer alert** — *"You own exactly one record by The Smiths."* (also a
  quest seed).

**Lore tier** (sourced from the Halcova Library — a card shows only when a
matching lore entry exists, otherwise it degrades to the facts tier):

- **Story cards** — an anecdote about an artist/author you own.
- **Era cards** — what the era of your dominant decade was about.
- **Label cards** — the history of a label/publisher you collect.
- **Genre-origin cards** — where a genre you collect came from.

Shelf Stories feed the Quests engine: every "lesson" can become a "quest."

### 4.5 Progression — XP, levels, badges, streaks 🏅 *(the glue)*

- **XP** for: scan-add, manual add, finishing a quest, a correct quiz answer,
  writing notes, first lend/return.
- **Levels** with funny per-kind titles:
  - Records: Crate Sprout → Crate Nerd → Crate Digger → Vinyl Sage → Crate Deity
  - Books: Page Turner → Shelf Stacker → Bookworm → Literary Cartographer → Shelf Sovereign
- **Badges** (funny, data-grounded): Crate Digger (50 records), Genre Tourist
  (10+ genres), Time Traveler (5+ decades), Completist (full artist
  discography), Sleeve Sleuth (notes on 10 items), Balanced Diet (records
  **and** books), One-Timer (a single item by a legend), Variant Hoarder (2+
  pressings of the same album), Friend of the Crate (first lend + return). The
  old Impulse Buyer badge ("10 added in a day") is cut — it rewarded the act of
  cataloging, not the contents.
- **Streaks**: the daily-quiz streak is the only streak — it survives the pivot
  untouched (it tracks play, not add-dates). The optional add-streak ("scanned N
  days in a row") is gone: it gamified the scanner, not the shelf.

### 4.6 Share cards — the social layer 📤 *(optional virality)*

Locally rendered (SVG/canvas), dark `#16130F` + gold, no external services:

- Persona card, level-up card, badge-unlock card, "I scored 4/5 on my Crate
  Quiz" card.
- **Privacy rules**: a card shows only the headline + 2–3 stats — never the full
  collection, never access codes, never the admin key.
- Plugs straight into the existing `#WhatsInYourHalcova` UGC campaign and the
  "request access" funnel.

---

## 5. Phasing

| Phase | Ships | Backend? | API? |
| --- | --- | --- | --- |
| **1 — Know & Play** | Persona, Crate Quiz, Shelf Stories, XP/levels/badges/streaks | **None** — content comes from two offline-safe sources: **Phase A** blob enrichment of the stored item, **Phase B** a precached curated lore bank (the "Halcova Library") | None |
| **2 — Next & Dig** | Crate Digger Quests, quest progress/rewards, share cards | Maybe an endpoint for artist discography via the Discogs proxy | Discogs artist releases (needs `[VALIDATE]`) |
| **3 — Social & Seasonal** | Friend-to-friend challenges (opt-in), seasonal events (Record Store Day quests, Summer Reading Bingo) | Product decision + backend | Optional |

**Phase 1 is deliberately zero-runtime-API and offline-safe** — and it now has a
real content source. In the Whole Stack Architect's Phase A/B/C ordering:
**Phase A** enriches each stored item with stable content fields (records:
`artists[]`, `masterId`, `tracklist`, `released`; books: `authorsList[]`,
`subtitle`, `series`, `mainCategory`, `snippet`) — merged at the detail view so
adding stays one network call (Discogs quota), then persisted on the item.
**Phase B** precaches a curated lore bank (`src/content/lore/*.js` + a pure
`lookupLore()`) so sourced stories work on a plane. **Phase C** is the games
themselves, reading Phase A + Phase B + the deterministic metadata facts —
computed facts, sourced lore, nothing invented. That makes Phase 1 the cheapest,
highest-retention feature in the roadmap, with the only content source that works
offline.

---

## 6. Why it's addictive (not gimmicky)

- **60-second daily ritual** → a habit, not a time sink.
- **Personal by construction** → the quiz, quests, and persona come from *the
  things you own*, so there is no generic content to exhaust.
- **Contents-first** → the game board is the stuff itself — artists, authors,
  stories, history. Because the material is *your* collection it never runs out,
  and nothing ever asks you to feel bad about *when* you cataloged something.
- **Offline-safe** → the quiz and persona work anywhere, even on a plane (the
  content source is precached, not fetched).
- **Streaks + progress** → loss aversion and visible momentum.
- **Shareable** → social proof + a built-in invite funnel.
- **Funny but kind** → the jokes tease the *collection* ("you bought one jazz
  record to look smart"), never attack the person.

---

## 7. Anti-patterns we deliberately avoid

- **No global leaderboards** — this is a private-collection app; leaderboards
  would leak taste and invite comparison anxiety.
- **No pay-to-win / no fake urgency** — XP is cosmetic and honest.
- **No nagging** — every game is a choice, never a required interruption.
- **No invented features** — every mechanic maps to real stored data or a real,
  sourced lore entry; anything that needs a new data source is flagged
  `[VALIDATE]` in `requirements.md`.
- **No meta-trivia (contents-first)** — the games never ask about the act of
  cataloging: no "which did you add first?", no "you added this in March 2024",
  no impulse-buy lines, no add-streaks. `dateAdded` is a progression input, not a
  question.
- **Computed vs Sourced vs never Invented** — the honesty contract. Every claim
  in the app is exactly one of:
  - **Computed** — a pure function of stored data, provable from your collection
    ("47% from the 80s", "2,304 pages").
  - **Sourced** — a curated fact from the Halcova Library, attributed on screen
    ("From the Halcova Library") so you always know where it came from.
  - **Never** — the app never invents a fact. If a mechanic can't be computed or
    sourced, it degrades (skips the question/card) instead of guessing.
- **No leaks** — share cards never include the full collection, access codes, or
  the admin key.
- **No error-boundary blind spots** — per project guidelines, all new data paths
  are guarded defensively (an uncaught render error blanks the screen).
