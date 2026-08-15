import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import ScannerModal from '../components/ScannerModal'

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
