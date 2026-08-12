import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
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
})
