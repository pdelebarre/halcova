# ADR-0017: Lookup resilience and provider fallbacks

- **Status:** Accepted
- **Date:** 2026-08-19
- **Related roadmap:** #281 (RES-EPIC-1), #287 (T11); T1–T8 (#284, #288, #283, #291, #290, #285, #293, #286)
- **Supersedes / relates:** builds on ADR-0013 (external provider and cache boundaries) and ADR-0011 (offline-first boundaries and synchronization)

## Context

Catalog lookups depend on third-party providers (Discogs for records, Google
Books for books). Providers are unreliable (5xx, network blips, timeouts),
rate-limited (429), and their payloads are untrusted input. Before this
decision, a single provider outage or an empty result set failed or returned
"no match" for the whole request, and repeated identical empty lookups kept
spending provider quota. Deferred work (enriching a partially-saved item) had
no safe, tenant-isolated completion path.

ADR-0013 established that every provider is reached through a server-side
adapter with validation, caching and provenance. This decision adds the
resilience layer on top: graceful fallback providers, hardened outbound
fetching, negative caching, provider circuit-breaking, and a deferred
enrichment queue.

## Decision

### Fallback providers (T2/T3 — #288/#283)

Every catalog has a tokenless fallback provider behind the primary, resolved
**server-side in a single request**:

- **Records:** Discogs (primary) → **MusicBrainz** (+ Cover Art Archive cover
  URLs) fallback.
- **Books:** Google Books (primary) → **OpenLibrary** (covers via
  `covers.openlibrary.org`) fallback.

Each fallback adapter (`netlify/functions/_shared/providers/musicbrainz.js`,
`openlibrary.js`) normalizes the foreign payload into the **same envelope**
the primary client already consumes (`{ results:[...] }` for records,
`{ items:[...] }` for books), marks every hit with `source:'musicbrainz'` /
`source:'openlibrary'` plus the additive id (`mbid` / `openLibraryId`), and
leaves the primary id (`discogsId` / `googleBooksId`) **null** on fallback
hits. A fallback hit is therefore indistinguishable to the frontend from a
primary hit except for its provenance marker.

Fallback fires on a genuine primary **service error** (5xx/network/timeout —
never an auth/token or rate-limit code) or a **healthy-empty** result set.
`NO_FALLBACK_CODES` (BAD_TOKEN / SERVER_NO_TOKEN / PROVIDER_RATE_LIMIT /
RATE_LIMIT) short-circuit **without** falling back and **without** arming the
circuit breaker: an operator/token problem or a rate limit must not be masked
by silently routing to a fallback, nor pile extra load onto it.

### Shared fetch-retry, SSRF-safe (T1 — #284)

All outbound lookups go through one shared helper
(`netlify/functions/_shared/lookup-fetch.js`) so the proxies cannot drift:

- retries only `429`/`5xx`/network failures (never 4xx/3xx);
- honors a **bounded** `Retry-After` + full-jitter exponential backoff;
- enforces a per-attempt timeout (3s) and an overall 8s deadline
  (< the 8.5s platform cap);
- **always** sets `redirect:'manual'` (never follows redirects) — SSRF
  control, immutable per attempt;
- fixed allowlisted hosts only; user input rides only as encoded query/path
  values, never as the connect host or path.

### Negative caching (T4 — #291)

A **healthy-empty** provider result (200 + zero results) is cached under
`(provider, key)` as a frozen `EMPTY_SENTINEL = { empty:true }` — a shape that
can never collide with a real `{ results }` / `{ items }` envelope — with a
**shorter** TTL than the positive cache (barcode/ISBN 1 day, text `q` 6 hours).
The lookup chain treats a negative-cached key as "no match here", skips the
empty primary call, and falls through to the fallback. The sentinel is
**never** returned to a client as a real payload (defense-in-depth: a mixed
store is surfaced as a healthy-empty envelope).

### Provider circuit breaker (T4 — #291)

A genuine provider-down outcome arms a **~60s cooldown** in a **separate**
`runout-provider-state` Blob store (`provider-state.js`). Cooldown state is
**never** written into the long-lived (30-day) `lookup_cache`, so a 30-day
"provider is down" mark (a classic cache-poisoning bug) is impossible. While a
provider is in cooldown the chain skips it and goes straight to the fallback.
Reads/writes are best-effort and never fail a valid lookup.

