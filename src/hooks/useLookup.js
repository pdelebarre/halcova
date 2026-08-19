// RES-1.7 T7 (#293) — Shared client lookup hook.
//
// One state machine + one `run(mode, term)` entry point that drives EVERY
// lookup call site (CollectionView barcode scan, cover OCR, and both manual
// add modals) through the same lookupChain orchestration, while leaving the
// existing per-site UI decisions (toasts, SERVER_NO_TOKEN handling,
// presentCandidate / picker paths) exactly where they are.
//
// The hook owns the mechanism, not the copy or the side-effects:
//   - `run('barcode'|'text', term)` walks `providers` via lookupChain. The
//     server resolves primary → fallback in ONE request, so every provider
//     step of the chain shares a single memoized server promise (no extra
//     network fetches) — the chain still derives `provider`/`attempts` from
//     the ordered list and the server's `source` marker.
//   - On success it returns `{ results, provider, attempts }` (results is the
//     server array unchanged — normalization stays in src/api/*, and the
//     per-hit `mbid`/`openLibraryId` from T5 pass straight through).
//   - On a healthy-empty chain it throws an error with `code === 'NO_MATCH'`.
//   - On a fault it throws an error with the ORIGINAL provider code surfaced
//     (SERVER_NO_TOKEN / RATE_LIMIT / ALL_PROVIDERS_FAILED / …) so call sites
//     keep their exact `err.code === 'SERVER_NO_TOKEN'` checks unchanged.
//
// State machine: state ∈ idle → searching → done | no-match | error, with an
// OCR capture phase ocr ∈ idle → ocr-needed → ocr-capturing for the cover flow.

import { useCallback, useRef, useState } from 'react'
import { lookupChain } from '../api/lookupChain'

const NO_MATCH = 'NO_MATCH'

export function useLookup({ api, providers }) {
  const [state, setState] = useState('idle') // idle | searching | done | no-match | error
  const [ocr, setOcr] = useState('idle') // idle | ocr-needed | ocr-capturing
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [provider, setProvider] = useState(null)
  const [attempts, setAttempts] = useState([])
  const lastRunRef = useRef(null)

  const run = useCallback(async (mode, term) => {
    lastRunRef.current = { mode, term }
    setState('searching')
    setError(null)
    setResults(null)

    // Thin orchestration over the SINGLE server endpoint. The server already
    // chains primary → fallback, so one memoized promise backs every provider
    // step of lookupChain — the chain derives provider/attempts from the
    // ordered `providers` list and the server's `source` marker without ever
    // opening a second network connection.
    let single = null
    const lookup = async () => {
      if (!single) {
        const fn = mode === 'barcode' ? api.searchByBarcode : api.searchByText
        single = fn(term)
      }
      return single
    }

    try {
      const out = await lookupChain({ providers, lookup })
      setState('done')
      setResults(out.results)
      setProvider(out.provider)
      setAttempts(out.attempts)
      return out
    } catch (err) {
      // Surface the ORIGINAL provider error (code + message) when the chain
      // wrapped it as ALL_ERROR, so call sites keep their exact err.code
      // handling (SERVER_NO_TOKEN etc.) with zero behavior change.
      const cause = err?.cause
      const surfaced = new Error(cause?.message || err?.message || 'Lookup failed.')
      surfaced.code = cause?.code || err?.code || 'ALL_ERROR'
      surfaced.attempts = err?.attempts
      surfaced.cause = err
      setError(surfaced)
      setProvider(null)
      setState(err?.code === NO_MATCH ? 'no-match' : 'error')
      throw surfaced
    }
  }, [api, providers])

  // Re-run the last lookup exactly as it was issued (same mode + term).
  const retry = useCallback(() => {
    const last = lastRunRef.current
    if (!last) return Promise.resolve()
    return run(last.mode, last.term)
  }, [run])

  // Cover OCR capture phase: the caller drives OCR itself (heavy, lazy-loaded
  // Tesseract stays in CollectionView); the hook just tracks the phase so a
  // single state machine describes the whole cover flow.
  const beginOcr = useCallback(() => setOcr('ocr-needed'), [])
  const capturingOcr = useCallback(() => setOcr('ocr-capturing'), [])
  const finishOcr = useCallback(() => {
    setOcr('idle')
    setState('idle')
    setResults(null)
    setError(null)
  }, [])

  return { state, ocr, results, error, provider, attempts, run, retry, beginOcr, capturingOcr, finishOcr }
}
