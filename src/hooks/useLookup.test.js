import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLookup } from './useLookup'

// T8 (#286): the on-device Tesseract worker can't run in jsdom — stub
// recognizeImage and let the REAL extractSearchQuery turn the fake lines into
// query/barcode (same pattern as cover-scan.int.test.jsx).
vi.mock('../utils/ocr', () => ({
  recognizeImage: vi.fn(),
}))
import * as ocr from '../utils/ocr'

const RECORD_PROVIDERS = ['discogs', 'musicbrainz']

function makeApi() {
  return {
    searchByBarcode: vi.fn(),
    searchByText: vi.fn(),
  }
}

// Model the server's single-call return shape: an array with attached
// `source`/`outcome` metadata (see src/api/discogs.js / books.js).
function attachSource(results, source) {
  const arr = [...results]
  arr.source = source
  arr.outcome = arr.length ? 'ok' : 'NO_MATCH'
  return arr
}

describe('useLookup', () => {
  let api

  beforeEach(() => {
    api = makeApi()
    // vi.fn() call history from a previous test leaks otherwise (e.g. a
    // barcode lookup would still "have been called" in the next test).
    vi.clearAllMocks()
  })

  it('starts idle with no results/error and a clean OCR phase', () => {
    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    expect(result.current.state).toBe('idle')
    expect(result.current.ocr).toBe('idle')
    expect(result.current.results).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('run(barcode) → done with results, provider and attempts, calling the single endpoint once', async () => {
    const results = attachSource([{ discogsId: 1, title: 'Miles Davis - Kind of Blue' }], 'discogs')
    api.searchByBarcode.mockResolvedValue(results)

    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    let out
    await act(async () => {
      out = await result.current.run('barcode', '123')
    })

    expect(api.searchByBarcode).toHaveBeenCalledTimes(1)
    expect(api.searchByBarcode).toHaveBeenCalledWith('123')
    expect(out.results).toBe(results)
    expect(out.provider).toBe('discogs')
    expect(out.attempts).toEqual(['discogs'])
    expect(result.current.state).toBe('done')
    expect(result.current.results).toBe(results)
    expect(result.current.provider).toBe('discogs')
  })

  it('run(text) uses searchByText for the manual-add path', async () => {
    const results = attachSource([{ googleBooksId: 'g1', title: 'A Wizard of Earthsea' }], 'books')
    api.searchByText.mockResolvedValue(results)

    const { result } = renderHook(() => useLookup({ api, providers: ['books', 'openLibrary'] }))
    let out
    await act(async () => {
      out = await result.current.run('text', 'wizard of earthsea')
    })

    expect(api.searchByText).toHaveBeenCalledWith('wizard of earthsea')
    expect(api.searchByBarcode).not.toHaveBeenCalled()
    expect(out.provider).toBe('books')
    expect(out.results).toBe(results)
  })

  it('derives a fallback win from the server source marker without an extra network call', async () => {
    // The server resolves primary → fallback in ONE request and marks the
    // winner: the chain must derive provider 'musicbrainz' from `source` and
    // never re-call the endpoint for the "second" provider step.
    const results = attachSource([{ mbid: 'm1', discogsId: null, title: 'X - Y' }], 'musicbrainz')
    api.searchByBarcode.mockResolvedValue(results)

    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    let out
    await act(async () => {
      out = await result.current.run('barcode', '123')
    })

    expect(out.provider).toBe('musicbrainz')
    expect(out.results).toBe(results)
    expect(api.searchByBarcode).toHaveBeenCalledTimes(1)
  })

  it('run → no-match when the whole chain is healthy-empty, and surfaces NO_MATCH', async () => {
    api.searchByBarcode.mockResolvedValue(attachSource([], 'discogs'))

    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    await act(async () => {
      await expect(result.current.run('barcode', '123')).rejects.toMatchObject({ code: 'NO_MATCH' })
    })

    expect(result.current.state).toBe('no-match')
    // One server call backs the whole chain walk (no re-query for provider 2).
    expect(api.searchByBarcode).toHaveBeenCalledTimes(1)
  })

  it('run → error and surfaces the ORIGINAL provider code (SERVER_NO_TOKEN) so call sites keep their checks', async () => {
    const tokenErr = new Error("Lookups aren't configured yet — tell the owner to set the Discogs token.")
    tokenErr.code = 'SERVER_NO_TOKEN'
    api.searchByBarcode.mockRejectedValue(tokenErr)

    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    await act(async () => {
      await expect(result.current.run('barcode', '123'))
        .rejects.toMatchObject({ code: 'SERVER_NO_TOKEN', message: tokenErr.message })
    })

    expect(result.current.state).toBe('error')
    expect(result.current.error.code).toBe('SERVER_NO_TOKEN')
  })

  it('run → error with ALL_PROVIDERS_FAILED surfaced (server outage, distinct from NO_MATCH)', async () => {
    const outage = new Error("Couldn't reach any lookup service — try again in a moment.")
    outage.code = 'ALL_PROVIDERS_FAILED'
    api.searchByBarcode.mockRejectedValue(outage)

    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    await act(async () => {
      await expect(result.current.run('barcode', '123')).rejects.toMatchObject({ code: 'ALL_PROVIDERS_FAILED' })
    })

    expect(result.current.state).toBe('error')
    expect(result.current.error.code).toBe('ALL_PROVIDERS_FAILED')
  })

  it('enters searching while the lookup is in flight', async () => {
    let resolveLookup
    api.searchByBarcode.mockReturnValue(new Promise((res) => { resolveLookup = res }))

    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    let pending
    await act(async () => {
      pending = result.current.run('barcode', '123')
    })
    // The run's synchronous prefix set state to 'searching'; the lookup is
    // still pending, so the machine must NOT be done yet.
    expect(result.current.state).toBe('searching')

    await act(async () => {
      resolveLookup(attachSource([{ discogsId: 1 }], 'discogs'))
      await pending
    })
    expect(result.current.state).toBe('done')
  })

  it('retry() re-runs the last lookup with the same mode + term', async () => {
    api.searchByBarcode.mockResolvedValue(attachSource([{ discogsId: 7, title: 'A' }], 'discogs'))

    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    await act(async () => {
      await result.current.run('barcode', '555')
    })

    api.searchByBarcode.mockClear()
    api.searchByBarcode.mockResolvedValue(attachSource([{ discogsId: 8, title: 'B' }], 'discogs'))

    let out
    await act(async () => {
      out = await result.current.retry()
    })
    expect(api.searchByBarcode).toHaveBeenCalledWith('555')
    expect(out.provider).toBe('discogs')
  })

  it('retry() is a no-op before any run', async () => {
    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    await act(async () => {
      await expect(result.current.retry()).resolves.toBeUndefined()
    })
    expect(api.searchByBarcode).not.toHaveBeenCalled()
  })

  it('tracks the OCR capture phase for the cover flow (ocr-needed → ocr-capturing → idle)', () => {
    const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS }))
    expect(result.current.ocr).toBe('idle')

    act(() => result.current.beginOcr())
    expect(result.current.ocr).toBe('ocr-needed')

    act(() => result.current.capturingOcr())
    expect(result.current.ocr).toBe('ocr-capturing')

    act(() => result.current.finishOcr())
    expect(result.current.ocr).toBe('idle')
    expect(result.current.state).toBe('idle')
  })

  // T8 (#286): OCR-as-automatic-fallback — runOcr reads a cover, then feeds
  // the extracted barcode/text back through the SAME chain as a scan.
  describe('runOcr (cover OCR fallback)', () => {
    // Build a fake Tesseract line; bbox area drives the ranking (same as the
    // cover-scan integration test).
    function ocrLine(text, { confidence = 85, area = 1000 } = {}) {
      const side = Math.sqrt(area)
      return { text, confidence, bbox: { x0: 0, y0: 0, x1: side, y1: side, width: side, height: side } }
    }

    it('a readable barcode re-enters the chain via barcode lookup (barcode wins over text)', async () => {
      ocr.recognizeImage.mockResolvedValue({
        text: 'Kind of Blue\n0 76732-57341-2 9',
        lines: [ocrLine('Kind of Blue', { area: 3000 }), ocrLine('0 76732-57341-2 9', { area: 900 })],
      })
      api.searchByBarcode.mockResolvedValue(attachSource([{ discogsId: 101, title: 'Miles Davis - Kind of Blue' }], 'discogs'))

      const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS, kind: 'records' }))
      let out
      await act(async () => {
        out = await result.current.runOcr(new Blob(['cover']))
      })

      expect(ocr.recognizeImage).toHaveBeenCalledTimes(1)
      expect(api.searchByBarcode).toHaveBeenCalledWith('0767325734129')
      expect(api.searchByText).not.toHaveBeenCalled()
      expect(out.provider).toBe('discogs')
      expect(result.current.state).toBe('done')
      // runOcr drove the capture phase; the caller resets it with finishOcr().
      expect(result.current.ocr).toBe('ocr-capturing')
    })

    it('readable text re-enters the chain via text lookup when no barcode shows', async () => {
      ocr.recognizeImage.mockResolvedValue({
        text: 'Miles Davis\nKind of Blue',
        lines: [ocrLine('Miles Davis', { area: 5000 }), ocrLine('Kind of Blue', { area: 3000 })],
      })
      api.searchByText.mockResolvedValue(attachSource([{ discogsId: 101, title: 'Miles Davis - Kind of Blue' }], 'discogs'))

      const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS, kind: 'records' }))
      let out
      await act(async () => {
        out = await result.current.runOcr(new Blob(['cover']))
      })

      expect(ocr.recognizeImage).toHaveBeenCalledTimes(1)
      expect(api.searchByText).toHaveBeenCalledWith('Miles Davis Kind of Blue')
      expect(api.searchByBarcode).not.toHaveBeenCalled()
      expect(out.results).toBeTruthy()
    })

    it('passes kind through to extractSearchQuery (books title+author query)', async () => {
      ocr.recognizeImage.mockResolvedValue({
        text: 'A Wizard of Earthsea\nUrsula K. Le Guin',
        lines: [ocrLine('A Wizard of Earthsea', { area: 5000 }), ocrLine('Ursula K. Le Guin', { area: 3000 })],
      })
      api.searchByText.mockResolvedValue(attachSource([{ googleBooksId: 'g1', title: 'A Wizard of Earthsea' }], 'books'))

      const { result } = renderHook(() => useLookup({ api, providers: ['books', 'openLibrary'], kind: 'books' }))
      let out
      await act(async () => {
        out = await result.current.runOcr(new Blob(['cover']))
      })

      expect(api.searchByText).toHaveBeenCalledWith('A Wizard of Earthsea Ursula K. Le Guin')
      expect(out.provider).toBe('books')
    })

    it('no readable text → NO_READABLE_TEXT, never searches and never opens a camera', async () => {
      ocr.recognizeImage.mockResolvedValue({
        text: '',
        lines: [ocrLine('© 2024 All Rights Reserved', { confidence: 40, area: 4000 })],
      })

      const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS, kind: 'records' }))
      await act(async () => {
        // The hook owns NO camera — it throws a coded error instead, which the
        // caller maps to coverScan.noText; opening the camera is always a tap.
        await expect(result.current.runOcr(new Blob(['cover']))).rejects.toMatchObject({ code: 'NO_READABLE_TEXT' })
      })

      expect(api.searchByBarcode).not.toHaveBeenCalled()
      expect(api.searchByText).not.toHaveBeenCalled()
    })

    it('re-enters the chain exactly once through the single server endpoint', async () => {
      ocr.recognizeImage.mockResolvedValue({
        text: 'Kind of Blue\n0 76732-57341-2 9',
        lines: [ocrLine('Kind of Blue', { area: 3000 }), ocrLine('0 76732-57341-2 9', { area: 900 })],
      })
      api.searchByBarcode.mockResolvedValue(attachSource([{ discogsId: 101 }], 'discogs'))

      const { result } = renderHook(() => useLookup({ api, providers: RECORD_PROVIDERS, kind: 'records' }))
      await act(async () => {
        await result.current.runOcr(new Blob(['cover']))
      })

      expect(api.searchByBarcode).toHaveBeenCalledTimes(1)
    })
  })
})
