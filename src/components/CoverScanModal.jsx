import { useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import './CoverScanModal.css'

// Covers are photographed at up to 1280px on the long edge — plenty of detail
// for Tesseract, small enough to keep the JPEG quick to read and cheap.
const MAX_LONG_EDGE = 1280
const JPEG_QUALITY = 0.8

// Draw a video frame or <img> onto a canvas, downscale to MAX_LONG_EDGE, and
// resolve with the JPEG blob. Both camera capture and gallery pick funnel
// through here so they produce identical blobs for the OCR step.
function downscaleToBlob(source, width, height) {
  return new Promise((resolve, reject) => {
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(1, width, height))
    const outW = Math.max(1, Math.round(width * scale))
    const outH = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    ctx.drawImage(source, 0, 0, outW, outH)
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

/**
 * Cover capture modal: frame the front of a cover and Capture, or — the
 * first-class path — pick a photo already on the device. Both produce a
 * downscaled JPEG blob handed to `onCaptured`, then the parent runs OCR.
 *
 * While the parent is reading the cover it passes `busy` (shows a
 * "Reading the cover…" progress in here, never a dead tap) and, on failure,
 * `busyError` (the error is shown INSIDE this flow with a Try again, instead
 * of a blank picker).
 */
export default function CoverScanModal({ onCaptured, onClose, copy, busy = false, busyError = '' }) {
  const coverCopy = copy?.coverScan || {}
  // Hoist to stable strings (catalog copy is constant) so the camera effect
  // below can list real dependencies without restarting on every render.
  const helpText = coverCopy.help || t('coverScan.help')
  const errorText = coverCopy.error || t('coverScan.error')
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const lastBlobRef = useRef(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  // The Capture button only works once the camera has a real frame size —
  // `video.videoWidth` can be 0 right after play() resolves.
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)

  // Identifying = OCR (parent's `busy`) or the brief local encode (`capturing`).
  const identifying = busy || capturing

  // Camera lifecycle — a live preview only, with the Capture button freezing a
  // frame on demand. `cameraReady` flips on once the video reports dimensions
  // (loadedmetadata/resize are the fallback for play() resolving too early).
  useEffect(() => {
    let cancelled = false
    let mediaStream = null
    setCameraStarting(true)
    setCameraReady(false)
    setErrorMsg('')

    async function start() {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (cancelled) {
          mediaStream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = mediaStream
        await video.play()
        if (cancelled) return
        const markReady = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setCameraReady(true)
            setCameraStarting(false)
          }
        }
        video.addEventListener('loadedmetadata', markReady)
        video.addEventListener('resize', markReady)
        markReady() // in case dimensions are already present after play()
      } catch (err) {
        if (cancelled) return
        setCameraStarting(false)
        setCameraReady(false)
        setErrorMsg(
          err?.name === 'NotAllowedError'
            ? t('scan.cameraDenied')
            : errorText,
        )
      }
    }

    start()
    return () => {
      cancelled = true
      mediaStream?.getTracks().forEach((track) => track.stop())
    }
  }, [retryKey, helpText, errorText])

  // When the parent finishes the OCR round-trip (`busy` drops back to false),
  // release our local "capturing" lock so the actions re-enable.
  useEffect(() => {
    if (!busy) setCapturing(false)
  }, [busy])

  // Freeze the current camera frame at full-res and hand the downscaled JPEG
  // up. Guarded so a tap while not ready can never fire a capture.
  async function handleCapture() {
    const video = videoRef.current
    if (!video || !cameraReady || identifying) return
    setCapturing(true)
    setErrorMsg('')
    try {
      const blob = await downscaleToBlob(video, video.videoWidth, video.videoHeight)
      lastBlobRef.current = blob
      onCaptured(blob)
    } catch {
      setCapturing(false)
      setErrorMsg(errorText)
    }
  }

  function handleChoosePhoto() {
    if (identifying) return
    fileRef.current?.click()
  }

  // Gallery pick: run the chosen file through the same downscale/toBlob path
  // as a camera frame, then hand the blob up.
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file || identifying) return
    setCapturing(true)
    setErrorMsg('')
    try {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = async () => {
        try {
          const blob = await downscaleToBlob(img, img.naturalWidth, img.naturalHeight)
          URL.revokeObjectURL(url)
          lastBlobRef.current = blob
          onCaptured(blob)
        } catch {
          URL.revokeObjectURL(url)
          setCapturing(false)
          setErrorMsg(errorText)
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        setCapturing(false)
        setErrorMsg(errorText)
      }
      img.src = url
    } catch {
      setCapturing(false)
      setErrorMsg(errorText)
    }
  }

  // Re-run OCR on the last captured photo without making the user frame a new
  // one — the primary recovery after a failed read is "try a clearer photo",
  // but an accidental/unreadable frame shouldn't force a full re-pick.
  function handleRetryCapture() {
    if (!lastBlobRef.current || busy) return
    setCapturing(true)
    onCaptured(lastBlobRef.current)
  }

  function handleRetry() {
    setErrorMsg('')
    setRetryKey((k) => k + 1)
  }

  // Which status line to show: an error wins, then the identifying progress,
  // then camera readiness chatter, then the helpful hint.
  let statusText
  if (busyError) statusText = busyError
  else if (errorMsg) statusText = errorMsg
  else if (identifying) statusText = coverCopy.identifying || t('coverScan.identifying')
  else if (!cameraReady) statusText = cameraStarting ? t('scan.startingCamera') : helpText
  else statusText = helpText

  return (
    <div
      className={`cover-scan-overlay${identifying ? ' identifying' : ''}${!cameraReady && !identifying ? ' no-camera' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={coverCopy.title || t('coverScan.title')}
    >
      <div className="cover-scan-video">
        <video ref={videoRef} autoPlay muted playsInline />
      </div>

      <div className="cover-scan-chrome">
        <button
          className="cover-scan-close"
          onClick={onClose}
          aria-label={coverCopy.close || t('coverScan.close')}
        >
          ✕
        </button>

        <p className="cover-scan-status" role={busyError ? 'alert' : 'status'}>
          {statusText}
        </p>

        {busyError && !busy && (
          <button type="button" className="cover-scan-retry" onClick={handleRetryCapture}>
            {t('common.retry')}
          </button>
        )}

        {errorMsg && !busyError && (
          <button type="button" className="cover-scan-retry" onClick={handleRetry}>
            {t('common.retry')}
          </button>
        )}

        <div className="cover-scan-actions">
          <button
            type="button"
            className="cover-scan-capture"
            onClick={handleCapture}
            disabled={!cameraReady || identifying}
          >
            {capturing ? t('common.loading') : (coverCopy.capture || t('coverScan.capture'))}
          </button>
          <button
            type="button"
            className="cover-scan-gallery"
            onClick={handleChoosePhoto}
            disabled={identifying}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-3.5-3.5a2 2 0 0 0-2.83 0L6 20" />
            </svg>
            {coverCopy.choosePhoto || t('coverScan.choosePhoto')}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="cover-scan-file"
          onChange={handleFileChange}
        />
      </div>
    </div>
  )
}
