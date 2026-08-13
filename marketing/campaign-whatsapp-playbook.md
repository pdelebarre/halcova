# WhatsApp personal playbook — Halcova launch

**Owner:** Marketing Manager + site owner · **Status:** Draft · **Date:** 2026-08-13
**Channel role:** the high-trust, high-conversion channel. It's *personal* —
WhatsApp is where your friends and family already know you. It is **not** a
broadcast channel.

**Non-negotiable rules:**
- **Never mass-broadcast** a list or a group message. Every message is written
  for one person.
- **Access codes are private.** A personal code (`RU-…`) goes in a **1:1 chat
  only** — never in a status, never in a group, never forwarded. Anyone who
  gets a code can sign in to a private collection, so treat codes like keys.
- **No links to codes in public posts** — the public funnel is "request access"
  on the landing page (`campaign-viral-launch.md` §7 R-3).
- **Don't send the same wall of text to everyone.** Short, warm, one question.
- **This is Phase 4.** WhatsApp invites go out when the app is actually open and
  you can approve people. Not before (nothing to sign in to).

**Benefits & humor layer:** lead with *what it does for them* ("you'll stop
buying things twice", "finally know what's on that shelf"), then one warm,
self-deprecating joke — WhatsApp is personal, so this is the friendliest the
voice gets. Situational jokes only (joke bank: `review-benefits-humor.md` §5).
Never joke about features we don't have, and never leak internals — even
privately.

---

## 1. Segment your contacts (do this once, in your head or a private list)

| Segment | Who | Message style |
| --- | --- | --- |
| **A — Collectors** | people you know actually own records and/or books | full invite + personal code + short demo video |
| **B — Likely** | people with a bookshelf or a "someday" crate | invite + code, one story beat ("you told me you had a whole shelf") |
| **C — Connectors** | people who love sharing/like to help | ask them to try it *and* tell one friend; give them a code too |
| **D — Everyone else** | polite acquaintances | a soft status, not a DM — let them come to you |

Start with **A and B** (10–25 people). That's the sweet spot: enough signal,
small enough that you can approve every request and reply to every message.

---

## 2. The sequence (per person, spaced ~2–4 days)

### Step 1 — Warm-up (2–3 days before the invite)
A short, specific opener. Reference *their* collection, not a template.

> Hey [Name]! Random one — you still have that shelf of [books/records] from
> when we [shared memory]? [1 line max]

Or skip the warm-up for very close contacts — go straight to the invite.

### Step 2 — The invite (on "It's open" day, Phase 4)
Personal, 1:1, includes their personal code. **Use the invite copy from
`private-test-invite.md`** (EN master + FR/NL/PT-BR/DE/ES/IT drafts already
written and tested with the private circle). Replace `[URL]`, `[CODE]`,
`[FORM]`, `[Name]`. Add a short voice note or the V8/V9 demo video if they're a
collector — WhatsApp video previews do the selling for you.

Key lines to keep from the tested invite:
- "It catalogs your records and books just by scanning their barcodes."
- "It remembers what you already own, so you never double-buy."
- "Here's your personal sign-in code: [CODE]"
- "Open the link, sign in, tap the big button, scan one of yours."

### Step 3 — Gentle follow-up (only if silent, ~2–3 days later)
One question, no guilt:

> No rush — but did you get a chance to try the [record/book] scan? Curious if
> it worked on your end. 👀

### Step 4 — The "seen it?" nudge (1 week later)
If they've signed in and added a few items — thank them and invite one small
action:
> You've added [n] already?? 🎉 Try searching your crate — it filters by genre,
> artist, format. Go on, find the record you forgot you owned.

If they haven't signed in: let it go. WhatsApp is personal; one gentle nudge is
the max. Don't chase.

---

## 3. Statuses (the quiet multiplier)

Statuses are seen by your whole contact list *without* a message. Use them
sparingly and **never with a code**:

- **Phase 1–2 (teaser):** post the V1/V4 teasers to status — no name, no link.
  It plants the seed with the D segment who never gets a DM.
- **Phase 3 (reveal):** one status with V7 (name reveal) + caption "something I
  built 🏛️". If a contact *replies* to the status → that's your opening to DM
  them a personal invite (they self-qualified).
- **Phase 4 (open):** one status: "It's open. Message me if you want in. (Yes,
  it stops you buying the same record twice.)" — the word "message me" routes
  them into a 1:1 where a code is safe to share.
- **Phase 5 (loop):** occasionally a real user's "look what I cataloged" clip
  (permissioned) — social proof, no ask.

Status = a door. A DM = the invite. Never put the key (code) on the door.

---

## 4. What to send when (templates — fill the brackets)

**Collector invite (Segment A):**
> Hey [Name] — I built this little app called **Halcova**. You point your phone
> at a record sleeve (or book cover), it scans the barcode and catalogues it —
> and it remembers what you already own, so you stop buying things twice.
> (Finally, something that knows your crate better than you do. Built it for
> people like us — I'm the worst offender.) 😅
>
> You're on my short list — here's your personal code: [CODE]
>
> Try it: [URL]
> 1. Open the link
> 2. Sign in with your code
> 3. Tap Scan and try it on one of yours
>
> I'd love your honest take. [FORM if the feedback form is still open]

**Connector (Segment C) — add one line:**
> And if you know someone who'd love this (you have that friend with the wall
> of records 👀), tell them to message me and I'll set them up.

**Status-only (Segment D), Phase 4:**
> Something I've been building for a while just opened. Message me if you want
> in. 🏛️

---

## 5. Your admin workload (plan for it)

- Every invite needs a **code generated in the admin panel** and the right
  **Records and/or Books** plan granted (F-23/F-24). Generate a handful at a
  time, not one-per-message in real time.
- **Wave plan:** approve in 2–3 waves (5–10 people per wave) so a request burst
  never hits you at 11pm. Tell people "opening in waves" only if asked.
- Track who was invited / signed in / active in a private sheet (name, code,
  plan, status). The private-test roster pattern works — see
  `private-test-plan.md` §4.
- **If you're overwhelmed:** pause statuses and new invites, clear the queue,
  then reopen. Better a short pause than a friend left waiting.

---

## 6. Measuring WhatsApp (keep it light)

| Metric | How |
| --- | --- |
| Invites sent / codes generated | your private sheet |
| Activated (signed in with code) | collection API / admin view |
| Cataloged (items added) | admin view — the real signal |
| Returners (week 2) | admin view |
| Referrals ("tell a friend") | ask in the follow-up; count in the sheet |

UTM for any link you paste in chat:
`https://<halcova-domain>/?utm_source=whatsapp&utm_medium=chat&utm_campaign=halcova-launch-2026&utm_content=<invite|status|nudge>`

---

## 7. Do-not-say on WhatsApp too

- No screenshots of the admin panel, no "I have to approve you" mechanics, no
  mention of the admin key or internal store names.
- No "invite everyone you know" phrasing — personal, always.
- If someone shares their code publicly (it happens), the owner can regenerate
  a new code in the admin panel — mention that to the user privately, don't
  post about it.
