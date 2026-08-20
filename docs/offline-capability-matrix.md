# Offline Capability Matrix & Collector UX

**Issue:** #159 · **Milestone:** M2 Collector Core Experience · **Priority:** P0
**Owners:** OFFLINE (lead) + COLLECTOR UX input · **Relates:** ADR-0019, ADR-0016, #289, #292

This document defines how offline behavior is **explicit, predictable and
understandable** for every collector-facing capability, and the UX states the
app must render so a user always knows whether an action was saved locally,
queued, synchronized, or needs attention. It is the product contract for the
M2 offline collector journey.

---

## 1. Capability states (the vocabulary)

Every capability falls into exactly one of these five states:

| State | Meaning | Example UX |
| --- | --- | --- |
| **Available offline** | Works fully with no network (local data or on-device logic) | Browse the synchronized collection, scan a barcode |
| **Available offline and queued** | The action is saved locally and will be pushed to the server when connectivity returns | Add/edit/delete an item while offline |
| **Read-only from cached data** | You can view cached data but cannot change it offline | Inspect an item already synchronized to the mirror |
| **Requires internet** | Cannot run without a live connection | Registration, payment, uncached external lookup |
| **Requires current authorization** | Must re-verify authorization with the server — cached trust never extends forever | Security administration, session revocation |

> **Fail-closed invariant (ADR-0016 rule 12):** no offline action silently
> discards a user mutation, and no failed **online** action ever silently
> becomes an **untracked** local mutation. If an online action fails, the app
> either (a) retries the network path, or (b) only queues a **tracked** local
> mutation through the outbox — never a silent, invisible one.

---

## 2. M2 required offline capabilities

| Capability | State | Notes |
| --- | --- | --- |
| Browse synchronized collection | **Available offline** | Reads the IndexedDB mirror (#289 `readMirror`) |
| Search / filter / group over approved local data | **Available offline** | Runs over the mirror's cached item list (#289) |
| Scan barcode (decode) | **Available offline** | Decoding is on-device (zxing-wasm) |
| OCR cover scan | **Available offline** | OCR runs on-device; the network is only needed for the follow-up lookup |
| Identify from approved cached/local metadata | **Available offline** | Matches candidates against the local mirror + cached provider metadata |
| Add / edit / delete supported collection items | **Available offline and queued** | Mutation is queued locally and pushed on reconnect (#292 outbox) |
| Queue mutations for synchronization | **Available offline** | Durable outbox records with deterministic operation IDs (#292) |

### M2 mutation policy (ADR-0019 Decision 8 — minimal conflict matrix)

| Mutation | M2 policy |
| --- | --- |
| Item add | Queued as new record; idempotent by operation ID |
| Item edit (non-conflict-sensitive fields, e.g. notes) | Pushed last-write-wins on those fields; conflicts surfaced, never dropped |
| Item edit (authoritative/enrichment fields) | Not silently overwritten; server re-authorizes and merges |
| Item delete | Durable outbox op + server authorization; rejected deletes surfaced |

Anything **outside** this matrix is surfaced to the user (fail-closed) — never
pushed speculatively and never dropped silently.

---

## 3. Online-only examples

| Capability | Why online-only |
| --- | --- |
| Registration / password reset | Requires server account lifecycle + live authorization |
| Payment / subscription changes | Requires live checkout + server state |
| Uncached external catalogue searches | Provider access requires the network (#292 keeps the browser from being a generic proxy) |
| Security administration / session revocation | **Requires current authorization** — cached trust never extends forever |
| The server-side synchronization service itself | Runs server-side, not on the device |

These must **fail clearly and safely** when the user attempts them offline
(see §5, "Requires internet / authorization" UX).

---

## 4. UX state requirements

Offline is a **normal application state, not an error screen** (ADR-0016 UX
requirements). The UI must make these states visible:

| State | What the user sees |
| --- | --- |
| **Offline** | A clear "you're offline" indicator (M1 `OnlineIndicator`) |
| **Showing offline copy** | "Showing your saved collection (offline copy) — synced {time}" (`offline.mirrorCopy`) |
| **Pending (queued)** | "N change(s) saved on this device, waiting to sync" — explains the action is queued |
| **Synchronized** | "All changes synced" |
| **Conflict / error** | A clear "some changes couldn't sync" state with **safe** details |
| **Requires internet / authorization** | A clear "this needs a connection / can't be done offline" message |

### UX rules

1. **Explain when an action is queued.** If the user adds/edits/deletes while
   offline, tell them it's saved on this device and will sync when they're
   back online — never leave them wondering whether it "took".
2. **Manual sync control where appropriate.** Provide a "Sync now" control so
   the user isn't stuck waiting for the automatic reconnect.
3. **Safe sync error details.** Show a *generic, human* explanation of why a
   sync failed. **Never** surface tokens, access codes, bearer credentials, raw
   private collection contents, or internal error strings.
4. **Local-data management / reset per security policy.** Let the user clear
   their offline copy from this device (sign-out-style invalidation) in
   Settings, per the approved security policy.
5. **No silent fallback.** A failed online action must never silently create an
   untracked local mutation (see fail-closed invariant in §1).

---

## 5. Security constraints (ADR-0019 Decision 12, mandatory)

- Sync/error messages and telemetry **must not leak** secrets, tokens, access
  codes, or raw private collection contents.
- **Audit-trail carve-out:** `userId` is allowed in security **audit** logs
  only; it is excluded from metrics/analytics telemetry.
- Error detail text rendered to the user must be a safe, generic message, not
  the raw exception.
- Local data is scoped per authenticated user/tenant/device; clearing offline
  data must only remove the signed-in user's records (`clearMirrorForUser`).

---

## 6. Acceptance mapping

| Acceptance criterion | Where it's satisfied |
| --- | --- |
| User can tell whether an action was saved locally | Queued/saved-on-device state + offline-copy indicator |
| Online-only actions fail clearly and safely | "Requires internet / authorization" state, safe wording, no secrets |
| Offline state works on macOS / iPhone / iPad | Responsive CSS (thumb-friendly, safe-area insets), tested layouts |
| Translated strings for supported languages | i18n keys shipped in all 8 locales |
| Ergonomics Reviewer signs off critical states | Independent gate (critical offline journey) |
| Offline UX tests cover no-network, reconnect, flaky-network | `sync-status` suite + outbox suite |
