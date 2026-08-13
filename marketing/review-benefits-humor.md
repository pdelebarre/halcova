# Marketing review — benefits-first + humor layer

**Owner:** Marketing Manager · **Date:** 2026-08-13 · **Status:** Ready to use
**Applies to:** the Halcova launch set — `copy-kit-halcova.md`,
`campaign-viral-launch.md`, `campaign-copy-bank.md`, `campaign-landing-page.md`,
`campaign-picsart-video-spec.md`, `campaign-whatsapp-playbook.md`,
`private-test-invite.md`.

**Grounding:** every benefit and every joke below traces to real product
behavior (feature IDs `F-01…F-25` in `docs/functional.md`). No invented
features, metrics, pricing, or testimonials. Anything needing a native pass or
product/legal sign-off is marked `[VALIDATE]`.

---

## 1. What I reviewed

The full launch set is already strong in three ways: it is **grounded** in real
behavior (every post maps to an `F-` feature), it is **pain-first** (the
double-buy confession is relatable and culture-proof), and it has **real
guardrails** (no access codes, no fake testimonials, no pricing claims). The
curiosity structure and UTM funnel are sound. The review below is about two
things you asked for: **making the benefits explicit** and **putting humor into
the productions** — not about redoing what works.

## 2. The two gaps I found

1. **Benefits are implied, not headline-led.** The copy sells the *pain* and
   the *feature* ("it scans barcodes", "it remembers what you own") but rarely
   lands the *benefit* — *what you get out of it* ("catalog your crate in an
   afternoon", "never waste money on a double-buy again", "one app instead of
   two piles of guilt"). The landing page's "features" section and several
   Phase 3–4 posts read as spec sheets, not as "here's what this does for you."
2. **Humor exists but is thin and front-loaded.** The Phase 1 riddles
   (double-buy confession, "I built something for people like us") carry the
   only humor, and it fades after the reveal — precisely when the product is on
   screen. The **video productions** (V1–V14) have almost no comedic beats on
   screen, and the landing page and WhatsApp templates are dry. Humor is a
   retention and share driver for this audience (collectors love in-jokes about
   their own hoarding), so it should run the whole funnel, not just the teaser.

## 3. What I changed (summary)

| File | Change |
| --- | --- |
| **This doc** | The review + the reusable **benefit bank** (§4) and **humor layer** (§5) that the edits below draw from |
| `copy-kit-halcova.md` | Added §9 "Benefit bank" and §10 "Voice & humor guidelines"; retuned the one-liner and long description to lead with benefits and a wry line |
| `campaign-copy-bank.md` | Added a "Benefits-first & humor layer" section; retuned key posts (reveal, never-double-buy, open, challenge) to lead with a benefit + a joke |
| `campaign-landing-page.md` | Reframed the pain section into pain→benefit; converted the "features" section to benefits; added a benefit chips row and light humor |
| `campaign-picsart-video-spec.md` | Added benefit + humor beats to V8/V9/V10/V11/V12 storyboards and a "benefits & humor on screen" section |
| `campaign-whatsapp-playbook.md` | Retuned the invite/follow-up templates to lead with the benefit and add a warm joke |

> This is copy-only. If any of it should ship inside the app, it goes through
> the catalog's `.copy` keys (Front End Developer) — not this file.

---

## 4. The benefit bank (feature → benefit → payoff → humor beat)

The one rule for the whole campaign: **say the feature once, sell the benefit
three times.** Every claim maps to a real `F-` feature.

| Feature (real) | Benefit (what you get) | Emotional payoff | Humor beat |
| --- | --- | --- | --- |
| Barcode scan (F-01) | Catalog your crate or shelf in an afternoon, not a weekend | Control | "Beats the spreadsheet you gave up on in 2017." |
| Discogs / Google Books lookup (F-02, F-03) | Every entry is the real thing — artist, year, label, genre — no typos | Accuracy | "It does the boring-but-important data entry so you can keep doing the fun part: buying more." |
| Multi-match picker (F-04) | Pick the exact pressing / edition, not a guess | Precision | "It knows there are 47 pressings of *that* album. It will not let you pick the wrong one." |
| Duplicate detection (F-07) | Never rebuy — the used-store moment disappears | Relief + money saved | "Your wallet's new best friend." / "The record fair's worst nightmare: a customer with a memory." |
| Crate + shelf, one place (F-08–F-13) | Both loves in one cozy place; search/filter/sort in a tap | Order, calm | "One app instead of two piles of guilt." |
| Notes (F-15) | Remember *why* you love it and where it came from | Memory, nostalgia | "Write it down before you forget why you bought it. Again." |
| PWA — no app store (F-19, F-20) | Nothing to download, nothing to update — opens instantly | Frictionless | "No app store, no account forms, no 'update available' tantrums." |
| Family & friends join (F-21–F-25) | Everyone gets their own private crate & shelf — no passwords | Shared, safe | "Your records stay yours, even if your sibling has 'borrowed' a few." |

**Benefit headline formulas to reuse:**
- `Stop [pain]` → **"Stop buying records you already own."**
- `Get [outcome]` → **"Finally know what's in your crate."**
- `Save [resource]` → **"Catalog a whole shelf in an afternoon."**
- `Feel [emotion]` → **"The used-store squint, retired."**

---

## 5. The humor layer (voice guide + joke bank)

### 5.1 Voice: "wry collector, cozy room"

The brand is a dark cozy nook (`#16130F` + gold). The humor should match:
**warm, self-deprecating, collector-culture specific** — we laugh *with* the
collector's hoarding, never at them, and never at competitors or other cultures.

- **Self-deprecating founder voice** (the "I built it for people like us"
  thread) — the founder is the worst offender, so the jokes are confessions.
- **Pain-to-payoff** — every joke should land next to a benefit, not replace it.
- **Dry one-liners** beat puns for translation. If a joke needs a pun or a
  wordplay, it goes `[VALIDATE]` for the native pass and is never the only joke
  in a post.
- **No roasting** — no mean jokes about a specific competitor, artist, book, or
  a user's taste. (Joking that *we* double-buy is fine; mocking someone else's
  shelf is not.)

