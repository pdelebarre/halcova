# Halcova — landing page copy draft (with UTM links)

**Owner:** Marketing Manager · **Status:** Draft for approval · **Date:** 2026-08-13
**Source:** `copy-kit-halcova.md` §2–§4 (positioning + long description) ·
`campaign-viral-launch.md` §7 (UTM scheme)
**Purpose:** the public landing page (Phase 4 "The Open" gate). EN master;
localized versions after the Halcova name check and per `copy-kit-halcova.md` §7.
**Brand:** Halcova (confirmed 2026-08-13). The code rename is handled by another
agent — this doc is copy only.

**Grounding:** every line maps to real behavior (barcode scan F-01, Discogs
F-02, Google Books F-03, duplicate detection F-07, crate/shelf F-08–F-13,
notes F-15, request access F-21, per-member plans F-24, PWA F-19/F-20). No
invented features, metrics, pricing, or testimonials.

**Do-not-say (always):** no access codes (`RU-…`), no admin/approval
internals, no app-store/pricing claims, no fake testimonials or counts. Public
version of the multi-user flow: *"family and friends can join and keep their
own private crate and shelf."*

---

## 1. SEO & meta (give to the Front End Developer)

- **Page URL:** `[HALCOVA-URL]` (the stable public URL)
- **`<title>`:** `Halcova — Records & Books | Your crate and shelf, cataloged`
- **`<meta name="description">`** (≤160 chars, from `copy-kit-halcova.md` §3):
  `Halcova — scan a barcode, catalog the thing. Your records and books in one app. Never double-buy: it knows what you already own.` (136 chars ✓)
- **`og:title`:** `Halcova — Two loves. One halcova.`
- **`og:description`:** same as meta description
- **`og:image`:** a 1200×630 brand card — dark `#16130F` + gold `#C9A227`, the arch + barcode mark `[VALIDATE: asset]`
- **`theme-color`:** `#16130F`
- **`canonical`:** `[HALCOVA-URL]`
- **Structure for the dev:** hero → pain → how it works → about → access → footer (sections below). Copy is text-only; layout is the Front End Developer's + UI/UX Expert's.

---

## 2. Page copy (EN master)

### 2.1 Hero
- **Wordmark:** HALCOVA (Fraunces, gold on `#16130F`)
- **H1:** Two loves. One halcova.
- **Sub:** Your records and books, in their own halcova.
- **CTA button:** Request access → (scrolls to §2.6 / opens the request-access form)

### 2.2 The pain (why people stop and read)
**Heading:** You've bought this record twice. Be honest.

> The one you pulled off the shelf at the record fair, held up, squinted at —
> and then found, at home, still sealed, from 2019.
>
> And the book: "Do I own this?" → bought it to be safe → it was on your shelf
> the whole time.
>
> Halcova is the thing I built for people like us.

### 2.3 How it works (3 steps)
1. **Scan.** Point your camera at a barcode — the EAN/UPC on a sleeve or the
   ISBN on a cover.
2. **Confirm.** Halcova finds the release on Discogs (records) or the edition
   on Google Books (books). Pick the right one.
3. **Keep.** It's saved to your crate or your shelf, searchable in a tap.

**And the best part:** Halcova remembers what you already own. Before you add
something it tells you whether it's *already in your crate*, a *different
pressing*, or *more by the same artist* — so the "I think I have this" moment
at the used store disappears.

### 2.4 About / features (from `copy-kit-halcova.md` §4)
**Halcova** is for people whose record crate and bookshelf refuse to stay small.

Point your phone at a barcode — the EAN/UPC on a sleeve or the ISBN on a cover —
and Halcova identifies the release or edition instantly. Records come from
Discogs, books from Google Books, so every entry is the real thing with real
metadata: artist, title, year, label or publisher, genre, tracklist or
description.

Halcova remembers what you already own. Before you add something, it tells you
whether you have the exact release, another pressing of the same album, or
other work by the same artist — so the used-store "I think I have this" moment
disappears.

Your collection is organized the way you think about it: **your crate** for
records, **your shelf** for books, in one cozy place. Search, filter, and sort
either one in a tap; add notes on the spot; remove anything with a couple of
taps.

Halcova was built to be shared. Family and friends can join and keep their own
private crate and shelf — no passwords, no app-store downloads. Everything is
stored server-side, so clearing your browser or switching phones doesn't lose a
single record.

It runs entirely in your browser and installs to your home screen like a native
app, opening instantly even on a flaky connection.

**Two loves. One halcova.**

### 2.5 Feature chips (quick-scan row)
- Scan to catalog (EAN/UPC · ISBN)
- Never double-buy
- Your crate + your shelf, one app
- Search · filter · sort · notes
- Family & friends, each their own space
- Runs in your browser · installs to home screen

