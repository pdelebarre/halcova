# Campaign — "Own it once" (similar-item check launch)

**Owner:** Marketing Manager · **Status:** Draft — **gated on implementation** · **Date:** 2026-08-15
**Brand:** Halcova (public brand; repo package name `runout` is internal — never in public copy)
**Grounding:** every claim traces to `findRelated` + the confirmed similar-item model
(see `docs/similar-item-check-requirements.md`). Feature must ship and copy must match
the implemented levels before any post goes live — see §8 `[VALIDATE]`.

**Core benefit (already in the benefit bank, now sharper):** *never rebuy.* This feature
takes it from "don't buy the exact same record twice" to "don't buy the CD when you own
the LP, the paperback when you own the hardback, or the English copy when you own the
French one."

---

## 1. Positioning

| Element | Copy |
| --- | --- |
| One-liner | Halcova catches the copies you forgot you had — same album on a different format, same book in a different edition or language — before you add it. |
| Problem | You don't just rebuy the same record. You buy the **CD of an LP you own**, the **paperback of a book you own**, the **English edition of a book you already read in French**. |
| Promise | Before anything lands in your crate or shelf, Halcova shows you what you already own that's *like* it — and lets you decide. |
| Payoff | Never double-buy. Finally know what you own. |

## 2. Tagline options (EN master)

1. **"Own it once."** — short, memorable, benefit-first. *(lead)*
2. "The one that got away — already had."
3. "You don't own it twice. Not on our watch."
4. "Same album. Different format. Same you." *(wry, collector humor)*
5. "Your crate remembers. Now it reminds you."

Per-market: keep the *idea* ("own it once") and localize the pun only where the joke
translates cleanly — otherwise use the plain benefit line. `[VALIDATE]` with native
testers per market (existing localization glossary: `localization-dictionary.md`).

## 3. Launch note / release note (ready to localize)

> **Own it once.** Halcova now checks your crate and shelf before you add anything —
> so when you pick up a CD of an album you already have on LP, a new edition of a book
> you own, or a title you've got in another language, it tells you first. You still
> decide: add it anyway, or save the money. Your collection, your call.

(Shorter changelog line — reuse from `handoff-similar-item-copy.md` §6.)

## 4. Social posts (voice: feature once, benefit three times; one wry joke where it fits)

### X / Threads

> You didn't buy the same record twice. You bought the **CD**. Of the LP. You already own.
> 🫣
>
> Halcova now checks your crate before you add — different format, different edition,
> even another language. You decide. We just remind you.
>
> Own it once. #vinyl #vinylcollection

### Instagram / Facebook — carousel (4 slides)

- **Slide 1 (hook):** "The CD you bought. Of the LP you own. Twice-owned, once-removed."
- **Slide 2:** "Crate full of records. Shelf full of books. Two paperbacks of one book."
- **Slide 3:** "Now Halcova checks before you add — same album on another format, same
  book in another edition or language."
- **Slide 4 (CTA):** "Own it once. → Link in bio. #vinylcommunity #bookstagram"

### TikTok / Reels — 15s hook (mirror the PicsArt assets V1–V14 style, brand kit dark `#16130F` + gold)

> **Visual:** pull a CD case out of a crate, slow-zoom to the LP already leaning there.
> **Text on screen:** "Bought the CD. Own the LP." → "Halcova checks first now."
> **VO/CTA:** "Own it once. Follow."

### YouTube Shorts (mirror `campaign-youtube-playbook.md`)

Title: *"I bought the CD of an LP I already owned."* — description: the feature benefit
+ "Own it once." + UTM link. Tags: #vinylcollection #recordcollecting #bookshelf.

### WhatsApp status (personal playbook — codes stay private, never in status)

> "New in Halcova: it checks your crate before you add. Bought the CD of an LP I own —
> it told me first. Own it once."

## 5. International notes (why this lands differently per market)

The **language flag** is the standout feature for multilingual collectors:

| Market | Angle |
| --- | --- |
| NL / BE | Dutch + English + French titles are everywhere — flag "you own this in Dutch already" is a real money-saver. |
| FR | FR + EN books/records; pitch the edition + language check. |
| DE | DE + EN imports; label/pressing awareness resonates with the Discogs-savvy German collector crowd. |
| ES | ES + EN; "otra edición" and "en español" framing. |
| IT | IT + EN; "stessa opera, altra lingua" framing. |
| PT-BR | PT + EN imports; strong book-collector overlap — lead with the books/language angle. |

Tone per market: match existing locale register (informal `tu`/`du`/`je`/`você`, formal
`vous` in FR). Jokes → `[VALIDATE]` per market; benefits translate as-is.

## 6. Calendar (feature-launch sprint, ~7 days)

| Day | Channel | Asset |
| --- | --- | --- |
| D0 (ship) | Changelog / in-app toast copy | Release note (§3) |
| D1 | X + IG story | Hook post + poll: "Own the CD and the LP? (yes / no but close)" |
| D2 | IG/FB carousel | 4 slides (§4) |
| D3 | TikTok/Reels + YT Shorts | 15s "Bought the CD. Own the LP." |
| D4 | WhatsApp status + close-circle | Personal playbook nudge |
| D5 | Blog/landing section | "Own it once" section on the landing page (`campaign-landing-page.md`) |
| D6–D7 | Retarget + measure | Double-down on the format that won (see §7) |

## 7. UTM & KPIs

**UTM base:** `?utm_source={channel}&utm_medium=social&utm_campaign=similar-item-check&utm_content={asset}`
(channels: instagram, facebook, x, tiktok, youtube, whatsapp, blog).

**KPIs (only what we can actually track):**
- **Activation:** share of new items added through a flow that surfaced a similar-item
  banner (feature is being used, not just installed).
- **Engagement:** tap-through on "Other pressings / editions you own" rows.
- **Behavior (proves non-blocking + useful):** % who still add anyway vs % who cancel
  after seeing a similar item — the honest signal that the check informs without nagging.
- **Retention:** day-7 return after the feature launch.
- **Funnel:** install → scan → add → return (existing campaign funnel).

No invented metrics: only events the product already emits (item add, scan, related-row
open — confirm with the Tester which are measurable before quoting numbers).

## 8. Claims needing validation `[VALIDATE]` — gate before posting

1. **Feature live:** nothing ships until the similar-item check is implemented and tested
   (`docs/similar-item-check-requirements.md` §12). Do not announce early.
2. **Language claim:** copy that says "even in another language" is only true for the L4
   (title/series match) case; fully translated titles get the soft "maybe" hint (L4b).
   Phrase posts as "checks … another language" — acceptable, but confirm the L4/L4b
   balance on real data before the EN → localized push.
3. **Non-blocking honesty:** copy says "you still decide" — that matches decision Q2
   (one-tap Add for similar items). If the developer flips to a confirm step, update §3/§4.
4. **Brand gate:** posts use **Halcova**; the Hokan→Halcova rename + legal/domain/icon gate
   must be done (see `marketing/README.md` open items).
5. **Humor/puns:** the "own it once" / "once-removed" lines are EN puns — get native
   `[VALIDATE]` before translating (joke bank rules: `review-benefits-humor.md` §4–§5).

## 9. Do-not-say (unchanged)

No access codes (`RU-…`), no admin/approval internals, no app-store/pricing claims, no
fake testimonials or counts, no internal package/function names (Runout, `findRelated`,
Discogs/Google Books details only as lookup grounding, never implementation).
