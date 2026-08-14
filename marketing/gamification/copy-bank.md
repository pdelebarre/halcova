# Halcova Arcade — copy bank

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
| `arcade.share.hashtag` | #WhatsInYourHalcova | Reuses the launch-campaign hashtag |

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
| The Impulse Buyer | You added `{n}` records in one day. Your delivery person knows your name. `[VALIDATED]` — see §11 (L1) | `{n}` in one day · busiest month · `{n}` total |

> EN master de-US'd in the Phase 0 pass: "mail carrier" → "delivery person"
> (neutral, travels); local forms per §11.1–11.6 (L1).
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
| The First-Edition Idealist | You'd trade a couch for a first edition. Priorities. `[VALIDATED]` — see §11 (L2) | `{n}` books · `{n}` publishers · `{n}` categories |

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
| `quest.discography` | Finish the discography | You own `{n}/{n}` by `{artist}`. Hunt the rest. `[VALIDATED]` — see §11 (L3) | XP + "Completist" progress |
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
| `badge.impulseBuyer` | Impulse Buyer | 10 added in a day `[VALIDATE]` *(data-feasibility — req §11.2, not humor)* | Ten in one day. Your wallet's on a break. `[VALIDATED]` — see §11 (L14) |
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
| Persona | My collection, according to my crate: **{archetype}** | `{stat1} · {stat2} · {stat3}` — catalog once, play forever. #WhatsInYourHalcova |
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
- **Local idioms to avoid**: "flea market", "mail carrier", "gym membership" —
  resolved in the Phase 0 pass (see §11): "mail carrier" → local delivery figure
  (L1), "gym membership" → local gym-abonnement gag (L4). "Flea market" appears
  only inside *user-written notes* (never in copy) — leave user content untouched.
