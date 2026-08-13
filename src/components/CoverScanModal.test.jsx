import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import CoverScanModal from './CoverScanModal'

// The catalog copy CollectionView passes down — assert the modal uses it.
const COPY = {
  coverScan: {
    title: 'Scan a cover',
    help: 'Frame the front of the cover so the artist and title are readable.',
    capture: 'Capture',
    choosePhoto: 'Choose a photo',
    identifying: 'Reading the cover…',
    error: 'Something went wrong with the camera or photo.',
    close: 'Cancel cover scan',
  },
}

// jsdom never decodes images — stub `Image` so setting `src` (the gallery pick
// path) fires `onload` the way a decoded <img> would.
function makeFakeImage() {
  return class FakeImage {
    constructor() {
      this.naturalWidth = 0
      this.naturalHeight = 0
    }
    set src(value) {
      this._src = value
      this.naturalWidth = 800
      this.naturalHeight = 600
      this.onload?.()
    }
    get src() {
      return this._src
    }
  }
}

beforeEach(() => {
  // jsdom has no mediaDevices; the component's camera effect needs one.
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }) },
    configurable: true,
    writable: true,
  })

  // The camera effect calls video.play() — jsdom's throws "not implemented".
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()

  // downscaleToBlob draws to a canvas and encodes via toBlob — stub both.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() })
  if (typeof HTMLCanvasElement.prototype.toBlob !== 'function') {
    Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
      value() {},
      configurable: true,
      writable: true,
    })
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
    .mockImplementation((cb) => cb(new Blob(['cover'], { type: 'image/jpeg' })))

  // "Choose a photo" triggers the hidden file input's native click (jsdom no-op).
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})

  // The gallery pick creates an object URL and an <img>.
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
  vi.stubGlobal('Image', makeFakeImage())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Bring a rendered modal's camera to "ready" the way a real device does: the
// video element reports a frame size, then loadedmetadata fires. We flush the
// async camera effect first so its listeners are attached.
async function makeCameraReady(container) {
  await new Promise((r) => setTimeout(r, 0)) // flush getUserMedia/play microtasks
  const video = container.querySelector('video')
  Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true })
  fireEvent(video, new Event('loadedmetadata'))
}