### Deferred-enrichment queue + drain (T6 — #285)

An item saved with partial metadata can be completed asynchronously:

- `enqueue` records a deferred lookup against a **server/service-identity**
  queue (`lookup_queue` Postgres table via `lookup-queue-repo.js`, or the
  `runout-lookup-queue` Blobs store via `lookup-queue-store.js`), idempotent by
  a stable row id (re-enqueue of the same lookup+item is an upsert).
- A scheduled **`@hourly` drain** (`netlify/functions/lookup-queue-drain.js`)
  iterates tenants **one at a time**, re-runs the lookup through the same
  SSRF-safe fixed-host helper, and **idempotently merges only missing fields**
  (`mergeFields`) — never clobbering a user's edits — then stamps `enrichedAt`
  and clears `metadataPending`.
- Abandon/back-off: exponential `next_at`, abandon after 5 attempts / 7 days,
  never retry a permanent failure more than once.
- **Tenant isolation:** every queue op is `user_id`-scoped; the matching RLS
  policy (`db/rls/009_lookup_queue_rls.sql`) enforces the boundary at the DB
  layer too. The queue is never echoed to a client — the drain returns only a
  counter summary (`processed/enriched/failed/abandoned`).

### Client orchestration (T7 — #293)

The browser opens a **single** endpoint call per lookup: the server already
resolves primary → fallback and marks the winner in a top-level `source`.
`src/api/lookupChain.js` (pure, dependency-free) walks the ordered provider
list and returns the first healthy hit, surfacing `NO_MATCH` (all healthy-empty)
vs `ALL_PROVIDERS_FAILED` (all errored, distinct from a single-provider
`HTTP_ERROR`). `src/hooks/useLookup.js` drives every call site through that
chain with one memoized server promise (no extra network fetches) plus an
on-device OCR fallback (`runOcr`, T8) for covers.

### Offline mirror/outbox posture

The lookup resilience layer does **not** introduce a client-side offline
mirror or mutation outbox. The `lookup_queue` is a **server-side, service-
identity** enrichment queue, not a client outbox, and the shared `lookup_cache`
is a shared dedup cache, not a mirror of private user data. The PWA caches
only the shell and the lookup/cover proxies (NetworkFirst/CacheFirst), never
user-scoped endpoints. A future offline collection mirror / mutation outbox
remains an **M2 offline-strategy item** governed by ADR-0011: operation queue
with client-generated operation IDs, server-side idempotency, re-authorization
on submit, no access codes/tokens/provider secrets in queues, and user-scoped
local data keyed per user and cleared on sign-out/switch (see
`src/utils/offline-isolation.test.js` for the invariant).

## Security

- **SSRF:** `redirect:'manual'` on every outbound fetch (lookups and covers),
  fixed allowlisted hosts, and provider payloads capped before parse/cache.
  See the SSRF regression suites (`discogs.test.js`, `books.test.js`,
  `providers/*.test.js`, `cover-action.test.js`).
- **Cache poisoning:** the `EMPTY_SENTINEL` can never shadow a real result
  (frozen distinct shape, shorter TTL, never returned raw); circuit-breaker
  cooldown lives in a separate store and never poisons the 30d cache.
- **Tenant isolation:** the drain is service-identity, iterates tenants one at
  a time, and every queue/merge op is owner-scoped, with matching RLS.
- **Information disclosure:** `safeError` never surfaces internals; the queue
  and its payloads are never echoed to a client.

## Consequences

Positive: single-provider outages degrade to a working fallback; repeated empty
lookups stop spending provider quota; down providers are skipped briefly
without long-lived poisoning; partial saves complete asynchronously and
idempotently; the client contract (`NO_MATCH` vs `ALL_PROVIDERS_FAILED`) is
stable and machine-readable.

Negative: two provider integrations per catalog must be maintained; fallback
hits carry no primary id (detail views remain primary-only); the @hourly drain
adds an operational surface (monitored via its counter summary); tokenless
fallbacks are rate-throttled (~1 req/s in-process) and must not absorb abuse.