- **Numbers/plurals**: use ICU pluralization (already the app's pattern) for
  every `{n}` line.

## 10. `[VALIDATE]` summary (all copy)

All archetype verdicts · quiz feedback lines · badge names/lines · quest names ·
fun-fact templates — **native-speaker check in fr, nl, pt-BR, de, es, it**
before the feature ships to those locales.

**Phase 0 humor pass (2026-08-14):** see §11. The three line-level `[VALIDATE]`
flags on humor (L1 Impulse Buyer, L2 First-Edition Idealist, L3
quest.discography) are cleared to `[VALIDATED]`. `badge.impulseBuyer`'s unlock
stays `[VALIDATE]` — that flag is data-feasibility (req §11.2), not humor. 15
humor lines were translated + annotated for all six locales; ~49 further lines
were validated as clean-travel without change.

---

## 11. Locale validation notes — Phase 0 native-speaker humor pass

**Owner:** Marketing Manager · **Date:** 2026-08-14 · **Scope:** every
`[VALIDATE]` line in this bank plus every line carrying a US-only or
locale-specific reference, per `requirements.md` §10.

The translations below are the **working handoff** for the i18n locales and the
catalog `.copy`; the private circle's native testers do final sign-off on the
remaining flags (§11.9). Computed placeholders (`{n}`, `{year}`, `{artist}`,
`{title}`, `{notes}`, `{series}`, `{date}`, `{decade}`) are preserved everywhere.

**Counts (per locale, this pass):**

| Locale | Flagged lines translated (L1–L15) | Clean-travel lines validated (§11.8) | Not cleared |
| --- | --- | --- | --- |
| fr | 15 | ~49 | 1 (data flag) |
| nl | 15 | ~49 | 1 (data flag) |
| pt-BR | 15 | ~49 | 1 (data flag) |
| de | 15 | ~49 | 1 (data flag) |
| es | 15 | ~49 | 1 (data flag) |
| it | 15 | ~49 | 1 (data flag) |

> The single line kept `[VALIDATE]` in every locale is `badge.impulseBuyer`'s
> unlock condition — a **data-feasibility** flag (req §11.2), not humor.

**en-GB micro-note:** the EN master is already UK-safe after the de-US pass
("delivery person"), but "couch" reads US — en-GB should render *sofa* (L2),
and "grocery run" → *the weekly shop* (L6) if a UK variant is ever shipped.

### 11.1 fr

Register per §9: warm, second-person *tu*, punchlines short. Jokes tease the
collection, never the person.

| Id | EN (master) | FR (native) | Validation note |
| --- | --- | --- | --- |
| L1 | You added `{n}` records in one day. Your delivery person knows your name. | Tu as ajouté `{n}` disques en une journée. Ton facteur connaît ton nom. | "mail carrier" → *facteur* (classic FR comic figure; *livreur* also works). Humor travels cleanly. |
| L2 | You'd trade a couch for a first edition. Priorities. | Tu troquerais un canapé contre une première édition. Priorités. | "trade a couch" reads naturally; one-word *Priorités.* lands. |
| L3 | You own `{n}/{n}` by `{artist}`. Hunt the rest. | Tu possèdes `{n}/{n}` de `{artist}`. Chasse les autres. | *chasse* keeps the hunt gag. |
| L4 | Your shelf is a gym membership for your brain. | Ton étagère est un abonnement de salle de sport pour ton cerveau. | Unused-gym-membership gag is very FR (*l'abonnement jamais utilisé*). |
| L5 | Your shelf reads like a syllabus for a degree you never finished — in a good way. | Ton étagère se lit comme un programme de cours pour un diplôme que tu n'as jamais fini — dans le bon sens. | "syllabus" has no direct FR word → *programme de cours*; unfinished-studies gag is relatable. |
| L6 | You buy records the way other people buy groceries — weekly, and always more than you planned. | Tu achètes des disques comme d'autres font les courses — chaque semaine, et toujours plus que prévu. | "grocery run" → *faire les courses*; universal. |
| L7 | Twenty-five books. Somewhere, a TBR pile is jealous. | Vingt-cinq livres. Quelque part, une pile à lire est jalouse. | **"TBR" must not ship as-is** → *pile à lire* (standard FR reading-community term). |
| L8 | Five decades in one crate. History buff. | Cinq décennies dans un seul bac. Mordu d'histoire. | "history buff" → *mordu d'histoire* (*mordu de* = obsessed). |
| L9 | `{artist}` complete. We heard the completionist choir. | `{artist}` au complet. On a entendu le chœur des collectionneurs. | No single FR word for "completionist" here → *chœur des collectionneurs*. |
| L10 | Nailed it. | En plein dans le mille. | Bullseye idiom; the books aside ("applauds — quietly") travels cleanly. |
| L11 | `{n}%` of your crate is jazz you bought to look smart. It worked. | `{n}%` de ton bac, c'est du jazz acheté pour faire chic. Ça a marché. | Per §9, soften "smart" → *pour faire chic*. |
| L12 | 1 jazz record you bought to look smart | 1 disque de jazz acheté pour faire chic | Same softening as L11. |
| L13 | You just made `{artist}` your most-cataloged artist. Nice. | Tu viens de faire de `{artist}` ton artiste le plus catalogué. Sympa. | Deadpan "Nice." → *Sympa.* (dry register works). |
| L14 | Ten in one day. Your wallet's on a break. | Dix en un jour. Ton portefeuille est en pause. | "on a break" → *en pause*. |
| L15 | Your notes say: "{notes}". | Tes notes disent : « {notes} ». | Travels; open flag is data (notes presence — req §11.7), not humor. |

Clean-travel in fr: the §11.8 list with no changes needed.

### 11.2 nl

Register per §9: warm, *je*; avoid sarcasm that reads as harsh; gentle
directness is fine.

| Id | EN (master) | NL (native) | Validation note |
| --- | --- | --- | --- |
| L1 | You added `{n}` records in one day. Your delivery person knows your name. | Je hebt `{n}` platen in één dag toegevoegd. Je pakketbezorger kent je naam. | "mail carrier" → *pakketbezorger* (parcel delivery — the modern NL reality); *postbode* alternative. |
| L2 | You'd trade a couch for a first edition. Priorities. | Je zou je bank inruilen voor een eerste druk. Prioriteiten. | *bank inruilen* — very natural. |
| L3 | You own `{n}/{n}` by `{artist}`. Hunt the rest. | Je hebt `{n}/{n}` van `{artist}`. Ga op jacht naar de rest. | Hunt gag travels. |
| L4 | Your shelf is a gym membership for your brain. | Je plank is een sportschoolabonnement voor je brein. | Unused-gym-membership gag is universal in NL. |
| L5 | Your shelf reads like a syllabus for a degree you never finished — in a good way. | Je plank leest als een studiegids voor een studie die je nooit afmaakte — in de goede zin. | "syllabus" → *studiegids* (no exact NL word); unfinished-studies gag relatable. |
| L6 | You buy records the way other people buy groceries — weekly, and always more than you planned. | Je koopt platen zoals anderen boodschappen doen — wekelijks, en altijd meer dan je van plan was. | Universal. |
| L7 | Twenty-five books. Somewhere, a TBR pile is jealous. | Vijfentwintig boeken. Ergens is een nog-te-lezen-stapel jaloers. | **"TBR" → native *nog-te-lezen-stapel*** (communities do say "TBR", but native is safer). |
| L8 | Five decades in one crate. History buff. | Vijf decennia in één krat. Geschiedenisfanaat. | *-fanaat* is the natural NL suffix idiom. |
| L9 | `{artist}` complete. We heard the completionist choir. | `{artist}` compleet. We hoorden het completistenkoor. | *completenkoor* is a light coinage; *koor van de verzamelaars* alternative. |
| L10 | Nailed it. | Gelukt! | NL has no bullseye idiom here → plain *Gelukt!*; the anti-climax carries it. |
| L11 | `{n}%` of your crate is jazz you bought to look smart. It worked. | `{n}%` van je krat is jazz die je kocht om indruk te maken. Het werkt. | Per §9, soften "look smart" → *om indruk te maken* (impress). |
| L12 | 1 jazz record you bought to look smart | 1 jazzplaat die je kocht om indruk te maken | As L11. |
| L13 | You just made `{artist}` your most-cataloged artist. Nice. | Je maakte zojuist van `{artist}` je meest gecatalogiseerde artiest. Mooi. | Deadpan *Mooi.* |
| L14 | Ten in one day. Your wallet's on a break. | Tien op één dag. Je portemonnee staat op pauze. | *staat op pauze*. |
| L15 | Your notes say: "{notes}". | Je notities zeggen: "{notes}". | Travels; data flag only (req §11.7). |

Clean-travel in nl: the §11.8 list with no changes needed.

### 11.3 pt-BR

Register per §9: warm, *você*, self-deprecating; playful idioms land well.

| Id | EN (master) | PT-BR (native) | Validation note |
| --- | --- | --- | --- |
| L1 | You added `{n}` records in one day. Your delivery person knows your name. | Você adicionou `{n}` discos em um dia. O carteiro já sabe seu nome. | *carteiro* classic; *entregador* modern alternative. |
| L2 | You'd trade a couch for a first edition. Priorities. | Você trocaria um sofá por uma primeira edição. Prioridades. | Natural. |
| L3 | You own `{n}/{n}` by `{artist}`. Hunt the rest. | Você tem `{n}/{n}` de `{artist}`. Vá caçar o resto. | Natural. |
| L4 | Your shelf is a gym membership for your brain. | Sua estante é uma academia para o seu cérebro. | *academia* — the pay-and-never-go gag is very BR. |
| L5 | Your shelf reads like a syllabus for a degree you never finished — in a good way. | Sua estante parece a grade curricular de um curso que você nunca terminou — no bom sentido. | *grade curricular* is the natural BR term. |
| L6 | You buy records the way other people buy groceries — weekly, and always more than you planned. | Você compra discos como quem faz a feira — toda semana, e sempre mais do que planejou. | *fazer a feira* = weekly market run — very BR and warm. |
| L7 | Twenty-five books. Somewhere, a TBR pile is jealous. | Vinte e cinco livros. Em algum lugar, uma pilha de leitura está com inveja. | **"TBR" → *pilha de leitura*** (the standard BR reading-community term). |
| L8 | Five decades in one crate. History buff. | Cinco décadas em uma caixa. Rato de história. | *rato de X* = passionate about X — BR idiom. |
| L9 | `{artist}` complete. We heard the completionist choir. | `{artist}` completo. A gente ouviu o coro dos completistas. | *a gente ouviu* casual register; *completista* works. |
| L10 | Nailed it. | Na mosca! | Bullseye idiom, perfect. |
| L11 | `{n}%` of your crate is jazz you bought to look smart. It worked. | `{n}%` da sua caixa é jazz comprado pra parecer cult. Funcionou. | *pra parecer cult* — BR slang for the intellectual pose. |
| L12 | 1 jazz record you bought to look smart | 1 disco de jazz comprado pra parecer cult | As L11. |
| L13 | You just made `{artist}` your most-cataloged artist. Nice. | Você acabou de fazer do `{artist}` seu artista mais catalogado. Show! | Deadpan *Show!* works. |
| L14 | Ten in one day. Your wallet's on a break. | Dez em um dia. Sua carteira tá de folga. | *de folga* (off work) — very BR. |
| L15 | Your notes say: "{notes}". | Suas notas dizem: "{notes}". | Travels. |

Clean-travel in pt-BR: the §11.8 list with no changes needed.

### 11.4 de

Register per §9: warm but direct; avoid sarcasm that reads as insult; *du*.

| Id | EN (master) | DE (native) | Validation note |
| --- | --- | --- | --- |
| L1 | You added `{n}` records in one day. Your delivery person knows your name. | Du hast `{n}` Platten an einem Tag hinzugefügt. Dein Paketbote kennt deinen Namen. | *Paketbote* (parcel courier) — everyone gets parcels; *Postbote* alternative. |
| L2 | You'd trade a couch for a first edition. Priorities. | Du würdest dein Sofa gegen eine Erstausgabe eintauschen. Prioritäten. | Natural. |
| L3 | You own `{n}/{n}` by `{artist}`. Hunt the rest. | Du hast `{n}/{n}` von `{artist}`. Jag die restlichen. | *jagen* keeps the hunt gag. |
| L4 | Your shelf is a gym membership for your brain. | Dein Regal ist ein Fitnessstudio-Abo für dein Gehirn. | The never-used-gym *Abo* gag is very DE. |
| L5 | Your shelf reads like a syllabus for a degree you never finished — in a good way. | Dein Regal liest sich wie ein Studienplan für einen Abschluss, den du nie gemacht hast — im positiven Sinne. | "syllabus" → *Studienplan* (no exact word); unfinished-degree gag relatable. |
| L6 | You buy records the way other people buy groceries — weekly, and always more than you planned. | Du kaufst Platten wie andere Leute einkaufen gehen — jede Woche, und immer mehr als geplant. | Universal. |
| L7 | Twenty-five books. Somewhere, a TBR pile is jealous. | Fünfundzwanzig Bücher. Irgendwo ist ein Stapel ungelesener Bücher neidisch. | **"TBR" → *Stapel ungelesener Bücher* — DE readers literally use the acronym "SUB"**; a nice wink if kept. |
| L8 | Five decades in one crate. History buff. | Fünf Jahrzehnte in einer Kiste. Geschichtsfan. | *Geschichtsfan* direct. |
| L9 | `{artist}` complete. We heard the completionist choir. | `{artist}` komplett. Wir haben den Chor der Komplettisten gehört. | *Komplettist* is an accepted gamer term in DE. |
| L10 | Nailed it. | Volltreffer. | Bullseye idiom, natural. |
| L11 | `{n}%` of your crate is jazz you bought to look smart. It worked. | `{n}%` deiner Kiste ist Jazz, den du gekauft hast, um klug zu wirken. Hat funktioniert. | Per §9, soften "look smart" → *um klug zu wirken* (avoid mocky *schlau tun*). |
| L12 | 1 jazz record you bought to look smart | 1 Jazzplatte, gekauft um klug zu wirken | As L11. |
| L13 | You just made `{artist}` your most-cataloged artist. Nice. | Du hast `{artist}` gerade zu deinem meistkatalogisierten Künstler gemacht. Schön. | Deadpan *Schön.* |
| L14 | Ten in one day. Your wallet's on a break. | Zehn an einem Tag. Dein Geldbeutel macht Pause. | *macht Pause*. |
| L15 | Your notes say: "{notes}". | Deine Notizen sagen: "{notes}". | Travels. |

Clean-travel in de: the §11.8 list with no changes needed.

### 11.5 es

Register per §9: warm, *tú*; note Spain vs LatAm variants where they differ.

| Id | EN (master) | ES (native) | Validation note |
| --- | --- | --- | --- |
| L1 | You added `{n}` records in one day. Your delivery person knows your name. | Añadiste `{n}` discos en un día. El cartero ya sabe tu nombre. | *cartero* universal. |
| L2 | You'd trade a couch for a first edition. Priorities. | Cambiarías un sofá por una primera edición. Prioridades. | Natural. |
| L3 | You own `{n}/{n}` by `{artist}`. Hunt the rest. | Tienes `{n}/{n}` de `{artist}`. Ve a por el resto. | "a por" is Spain; LatAm *Ve por el resto*. |
| L4 | Your shelf is a gym membership for your brain. | Tu estante es un gimnasio para tu cerebro. | The never-used-gym gag is universal in ES. |
| L5 | Your shelf reads like a syllabus for a degree you never finished — in a good way. | Tu estante parece un programa de estudios para una carrera que nunca terminaste — en el buen sentido. | *programa de estudios* natural. |
| L6 | You buy records the way other people buy groceries — weekly, and always more than you planned. | Compras discos como otros hacen la compra — cada semana, y siempre más de lo previsto. | Spain *hacer la compra*; LatAm *hacer el súper*. |
| L7 | Twenty-five books. Somewhere, a TBR pile is jealous. | Veinticinco libros. En algún lugar, una pila de pendientes está celosa. | **"TBR" → *pendientes*** (reading-community term for the to-read pile). |
| L8 | Five decades in one crate. History buff. | Cinco décadas en una caja. Friki de la historia. | Playful; LatAm safer *amante de la historia*. |
| L9 | `{artist}` complete. We heard the completionist choir. | `{artist}` completo. Hemos oído el coro de los completistas. | *completista* works (gaming). |
| L10 | Nailed it. | ¡En el clavo! | Bullseye idiom. |
| L11 | `{n}%` of your crate is jazz you bought to look smart. It worked. | El `{n}%` de tu caja es jazz que compraste para parecer culto. Funcionó. | Per §9, soften "smart" → *parecer culto*. |
| L12 | 1 jazz record you bought to look smart | 1 disco de jazz comprado para parecer culto | As L11. |
| L13 | You just made `{artist}` your most-cataloged artist. Nice. | Acabas de convertir a `{artist}` en tu artista más catalogado. Bonito. | Dry *Bonito.* (Spain *Mola.* alternative). |
| L14 | Ten in one day. Your wallet's on a break. | Diez en un día. Tu cartera está de descanso. | *de descanso*. |
| L15 | Your notes say: "{notes}". | Tus notas dicen: "{notes}". | Travels. |

Clean-travel in es: the §11.8 list with no changes needed.

### 11.6 it

Register per §9: warm, self-deprecating, expressive; *tu*.

| Id | EN (master) | IT (native) | Validation note |
| --- | --- | --- | --- |
| L1 | You added `{n}` records in one day. Your delivery person knows your name. | Hai aggiunto `{n}` dischi in un giorno. Il postino ormai ti conosce. | *postino* classic — warm via the film *Il Postino*. |
| L2 | You'd trade a couch for a first edition. Priorities. | Scambieresti un divano per una prima edizione. Priorità. | Natural. |
| L3 | You own `{n}/{n}` by `{artist}`. Hunt the rest. | Hai `{n}/{n}` di `{artist}`. Vai a caccia del resto. | Hunting gag travels. |
| L4 | Your shelf is a gym membership for your brain. | Il tuo scaffale è un abbonamento in palestra per il cervello. | Unused-gym gag universal in IT. |
| L5 | Your shelf reads like a syllabus for a degree you never finished — in a good way. | Il tuo scaffale sembra il programma di studi di una laurea che non hai mai finito — nel senso buono. | *programma di studi* natural; unfinished-laurea gag relatable. |
| L6 | You buy records the way other people buy groceries — weekly, and always more than you planned. | Compri dischi come gli altri fanno la spesa — ogni settimana, e sempre più del previsto. | Universal. |
| L7 | Twenty-five books. Somewhere, a TBR pile is jealous. | Venticinque libri. Da qualche parte, una pila di libri da leggere è gelosa. | **"TBR" → *pila di libri da leggere*** ("TBR" is used, but native is safer). |
| L8 | Five decades in one crate. History buff. | Cinque decenni in una cassa. Appassionato di storia. | Direct; *secchione di storia* is harsher — keep warm. |
| L9 | `{artist}` complete. We heard the completionist choir. | `{artist}` completo. Abbiamo sentito il coro dei completisti. | *completista* works (gaming). |
| L10 | Nailed it. | Centrato! | Bullseye. |
| L11 | `{n}%` of your crate is jazz you bought to look smart. It worked. | Il `{n}%` della tua cassa è jazz comprato per fare scena. Ha funzionato. | Per §9, soften "look smart" → *per fare scena*. |
| L12 | 1 jazz record you bought to look smart | 1 disco jazz comprato per fare scena | As L11. |
| L13 | You just made `{artist}` your most-cataloged artist. Nice. | Hai appena reso `{artist}` il tuo artista più catalogato. Bello. | Dry *Bello.* |
| L14 | Ten in one day. Your wallet's on a break. | Dieci in un giorno. Il tuo portafoglio è in pausa. | *in pausa*. |
| L15 | Your notes say: "{notes}". | Le tue note dicono: "{notes}". | Travels. |

Clean-travel in it: the §11.8 list with no changes needed.

### 11.7 Names (persona archetypes + levels) — per-locale adaptation

Policy (§9): keep EN persona names on the **share-card headline** (a brand/game
moment, consistent with "Arcade"); localize the in-app verdict + stats. Where a
name has no good translation, use a short evocative local equivalent.

**Records archetypes:**

| EN | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- |
| The Crate Digger | Le Fouilleur de bacs | De Kratduiker | O Caçador de Discos | Der Kistenwühler | El Buscador de Discos | Il Cacciatore di Vinili |
| The Time Traveler | Le Voyageur du temps | De Tijdreiziger | O Viajante do Tempo | Der Zeitreisende | El Viajero del Tiempo | Il Viaggiatore del Tempo |
| The Genre Tourist | Le Touriste des genres | De Genrereiziger | O Turista de Gêneros | Der Genre-Tourist | El Turista de Géneros | Il Turista dei Generi |
| The Completist | Le Complétiste | De Completist | O Completista | Der Komplettist | El Completista | Il Completista |
| The Impulse Buyer | L'Acheteur impulsif | De Impulsaankoper | O Comprador Impulsivo | Der Impulskäufer | El Comprador Impulsivo | L'Acquirente Impulsivo |
| The One-Timer | Le Fan d'un seul | De Eenmalige | O Fã de um Só | Der Eine-Platten-Fan | El Fan de un Solo Disco | Il Fan di un Solo Disco |
| The Variant Collector | Le Collectionneur de variantes | De Variantenverzamelaar | O Colecionador de Variantes | Der Variantensammler | El Coleccionista de Variantes | Il Collezionista di Varianti |
| The Sophisticate | L'Esthète | De Fijnproever | O Sofisticado | Der Feingeist | El Sofisticado | L'Esteta |

**Books archetypes:**

| EN | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- |
| The Couch Intellectual | L'Intello de canapé | De Bankdenker | O Intelectual de Sofá | Der Sofa-Intellektuelle | El Intelectual de Sofá | L'Intellettuale da Divano |
| The Series Starter | Le Démarreur de séries | De Seriesstarter | O Iniciador de Séries | Der Serienstarter | El Iniciador de Series | L'Iniziatore di Serie |
| The Genre Hedonist | L'Hédoniste des genres | De Genrehedonist | O Hedonista de Gêneros | Der Genre-Hedonist | El Hedonista de Géneros | L'Edonista dei Generi |
| The Page Counter | Le Compteur de pages | De Paginateller | O Contador de Páginas | Der Seitenzähler | El Contador de Páginas | Il Contapagine |
| The One-Series Wonder | Le Fan d'une seule série | De Eénserie-Fan | O Fã de Uma Série Só | Der Eine-Serie-Fan | El Fan de Una Sola Serie | Il Fan di Una Sola Serie |
| The First-Edition Idealist | L'Idéaliste des premières éditions | De Idealist van de eerste druk | O Idealista das Primeiras Edições | Der Erstausgaben-Idealist | El Idealista de las Primeras Ediciones | L'Idealista delle Prime Edizioni |

**Levels (records):**

| EN | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- |
| Crate Sprout | Pousse de bac | Kratspruit | Broto de Caixa | Kisten-Sprössling | Retoño de la Caja | Germoglio di Cassa |
| Crate Nerd | Nerd du bac | Kratnerd | Nerd da Caixa | Kisten-Nerd | Nerd de la Caja | Nerd della Cassa |
| Crate Digger | Fouilleur de bacs | Kratduiker | Caçador de Discos | Kistenwühler | Buscador de Discos | Cacciatore di Vinili |
| Vinyl Sage | Sage du vinyle | Vinylvijsgeer | Sábio do Vinil | Vinyl-Weiser | Sabio del Vinilo | Saggio del Vinile |
| Crate Deity | Divinité du bac | Kratgod | Divindade da Caixa | Kisten-Gottheit | Deidad de la Caja | Divinità della Cassa |

**Levels (books):**

| EN | fr | nl | pt-BR | de | es | it |
| --- | --- | --- | --- | --- | --- | --- |
| Page Turner | Tourneur de pages | Pageturner | Devora-Livros | Seitenverschlinger | Devorador de Páginas | Divora-Pagine |
| Shelf Stacker | Empileur d'étagères | Plankenstapelaar | Empilhador de Estantes | Regal-Stapelmeister | Apilador de Estantes | Impilatore di Scaffali |
| Bookworm | Rat de bibliothèque | Boekenwurm | Rato de Biblioteca | Bücherwurm | Comeletras | Topo di Biblioteca |
| Literary Cartographer | Cartographe littéraire | Literair Cartograaf | Cartógrafo Literário | Literatur-Kartograf | Cartógrafo Literario | Cartografo Letterario |
| Shelf Sovereign | Souverain de l'étagère | Plankenvorst | Soberano da Estante | Regal-Souverän | Soberano del Estante | Sovrano dello Scaffale |

Notes: FR (*rat de bibliothèque*) and IT (*topo di biblioteca*) use natural animal
idioms for "Bookworm"; DE (*Bücherwurm*) and NL (*Boekenwurm*) are exact
matches. "Crate Digger" has a real record-shop verb in DE (*wühlen*) and NL
(*duiken*); BR prefers the hunter frame. Badge/quest names that reuse archetype
names inherit these. Distinct badge names: Sleeve Sleuth → Détective de
pochettes / Hoesdetective / Detetive de Capas / Hüllendetektiv / Detective de
Portadas / Detective delle Copertine · Quiz Whiz → As du quiz / Quizkanon /
Mestre do Quiz / Quiz-Ass / Crac del Quiz / Asso del Quiz · Variant Hoarder →
Entasseur de variantes / Variantenhamsteraar / Acumulador de Variantes /
Variantenhorter / Acumulador de Variantes / Accumulatore di Varianti · Balanced
Diet → Régime équilibré / Gebalanceerd dieet / Dieta Equilibrada / Ausgewogene
Ernährung / Dieta Equilibrada / Dieta Equilibrata · Friend of the Crate → Ami du
bac / Vriend van het krat / Amigo da Caixa / Freund der Kiste / Amigo de la Caja
/ Amico della Cassa.

### 11.8 Validated without change (clean travel, all 6 locales)

These lines carry no US-only reference and their humor (personification of the
collection, self-deprecating buying jokes, short punchlines) lands in fr, nl,
pt-BR, de, es, it as-is. Listed so the native testers know they were reviewed:

- **Persona verdicts:** Time Traveler, Genre Tourist, Completist, One-Timer,
  Variant Collector (records); Series Starter, Genre Hedonist, One-Series Wonder
  (books); fallback "still young — and already talking".
- **Quiz:** "You remembered. The crate is proud." · "Correct. Your collection is
  impressed, and it's hard to impress." · "The vinyl heard." · "To be fair,
  `{title}` has been hiding behind `{otherTitle}` for a while." · "Not quite. But
  now you'll never forget you own `{title}` again."
- **Streak:** "`{n}`-day streak. Don't make the crate sad tomorrow." · "Perfect
  round!…" (personification is gentle enough for NL/DE).
- **Quest-complete toasts:** incl. "one (1) warm feeling" — keep the "(1)"
  enumeration gag in every locale.
- **Quests:** decade Gap, same-artist blind spots, Variant Shelf, lend, return,
  notes, recent-you-forgot — soften "Fix that." per locale: FR "Règle ça." · NL
  "Los dat op." · PT "Resolve isso." · DE "Hol das nach." · ES "Arrégialo." · IT
  "Sistemalo."
- **Badges:** digger, genre-tourist, sleeve-sleuth, balanced-diet, one-timer,
  variant-hoarder, friend-of-crate, quiz-whiz.
- **Level toasts:** "…salutes you." / "…rearranges itself in your honor."
- **Fun facts:** spans / golden year / pages / this-month.
- **Share cards + taglines** (short, no reference to localize).

### 11.9 Remaining `[VALIDATE]` flags + copy risks for later phases

| Flag | Why it stays open / risk | Owner |
| --- | --- | --- |
| `badge.impulseBuyer` unlock "10 added in a day" | Not humor — data feasibility (event log vs `dateAdded` bucketing). Keep `[VALIDATE]`. | Netlify Backend / product |
| "Your notes say…" (quiz miss) | The *sentence* is validated (L15); whether notes are present in the client model stays open. | Front End Developer (req §11.7) |
| Archetype / level **names** | Adaptations recommended (§11.7); final sign-off by native testers before they ship outside EN. EN names stay on share cards. | Native testers |
| Fun-fact kind mismatch | "That's `{n}` records added this month. **The shelf** is thriving." — for records it must read *crate*; needs `{collectionLabel}` parameterization (copy bug, not humor). | Front End Developer |
| "TBR" (L7) | Must ship the localized "to-read pile" form in every locale; never the acronym. | i18n handoff |

**Copy risks for later phases:** the time-machine "…called, it wants its shelf
back" gag is the most culturally-anchored of the clean lines — it translates
literally in all six but should be re-checked in real usage. Locking persona
names to EN on share cards is a brand decision to fix early (affects the SVG
render + i18n). Keep or drop the "(1)" enumeration gag consistently across
locales.
