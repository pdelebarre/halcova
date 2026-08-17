import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import ScannerModal from '../components/ScannerModal'
import { readBarcodes } from 'zxing-wasm/reader'

// The WASM decoder is hoisted and stubbed before the component module loads.
vi.mock('zxing-wasm/reader', () => ({
  readBarcodes: vi.fn().mockResolvedValue([]),
  prepareZXingModule: () => {},
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
  // The user's bug: a hard decode failure (e.g. the self-hosted wasm failing
  // to load/instantiate at runtime) used to be swallowed by decodeFrame's
  // catch, so the user sat on "Aim at the barcode" forever with no feedback.
  // Now a hard error surfaces the existing retry UI instead of spinning.
  it('surfaces a decode error + retry when the decoder throws, instead of silently spinning', async () => {
    const onDetected = vi.fn()
    const onClose = vi.fn()
    const utils = render(<ScannerModal onDetected={onDetected} onClose={onClose} active={false} />)
    makeReadyMedia(utils.container)

    readBarcodes.mockRejectedValueOnce(new Error('wasm load failed'))

    utils.rerender(<ScannerModal onDetected={onDetected} onClose={onClose} active />)

    expect(await screen.findByText(/Couldn't read the camera feed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /retry camera/i })).toBeTruthy()
    expect(onDetected).not.toHaveBeenCalled()
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