### 2.6 Access — the CTA
**Heading:** It's open. Request access.

> Halcova opens in waves. Request access and we'll set you up with your own
> crate and shelf — records, books, or both.

- **Form (the app's real request-access flow, F-21):** Name · Email →
  **Request access**
- **After submit:** *"Request sent — we'll approve you and send your sign-in
  code."* (public-safe; no admin internals)
- Small print under the form: *Opening in waves — if the button's closed,
  come back soon.* (honest framing of the approval-gated model)

### 2.7 Footer
- **Proper nouns:** Halcova · Discogs · Google Books
- **Links:** Request access · (privacy note placeholder `[VALIDATE]`)
- **Small print:** *A web app — no app store required. No pricing.*

---

## 3. UTM — ready-to-paste links per channel

> Replace `[HALCOVA-URL]` with the real domain. `utm_campaign` is fixed for the
> launch; `utm_content` = the asset/post slug from the calendar
> (`campaign-viral-launch.md` §6). This lets landing analytics tell every
> source apart (funnel in §7 of the master plan).

**Generic pattern**
`[HALCOVA-URL]/?utm_source=<x|instagram|facebook|whatsapp>&utm_medium=<social|status|chat>&utm_campaign=halcova-launch-2026&utm_content=<asset>`

### Links for the Phase 4 "Open" (Day 14)
| Where | Full link (paste-ready) |
| --- | --- |
| **X — open post** | `[HALCOVA-URL]/?utm_source=x&utm_medium=social&utm_campaign=halcova-launch-2026&utm_content=open-post` |
| **X — pinned** | `[HALCOVA-URL]/?utm_source=x&utm_medium=social&utm_campaign=halcova-launch-2026&utm_content=profile-link` |
| **IG — bio / linktree** | `[HALCOVA-URL]/?utm_source=instagram&utm_medium=social&utm_campaign=halcova-launch-2026&utm_content=linktree` |
| **IG — open reel (V11)** | `[HALCOVA-URL]/?utm_source=instagram&utm_medium=social&utm_campaign=halcova-launch-2026&utm_content=v11-open` |
| **IG — Stories** | `[HALCOVA-URL]/?utm_source=instagram&utm_medium=stories&utm_campaign=halcova-launch-2026&utm_content=story-open` |
| **FB — open post** | `[HALCOVA-URL]/?utm_source=facebook&utm_medium=social&utm_campaign=halcova-launch-2026&utm_content=open-post` |
| **FB — vinyl/book group** | `[HALCOVA-URL]/?utm_source=facebook&utm_medium=social&utm_campaign=halcova-launch-2026&utm_content=group-post` |
| **WhatsApp — 1:1 invite** | `[HALCOVA-URL]/?utm_source=whatsapp&utm_medium=chat&utm_campaign=halcova-launch-2026&utm_content=invite` |
| **WhatsApp — status** | `[HALCOVA-URL]/?utm_source=whatsapp&utm_medium=status&utm_campaign=halcova-launch-2026&utm_content=status-open` |
| **WhatsApp — nudge** | `[HALCOVA-URL]/?utm_source=whatsapp&utm_medium=chat&utm_campaign=halcova-launch-2026&utm_content=nudge` |

### Also used earlier (Phase 3, pre-open — same pattern)
| Where | `utm_content` to use |
| --- | --- |
| Reveal thread (X) | `reveal-thread` |
| Reveal reel (IG, V7) | `v7-reveal` |
| Demo reel (IG, V8/V9/V10) | `v8-demo` / `v9-demo` / `v10-never-rebuy` |
| Challenge (Day 15+) | `v12-challenge` |

### Notes
- **One link per post, one `utm_content` per post.** Don't reuse the same link
  on two channels or the attribution collapses.
- If you use a link-in-bio tool for IG, keep `utm_source=instagram` and set
  `utm_content=linktree` so bio clicks don't muddy the Reel numbers.
- Confirm the landing is tagged for **landing visit → request access →
  approved → first sign-in → first scan** (funnel in `campaign-viral-launch.md`
  §7) before Day 14.

---

## 4. Handoff & flags

**To the Front End Developer**
- Wire the **Request access** form to the app's real request-access flow (F-21)
  — the landing page is the front door, the app is the form.
- Use the hero lockup + brand tokens (`#16130F` bg, `#C9A227` gold, Fraunces)
  and the arch + barcode mark (`marketing/brief-halcova-icon.md`).
- Meta/OG block from §1 goes in `index.html` (app-adjacent markup — confirm with
  the Marketing Manager before changing).

**Claims needing validation `[VALIDATE]`**
- The public URL + `[HALCOVA-URL]` placeholder.
- `og:image` brand card asset.
- Halcova name check green before localized versions ship.
- Privacy note wording for the footer.
