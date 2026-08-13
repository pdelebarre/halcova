# Alcove Arcade — copy bank

Copy for the gamification suite. EN master first; translation notes + `[VALIDATE]`
flags per the localization rules (en, en-GB, fr, nl, pt-BR, de, es, it).

**Rules:**
- Jokes tease the *collection*, never the person.
- No references that don't travel (no US-only "flea market"/"mail carrier" in
  locales where it reads oddly — flag `[VALIDATE]`).
- Every number in a line is **computed**, never hardcoded — these are templates.

---

## 1. Umbrella taglines

| Key | EN (master) | Notes |
| --- | --- | --- |
| `arcade.tagline` | Catalog once. Play forever. | Keep short in all locales |
| `arcade.subtagline` | Your collection, but with games. | |
| `arcade.nav` | Play | Nav label (short) |
| `arcade.hint` | Turn your crate (shelf) into a game. | Per-kind via catalog `.copy` |
| `arcade.share.hashtag` | #WhatsInYourAlcove | Reuses the launch-campaign hashtag |

---

## 2. Persona archetypes

Structure: **Archetype name** · verdict line (1–2 sentences) · suggested stats
(the 2–3 numbers that are computed). All lines `[VALIDATE]` per locale.

### Records ("crate")
| Archetype | Verdict (EN) | Suggested stats |
| --- | --- | --- |
| The Crate Digger | You buy records the way other people buy groceries — weekly, and always more than you planned. | `{n}` records · `{n}` genres · top decade `{year}s` |
| The Time Traveler | Your crate is a time machine with a serious bias. `{year}` called, it wants its shelf back. | `{n}%` from the `{year}s` · `{n}` decades · 1 jazz record you bought to look smart |
| The Genre Tourist | `{n}` genres and zero commitments. We respect the chaos. | `{n}` genres · `{n}` labels · `{n}` countries |
| The Completist | `{artist}` has a full discography in here. Somewhere, a stranger just felt a chill. | `{n}/{n}` albums · `{n}` pressings of one · `{n}` notes |
| The Impulse Buyer | You added `{n}` records in one day. Your mail carrier knows your name. `[VALIDATE]` | `{n}` in one day · busiest month · `{n}` total |
| The One-Timer | You own exactly one record by `{artist}`. That's not a collection, that's a teaser. | 1 by `{artist}` · `{n}` total artists · gap since `{year}` |
| The Variant Collector | Two pressings of the same album? That's not duplication, that's commitment. | `{n}` pressings of one · `{n}` albums owned twice · `{n}` total |
| The Sophisticate | `{n}%` of your crate is jazz you bought to look smart. It worked. | `{n}%` jazz · `{n}` genres · notes on `{n}` items |

### Books ("shelf")
| Archetype | Verdict (EN) | Suggested stats |
| --- | --- | --- |
| The Couch Intellectual | Your shelf reads like a syllabus for a degree you never finished — in a good way. | `{n}` books · `{n}` categories · `{n}` pages |
| The Series Starter | `{series}` Book 1, Book 2, and Book 1 again. The trilogy is a lie. | `{n}` unfinished series · `{n}` books · `{n}` authors |
| The Genre Hedonist | Cozy mystery beside dense theory. The shelf has no rules. Good. | `{n}` categories · `{n}` authors · `{n}` pages |
| The Page Counter | `{n}` pages and counting. Your shelf is a gym membership for your brain. | `{n}` pages · `{n}` books · longest book `{title}` |
| The One-Series Wonder | `{author}` wrote `{n}%` of your shelf. Branch out — we'll still be here. | `{n}%` one author · `{n}` authors · `{n}` books |
| The First-Edition Idealist | You'd trade a couch for a first edition. Priorities. `[VALIDATE]` | `{n}` books · `{n}` publishers · `{n}` categories |

**Fallback (both kinds):** *Your collection is still young — and already
talking.* (shown before enough data exists)

---

## 3. The Crate Quiz copy

### Question prompts
| Key | EN (master) |
| --- | --- |
| `quiz.guessYear` | Which year is this from? |
| `quiz.nameArtist` | Who's behind this cover? |
| `quiz.newestOldest` | Which did you add first? |
| `quiz.stillYours` | Do you still own this? |
| `quiz.sortShelf` | Put these in year order. |

### Correct-answer feedback (rotating)
- You remembered. The crate is proud.
- Correct. Your collection is impressed, and it's hard to impress.
- Nailed it. (Books: "The shelf applauds — quietly, so the neighbors don't hear.")

### Wrong-answer feedback (rotating) — always followed by the reveal
- You own `{n}` records from the `{year}s` and you missed that. The vinyl heard.
- Wrong — but the real answer is better: you added `{title}` in `{date}`. Your notes say: "{notes}".
- To be fair, `{title}` has been hiding behind `{otherTitle}` for a while.
- Not quite. But now you'll never forget you own `{title}` again.

### Streak / day-complete copy
- `{n}`-day streak. Don't make the crate sad tomorrow.
- Perfect round! That's a streak worth bragging about. (Share card offered.)

---

## 4. Crate Digger Quests