### 5.2 Joke bank (all grounded in real collector behavior)

| Joke | Why it works | Translation |
| --- | --- | --- |
| "I once bought the same book twice. On purpose, apparently." | Self-deprecation + the universal double-buy | Situation humor — translates |
| "300 records. No idea what I own." | The un-cataloged crate | Translates |
| "The collector's prayer: *do I have this?* (hold up, squint, buy it anyway)" | The record-fair moment, F-07 | Translates |
| "The 'I'll sort it later' shelf has a name now." | The pile everyone has | Translates |
| "Your wallet's new best friend." (for never-double-buy) | Benefit + joke in one | Translates |
| "The record fair's worst nightmare: a customer with a memory." | F-07 as a villain line | Translates |
| "One app instead of two piles of guilt." | Crate + shelf benefit | Translates |
| "No 'update available' tantrums." (for the PWA) | Frictionless install | Requires a light native pass |
| "Your records stay yours, even if your sibling has 'borrowed' a few." | Multi-user (F-24) + family joke | Translates (swap sibling for local family word) |

### 5.3 Humor guardrails (add to the do-not-say list)

- Humor **never implies a fake feature, metric, or testimonial.** A joke about
  "your wallet's best friend" is a benefit line; a joke claiming "users saved
  $X" would be a fake metric — banned.
- Humor **never leaks internals.** No jokes about access codes, admin panels, or
  approval queues, even in private WhatsApp copy.
- **Localize jokes, not just words.** Situational humor (double-buying, sorting
  piles) survives translation; puns don't. Every post that needs humor keeps at
  least one situational joke so the native pass has something safe.

---

## 6. Where the layers land (map)

| Asset | Benefit beat | Humor beat |
| --- | --- | --- |
| Landing hero | "Two loves. One halcova." + sub-line benefit | tagline stays clean; joke lives below the fold |
| Landing "pain" | pain → benefit reframe per item | wry one-liner per pain |
| Landing features | feature → benefit chips | one joke in the "best part" |
| Phase 1 teasers | pain hooks (as today) | double-buy confession jokes |
| Phase 3 reveal (V7) | "scan → cataloged → never rebuy" as benefits | founder confesses own double-buy |
| Phase 3 demos (V8/V9) | "an afternoon, not a weekend" + "knows what you own" | on-screen caption jokes |
| Phase 3 never-double-buy (V10) | "never rebuy" = money + relief | "a customer with a memory" |
| Phase 4 open (V11) | benefit list under the CTA | "your wallet's new best friend" |
| Phase 5 challenge (V12) | UGC = before/after benefit | "show us your halcova" playfulness |
| WhatsApp invite | benefit first ("stops you buying things twice") | the 😅 confession already there — add one wry line |

---

## 7. Claims that still need validation (unchanged from the set)

- Halcova name check green before localized reveals `[VALIDATE]`.
- Trademark/domain/social handles `[VALIDATE]`.
- Any joke sent to FR/NL/PT-BR/DE/ES/IT needs a native pass — situational jokes
  are flagged "safe to translate", puns are flagged "needs native rewrite"
  `[VALIDATE]`.

## 8. Next steps

1. Approve the benefit bank (§4) and humor voice (§5) so every writer/editor
   uses the same layer.
2. Build V10/V11 with the new on-screen humor beats (video spec §3, V10/V11).
3. When localization ships, run the joke bank through native testers — the
   "safe to translate" tags make that fast.
4. Measure whether benefit-led + humor posts lift saves/shares vs the teaser
   baseline (KPIs in `campaign-viral-launch.md` §7) and tune.
