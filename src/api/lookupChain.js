// RES-1.7 T7 (#293) — Client lookup orchestration.
//
// Pure, dependency-free orchestrator that walks an ORDERED provider list and
// returns the first healthy hit. It has no knowledge of the network layer or
// the API modules: callers hand it the provider list plus a per-provider
// `lookup(provider, index, providers)` function, and it decides when to fall
// through and what to surface.
//
// Why it stays thin: the server proxy (netlify/functions/discogs.js and
// books.js) ALREADY resolves primary → fallback in a single request and marks
// the winner in the response's top-level `source` (with per-hit
// `mbid`/`openLibraryId` on a fallback win). The browser must not open extra
// network connections, so the real wiring (see src/hooks/useLookup.js) hands
// the chain a `lookup` that returns that ONE server response for every
// provider step — the chain still iterates/derives the provider list (the
// result's `provider` comes from `catalog.providers[attempt]` or the server's
// `source` marker, never hardcoded), but the underlying transport is a single
// endpoint call.
//
// Contract:
//   - Returns  { results, provider, attempts } on the first healthy win.
//     `results` is the server's array (carrying its `.source`/`.outcome`
//     metadata untouched — normalization stays in src/api/*).
//     `provider` is the winning provider name (server `source` marker when
//     present, else the attempted provider).
//     `attempts` is the ordered list of providers actually walked.
//   - Throws   `NO_MATCH`  — every provider came back healthy-empty (the
//     server's `outcome === 'NO_MATCH'`), i.e. nothing was found, not a fault.
//   - Throws   `ALL_ERROR` — every provider errored / no provider won. The
//     original last error is attached as `err.cause` (preserving its `.code`
//     and `.message`) plus `err.attempts`, so call sites that depend on
//     `err.code === 'SERVER_NO_TOKEN'` etc. can read it back off `cause`.
//
// Fall-through policy (per the issue): transient / outage codes and
// healthy-empty results all advance to the next provider — RATE_LIMIT,
// HTTP_ERROR, SERVER_NO_TOKEN, BAD_TOKEN, network failures and healthy-empty
// (NO_MATCH) included. We also fall through on UNEXPECTED codes (a future
// server contract change) so the chain degrades to the {NO_MATCH, ALL_ERROR}
// contract instead of leaking an unhandled error type into the UI. The LAST
// provider verdict wins: if it was healthy-empty we surface NO_MATCH, if it
// errored we surface ALL_ERROR with that error as the `cause`.

/** Build an Error carrying a machine-readable `code` plus extra metadata. */
export function lookupError(code, message, extra = {}) {
  const err = new Error(message)
  err.code = code
  return Object.assign(err, extra)
}

/** True when a response is a healthy-but-empty result set (outcome NO_MATCH). */
export function isHealthyEmpty(results) {
  return Array.isArray(results) && results.length === 0
}

/**
 * Walk the ordered `providers` list, calling `lookup(provider, index, providers)`
 * for each. Falls through on healthy-empty and on transient/outage errors.
 *
 * @param {{ providers: string[], lookup: (provider: string, index: number, providers: string[]) => Promise<Array> }} opts
 * @returns {Promise<{ results: Array, provider: string, attempts: string[] }>}
 * @throws  Error with `code` 'NO_MATCH' (all healthy-empty) or 'ALL_ERROR'
 *          (all errored), the latter carrying `cause` + `attempts`.
 */
export async function lookupChain({ providers, lookup }) {
  const list = Array.isArray(providers) ? providers.filter(Boolean) : []
  if (list.length === 0) {
    throw lookupError('NO_MATCH', 'No lookup providers configured.')
  }

  const attempts = []
  let lastError = null

  for (let i = 0; i < list.length; i++) {
    const provider = list[i]
    attempts.push(provider)
    try {
      const results = await lookup(provider, i, list)

      // Healthy-empty (server `outcome === 'NO_MATCH'`) → nothing to show,
      // try the next provider before declaring NO_MATCH for the whole chain.
      if (isHealthyEmpty(results)) {
        lastError = lookupError('NO_MATCH', `No matches found via ${provider}.`, { provider })
        continue
      }

      // A non-array response is malformed — treat as an outage, fall through.
      if (!Array.isArray(results)) {
        lastError = lookupError('HTTP_ERROR', `Unexpected lookup response from ${provider}.`, { provider })
        continue
      }

      // Win. Prefer the server's authoritative `source` marker (the real
      // server resolves primary → fallback in one call and tells us who won);
      // fall back to the attempted provider for generic/self-stitched chains.
      const winner = results?.source || provider
      return { results, provider: winner, attempts }
    } catch (err) {
      // Any rejection advances the chain (see policy above). The final throw
      // below turns this into ALL_ERROR with the true error preserved.
      lastError = err
    }
  }

  // Exhausted the provider list without a win.
  if (lastError && lastError.code !== 'NO_MATCH') {
    throw lookupError(
      'ALL_ERROR',
      lastError.message || 'All lookup providers failed.',
      { cause: lastError, attempts },
    )
  }
  throw lookupError('NO_MATCH', 'No matches found.', { attempts })
}