| Key | Quest | EN (master) | Reward |
| --- | --- | --- | --- |
| `quest.discography` | Finish the discography | You own `{n}/{n}` by `{artist}`. Hunt the rest. `[VALIDATE]` | XP + "Completist" progress |
| `quest.decadeGap` | The `{decade}` Gap | Your `{decade}s` are thin. Add `{n}` more. | XP |
| `quest.sameArtist` | Same-artist blind spots | You love `{artist}` — go grab the one you're missing. | XP |
| `quest.variants` | The Variant Shelf | You own `{title}` twice. Commit to the variants or let one go. | XP + "Variant Hoarder" |
| `quest.lend` | Lend a record, make a friend | Lend something from your crate and get it back. | XP + "Friend of the Crate" |
| `quest.return` | Bring it home | That overdue book has a family. Get it returned. | XP |
| `quest.notes` | Notes for future you | Add notes to `{n}` items. Future you will thank you. | XP |
| `quest.scanRecent` | The recent you forgot | You bought `{title}` recently and never scanned it. Fix that. | XP |

### Quest-complete toast
- Quest complete. The crate grows stronger.
- Done. Your future self will be so impressed.
- Quest finished — reward: one (1) warm feeling.

---

## 5. Badges (funny, data-grounded)

| Key | Badge | Unlock | Line |
| --- | --- | --- | --- |
| `badge.digger` | Crate Digger | 50 records | Fifty records. At this point it's a lifestyle. |
| `badge.pageturner` | Page Turner | 25 books | Twenty-five books. Somewhere, a TBR pile is jealous. |
| `badge.genreTourist` | Genre Tourist | 10+ genres/categories | Ten genres and no regrets. |
| `badge.timeTraveler` | Time Traveler | Items from 5+ decades | Five decades in one crate. History buff. |
| `badge.completist` | Completist | Full artist discography | `{artist}` complete. We heard the completionist choir. |
| `badge.impulseBuyer` | Impulse Buyer | 10 added in a day `[VALIDATE]` | Ten in one day. Your wallet's on a break. |
| `badge.sleeveSleuth` | Sleeve Sleuth | Notes on 10 items | Ten notes. The collection finally has opinions. |
| `badge.balancedDiet` | Balanced Diet | Records **and** books | Records and books. Culture, properly balanced. |
| `badge.onetimer` | One-Timer | Single item by a legend | One `{artist}`. Bold. Mysterious. |
| `badge.variantHoarder` | Variant Hoarder | 2+ pressings, one album | Two pressings of one album. Commitment issues? No — commitment. |
| `badge.friendOfCrate` | Friend of the Crate | First lend + return | You lent and it came home. Friendship: unlocked. |
| `badge.quizWhiz` | Quiz Whiz | Perfect quiz day | Perfect quiz. The crate is officially intimidated. |

---

## 6. Levels

| Kind | L1 | L2 | L3 | L4 | L5 |
| --- | --- | --- | --- | --- | --- |
| Records | Crate Sprout | Crate Nerd | Crate Digger | Vinyl Sage | Crate Deity |
| Books | Page Turner | Shelf Stacker | Bookworm | Literary Cartographer | Shelf Sovereign |

- Level-up toast (records): *Level up: **Crate Nerd**. Your crate salutes you.*
- Level-up toast (books): *Level up: **Bookworm**. The shelf rearranges itself in your honor.*

---

## 7. Share cards

| Card | Headline (EN) | Subline |
| --- | --- | --- |
| Persona | My collection, according to my crate: **{archetype}** | `{stat1} · {stat2} · {stat3}` — catalog once, play forever. #WhatsInYourAlcove |
| Level-up | Just hit **{level}** | `{n}` items cataloged · `{xp}` XP |
| Badge | Unlocked: **{badge}** | `{line}` |
| Quiz | **{n}/{n}** on today's Crate Quiz | "You remembered. The crate is proud." |

Privacy rule: cards show only headline + aggregate stats. No item lists, no
covers in bulk, no codes.

---

## 8. Fun-fact toasts (post-add, rotating)

- Your crate now spans `{n}` years of music.
- `{year}` is your golden year. What happened in `{year}`?
- Your shelf holds `{n}` pages.
- You just made `{artist}` your most-cataloged artist. Nice.
- That's `{n}` records added this month. The shelf is thriving.

---

## 9. Translation notes

- **Puns & archetype names**: keep names as close as possible; where a name
  doesn't translate (e.g. "Crate Digger"), prefer a short evocative equivalent
  and note the deviation. `[VALIDATE]` per locale.
- **Humor register**: keep it light; avoid sarcasm that reads as insult in NL/DE
  (directness can feel harsh), soften in PT-BR/ES/IT (warmer, self-deprecating
  register works best).
- **"You bought it to look smart"** lines: universally funny, but soften the
  "smart" in FR ("pour faire chic") and IT ("per fare scena").
- **Local idioms to avoid** (or `[VALIDATE]`): "flea market", "mail carrier",
  "gym membership" — swap for local equivalents during the native pass.
- **Numbers/plurals**: use ICU pluralization (already the app's pattern) for
  every `{n}` line.

## 10. `[VALIDATE]` summary (all copy)

All archetype verdicts · quiz feedback lines · badge names/lines · quest names ·
fun-fact templates — **native-speaker check in fr, nl, pt-BR, de, es, it**
before the feature ships to those locales.