describe('CoverScanModal', () => {
  it('renders with catalog copy, both capture actions, and NO capture attribute on the picker', () => {
    const { container } = render(<CoverScanModal onCaptured={vi.fn()} onClose={vi.fn()} copy={COPY} />)

    expect(screen.getByRole('dialog', { name: 'Scan a cover' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeInTheDocument()

    // Bug 1: `capture="environment"` forces the camera on mobile and blocks
    // choosing a photo from the device — the picker must not carry it.
    const fileInput = container.querySelector('input[type="file"]')
    expect(fileInput).not.toHaveAttribute('capture')
  })

  it('starts the camera preview without crashing and shows the hint once ready', async () => {
    const { container } = render(<CoverScanModal onCaptured={vi.fn()} onClose={vi.fn()} copy={COPY} />)

    // While the camera boots there's real feedback, not a dead blank screen.
    expect(await screen.findByText('Starting camera…')).toBeInTheDocument()

    await makeCameraReady(container)

    expect(await screen.findByText('Frame the front of the cover so the artist and title are readable.'))
      .toBeInTheDocument()
  })

  it('disables Capture until the camera reports a frame size', async () => {
    const { container } = render(<CoverScanModal onCaptured={vi.fn()} onClose={vi.fn()} copy={COPY} />)
    const capture = screen.getByRole('button', { name: 'Capture' })

    // Camera not ready yet → Capture is dead.
    expect(capture).toBeDisabled()

    await makeCameraReady(container)

    await waitFor(() => expect(capture).toBeEnabled())
  })

  it('never fires onCaptured while the camera is not ready', async () => {
    const onCaptured = vi.fn()
    render(<CoverScanModal onCaptured={onCaptured} onClose={vi.fn()} copy={COPY} />)

    // Capture is disabled until a frame size arrives, so a tap is a no-op.
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    await waitFor(() => expect(onCaptured).not.toHaveBeenCalled())
  })

  it('captures a camera frame once ready and hands a downscaled blob up', async () => {
    const onCaptured = vi.fn()
    const { container } = render(<CoverScanModal onCaptured={onCaptured} onClose={vi.fn()} copy={COPY} />)

    await makeCameraReady(container)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))

    await waitFor(() => expect(onCaptured).toHaveBeenCalledTimes(1))
    expect(onCaptured.mock.calls[0][0]).toBeInstanceOf(Blob)
  })

  it('lets the user pick a photo from the gallery', () => {
    render(<CoverScanModal onCaptured={vi.fn()} onClose={vi.fn()} copy={COPY} />)

    fireEvent.click(screen.getByRole('button', { name: 'Choose a photo' }))

    expect(HTMLInputElement.prototype.click).toHaveBeenCalled()
  })

  it('runs a picked photo through downscale and hands the blob up', async () => {
    const onCaptured = vi.fn()
    const { container } = render(<CoverScanModal onCaptured={onCaptured} onClose={vi.fn()} copy={COPY} />)

    const file = new File(['cover'], 'cover.jpg', { type: 'image/jpeg' })
    const input = container.querySelector('input[type="file"]')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(onCaptured).toHaveBeenCalledTimes(1))
    expect(onCaptured.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
  })

  it('shows the error copy and a Retry action when the frame cannot be encoded', async () => {
    // First capture fails to encode (toBlob hands back null); that path must
    // surface the friendly error, not crash.
    HTMLCanvasElement.prototype.toBlob.mockImplementation((cb) => cb(null))
    const onCaptured = vi.fn()
    const { container } = render(<CoverScanModal onCaptured={onCaptured} onClose={vi.fn()} copy={COPY} />)

    await makeCameraReady(container)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))

    expect(await screen.findByText('Something went wrong with the camera or photo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(onCaptured).not.toHaveBeenCalled()
  })

  it('shows a camera-denied error, keeps Capture disabled, and keeps Choose a photo usable', async () => {
    global.navigator.mediaDevices.getUserMedia.mockRejectedValue({ name: 'NotAllowedError' })
    render(<CoverScanModal onCaptured={vi.fn()} onClose={vi.fn()} copy={COPY} />)

    expect(await screen.findByText(/Camera access was denied/)).toBeInTheDocument()
    // Bug 2: no dead Capture — it stays disabled, and the pick-a-photo path is
    // the fully usable, promoted recovery.
    expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeEnabled()
  })

  it('shows the identifying progress and disables actions while OCR is busy', async () => {
    render(<CoverScanModal onCaptured={vi.fn()} onClose={vi.fn()} copy={COPY} busy />)

    expect(await screen.findByText('Reading the cover…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Capture' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeDisabled()
  })

  it('shows an OCR error inside the modal and Try again re-runs the last photo', async () => {
    const onCaptured = vi.fn()
    const baseProps = { onCaptured, onClose: vi.fn(), copy: COPY }
    const { container, rerender } = render(<CoverScanModal {...baseProps} />)

    // Capture once so the modal has a last blob to retry.
    await makeCameraReady(container)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Capture' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    await waitFor(() => expect(onCaptured).toHaveBeenCalledTimes(1))

    // Parent enters the OCR phase, then reports failure while keeping the
    // modal mounted (Bug 3: never a blank picker).
    rerender(<CoverScanModal {...baseProps} busy />)
    await waitFor(() => expect(screen.getByText('Reading the cover…')).toBeInTheDocument())

    rerender(<CoverScanModal {...baseProps} busyError="Couldn't read the cover — try a clearer photo." />)
    expect(await screen.findByText("Couldn't read the cover — try a clearer photo.")).toBeInTheDocument()
    // The actions re-enable after the failure so the user can retry or re-pick.
    expect(screen.getByRole('button', { name: 'Choose a photo' })).toBeEnabled()

    // "Retry" re-runs the last photo through OCR (via onCaptured).
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(onCaptured).toHaveBeenCalledTimes(2))
  })
})
