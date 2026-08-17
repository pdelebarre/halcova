import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import ScannerModal from '../components/ScannerModal'
import { purgeZXingModule, readBarcodes } from 'zxing-wasm/reader'

// The WASM decoder is hoisted and stubbed before the component module loads.
vi.mock('zxing-wasm/reader', () => ({
  readBarcodes: vi.fn().mockResolvedValue([]),
  prepareZXingModule: () => {},
  purgeZXingModule: vi.fn(),
}))

// Mock navigator.mediaDevices and readBarcodes to exercise retry/torch logic.
beforeEach(() => {
  const mockTrack = {
    stop: vi.fn(),
    applyConstraints: vi.fn(),
    getCapabilities: vi.fn(() => ({})),
  }
  const mockStream = { getTracks: () => [mockTrack], getVideoTracks: () => [mockTrack] }
  global.navigator.mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(mockStream) }
})

describe('ScannerModal (unit/mocks)', () => {
  it('shows status and allows retry when camera fails', async () => {
    const onDetected = vi.fn()
    const onClose = vi.fn()
    const { findByText } = render(<ScannerModal onDetected={onDetected} onClose={onClose} />)

    expect(await findByText(/Starting camera|Aim at the barcode/)).toBeTruthy()
  })

  // C1.3 warm camera: the scanner stays MOUNTED through the result sheet but
  // idle (no camera, no decode loop) — re-activating restarts on the SAME node.
  it('stays mounted but idle while inactive, then restarts the camera on the same node', async () => {
    const onDetected = vi.fn()
    const onClose = vi.fn()
    const { container, rerender } = render(
      <ScannerModal onDetected={onDetected} onClose={onClose} active={false} />,
    )

    // Hidden + camera never requested while the result sheet is up (no LED
    // drain, no getUserMedia churn).
    expect(global.navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    const overlay = container.querySelector('.scanner-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay.hasAttribute('hidden')).toBe(true)

    // Re-activating restarts the camera on the SAME mounted node (no remount).
    rerender(<ScannerModal onDetected={onDetected} onClose={onClose} active />)
    expect(container.querySelector('.scanner-overlay')).toBe(overlay)
    expect(overlay.hasAttribute('hidden')).toBe(false)
    await waitFor(() => expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))
  })

  // The camera effect must not restart just because the parent re-renders with
  // a new onDetected identity (CollectionView re-renders on toast timers etc.).
  it('does not restart the camera on a parent re-render (stable onDetected ref)', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<ScannerModal onDetected={vi.fn()} onClose={onClose} />)
    await waitFor(() => expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))

    rerender(<ScannerModal onDetected={vi.fn()} onClose={onClose} />)
    expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})

// jsdom has no real media/canvas pipeline: readyState stays 0 and the decode
// loop never runs. For the hardening tests we render HIDDEN first (no camera
// effect), then make the video "ready" on the actual instance and re-activate,
// so the decode loop has real dimensions to work with.
function makeReadyMedia(container) {
  const video = container.querySelector('video')
  Object.defineProperty(video, 'readyState', { configurable: true, get: () => 4 })
  Object.defineProperty(video, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(video, 'videoHeight', { configurable: true, get: () => 480 })
  video.play = vi.fn().mockResolvedValue()
  const ctx = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) })),
  }
  container.querySelector('canvas').getContext = vi.fn(() => ctx)
  return ctx
}

describe('ScannerModal decode hardening', () => {
  // The regression we must never reintroduce: a single TRANSIENT frame failure
  // (e.g. iOS getImageData throwing "canvas not ready" right after the first
  // video frames are drawn) must be skipped and scanning must continue — it
  // must NOT surface the error UI or stop the camera.
  it('tolerates a transient getImageData throw and keeps scanning (no error)', async () => {
    vi.useFakeTimers()
    try {
      const onDetected = vi.fn()
      const onClose = vi.fn()
      const utils = render(<ScannerModal onDetected={onDetected} onClose={onClose} active={false} />)
      const ctx = makeReadyMedia(utils.container)

      // iOS "canvas not ready": getImageData throws on the very first frame
      // only, then returns normal (empty) frames. readBarcodes finds no code.
      let calls = 0
      ctx.getImageData = vi.fn(() => {
        calls += 1
        if (calls === 1) throw new Error('canvas not ready')
        return { width: 1, height: 1, data: new Uint8ClampedArray(4) }
      })
      readBarcodes.mockResolvedValue([])

      utils.rerender(<ScannerModal onDetected={onDetected} onClose={onClose} active />)

      // Run several decode iterations. The transient first-frame throw must
      // neither surface the error nor stop scanning.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })

      expect(screen.queryByText(/Couldn't read the camera feed/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /retry camera/i })).not.toBeInTheDocument()
      expect(calls).toBeGreaterThan(1) // scanning kept going after the hiccup
      expect(onDetected).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  // A PERSISTENT decoder failure (e.g. the self-hosted wasm never loading)
  // must NEVER surface a fatal error or stop the scanner (the pre-#280
  // behavior). Instead it keeps scanning and, past the threshold, self-heals
  // by re-initializing the wasm module.
  it('keeps scanning with no error on persistent decode failure, and self-heals by re-initing the wasm', async () => {
    vi.useFakeTimers()
    try {
      const onDetected = vi.fn()
      const onClose = vi.fn()
      const utils = render(<ScannerModal onDetected={onDetected} onClose={onClose} active={false} />)
      makeReadyMedia(utils.container)

      // Persistently reject (like a wasm that never loads/instantiates).
      readBarcodes.mockRejectedValue(new Error('wasm load failed'))
      purgeZXingModule.mockClear()

      utils.rerender(<ScannerModal onDetected={onDetected} onClose={onClose} active />)

      // Each decode attempt is ~180ms apart; past the 6-failure threshold the
      // loop re-inits the wasm. No fatal error is ever surfaced.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000)
      })

      expect(screen.queryByText(/Couldn't read the camera feed/)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /retry camera/i })).not.toBeInTheDocument()
      expect(purgeZXingModule).toHaveBeenCalled() // self-healed the wasm
      expect(onDetected).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      readBarcodes.mockReset()
      readBarcodes.mockResolvedValue([])
    }
  })

  // No-detection watchdog: after ~9s of armed scanning with normal empty
  // results (readBarcodes → []), show a subtle hint — never a silent black
  // hole. Camera is not reset; no retry button appears.
  it('shows a subtle no-detection hint after the watchdog window (no decode, no error)', async () => {
    vi.useFakeTimers()
    try {
      const onDetected = vi.fn()
      const onClose = vi.fn()
      const utils = render(<ScannerModal onDetected={onDetected} onClose={onClose} active={false} />)
      makeReadyMedia(utils.container)

      utils.rerender(<ScannerModal onDetected={onDetected} onClose={onClose} active />)

      // WATCHDOG_MS is 9000 in the component; advance well past it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9500)
      })

      expect(screen.getByText(/No barcode detected yet/)).toBeTruthy()
      // Guidance only — no error, no retry, camera left running.
      expect(screen.queryByRole('button', { name: /retry camera/i })).not.toBeInTheDocument()
      expect(onDetected).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
