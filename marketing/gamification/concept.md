# Halcova Arcade — concept

**Working title** (pending a name-check like the Halcova rename): **Halcova Arcade** —
"your collection, but with games." This document is the creative concept behind
gamifying the app. It stays true to the real product: every mechanic is built
only from data the app already stores (`title`, `year`, `label`, `formatType`,
`genre`, `style`, `country`, `dateAdded`, `notes`, `barcode`, `discogsId` /
`googleBooksId`), the existing `splitArtistTitle` / `findRelated` matching, and
the lending feature. Nothing invented.

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
stuff.

**The promise, in one line:**

> Catalog once. Play forever.

---

## 2. Four pillars — mapped to your four goals

| Your goal | Pillar | The hook |
| --- | --- | --- |
| "What do I **like**?" | **Persona** — *What your crate says about you* | A funny, shareable archetype generated from your data |
| "What could I **buy next**?" | **Quests** — *Crate Digger quests* | Personalized next-buys pulled from your own collection |
| "What do I **remember**?" | **The Crate Quiz** — *a 60-second daily game* | Questions only *your* collection can ask |
| "What did I **learn**?" | **Shelf Stories** — *collection insights* | Facts, era lessons, and artist constellations from your data |

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

- **Scan** → instant feedback (XP, a fact: *"Your crate spans 47 years."*).
- **Play** → a 60-second daily quiz from your own data; streaks make you come back.
- **Dig** → quests tell you exactly what to hunt next; you scan it, the loop closes.
- **Share** → a beautiful dark/gold card; a friend requests access. Fits the
  existing `#WhatsInYourHalcova` UGC campaign.

This is a **daily habit loop**: each visit is short, personal, and ends with a
reason to come back tomorrow (the streak) and a reason to buy something (the
quest).

---

## 4. The six game ideas

### 4.1 Persona — "What your crate says about you" 🎭 *(know yourself)*

A generated "collection personality" from the data: dominant genres, decades,
formats, artists. It produces **one archetype**, **three honest stats**, and one
**funny verdict** — rendered as a shareable dark `#16130F` + gold card.

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

### 4.2 The Crate Quiz — daily 60-second memory games 🧠 *(what you remember)*

Every day the app deals 3–5 quick questions generated **purely from the user's
own items** — no API, works offline:

- **Guess the Year** — show a cover, pick between two years.
- **Name That Artist** — show a cover, three artist options (decoys are other
  artists you own — so the wrong answers are *your own* blind spots).
- **Newest or Oldest?** — "Which of these did you add first?"
- **Still Yours?** — show a cover: "Do you still own this?" (you might have
  forgotten you have it — the punchline writes itself).
- **Sort the Shelf** — put three items in year order.

Scoring is gentle and funny:

> *"You own 47 records from the 80s and you missed 1984. The vinyl heard that."*

> Wrong answers teach: after a miss, the game shows the item and its story —
> *"You added this in March 2024. Your notes say 'impulse buy at a flea market.'"*

Why it works: it's the **retention engine** — a 60-second daily ritual that makes
people open the app every day, literally discovering what they remember (and
what they've forgotten they own).

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

### 4.4 Shelf Stories — what you learned 📖 *(learn from your collection)*

Auto-generated insights that teach and entertain:

- **Collection facts** — *"Your crate spans 47 years of recorded music."* /
  *"Your shelf holds 2,304 pages and three unfinished series."*
- **Era lessons** — *"You're heavy on 1979–1985. Here's what was happening in
  music then — and five records you'd probably love from that era."* (education
  + next-buy in one).
- **Artist constellations** — *"Three authors wrote 40% of your shelf. Here are
  three more who write in the same lane."* (books, driven by category/genre).
- **The One-Timer alert** — *"You own exactly one record by The Smiths."* (also a
  quest seed).

Shelf Stories feed the Quests engine: every "lesson" can become a "quest."

### 4.5 Progression — XP, levels, badges, streaks 🏅 *(the glue)*

- **XP** for: scan-add, manual add, finishing a quest, a correct quiz answer,
  writing notes, first lend/return.
- **Levels** with funny per-kind titles:
  - Records: Crate Sprout → Crate Nerd → Crate Digger → Vinyl Sage → Crate Deity
  - Books: Page Turner → Shelf Stacker → Bookworm → Literary Cartographer → Shelf Sovereign
- **Badges** (funny, data-grounded): Crate Digger (50 records), Genre Tourist
  (10+ genres), Time Traveler (5+ decades), Completist (full artist
  discography), Impulse Buyer (10 added in a day), Sleeve Sleuth (notes on 10
  items), Balanced Diet (records **and** books), One-Timer (a single item by a
  legend), Variant Hoarder (2+ pressings of the same album), Friend of the Crate
  (first lend + return).
- **Streaks**: daily-quiz streak (the strong one); optional add-streak (scanned
  N days in a row). Streaks exploit loss aversion — *don't break the chain.*

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
| **1 — Know & Play** | Persona, Crate Quiz, Shelf Stories, XP/levels/badges/streaks | **None** — all derived client-side from existing item data, works offline | None |
| **2 — Next & Dig** | Crate Digger Quests, quest progress/rewards, share cards | Maybe an endpoint for artist discography via the Discogs proxy | Discogs artist releases (needs `[VALIDATE]`) |
| **3 — Social & Seasonal** | Friend-to-friend challenges (opt-in), seasonal events (Record Store Day quests, Summer Reading Bingo) | Product decision + backend | Optional |

Phase 1 is deliberately **zero-backend, zero-API, offline-safe** — it reuses the
data the app already stores and the matching utilities it already has. That makes
it the cheapest, highest-retention feature in the roadmap.

---

## 6. Why it's addictive (not gimmicky)

- **60-second daily ritual** → a habit, not a time sink.
- **Personal by construction** → the quiz, quests, and persona come from *your*
  data, so there is no generic content to exhaust.
- **Offline-safe** → the quiz and persona work anywhere, even on a plane.
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
- **No invented features** — every mechanic maps to real stored data; anything
  that needs a new data source is flagged `[VALIDATE]` in `requirements.md`.
- **No leaks** — share cards never include the full collection, access codes, or
  the admin key.
- **No error-boundary blind spots** — per project guidelines, all new data paths
  are guarded defensively (an uncaught render error blanks the screen).
