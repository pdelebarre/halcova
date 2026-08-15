import { useEffect, useRef, useState } from 'react'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { t } from '../i18n'
import './ScannerModal.css'

// Serve the WASM decoder from our own bundle instead of a third-party CDN, so
// scanning keeps working reliably (and gets precached by the service worker)
// rather than depending on an external host.
prepareZXingModule({
  overrides: {
    locateFile: (path) => (path.endsWith('.wasm') ? zxingReaderWasmUrl : path),
  },
})

// 1D retail codes printed on records and sleeves — same set the old
// html5-qrcode scanner supported, decoded by the zxing-wasm WASM engine which
// works on iOS Safari where html5-qrcode's decoder is unreliable.
const READER_OPTIONS = {
  formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128'],
  tryHarder: true,
  maxNumberOfSymbols: 1,
}

const DECODE_INTERVAL_MS = 180 // ~5 decode attempts per second
// Frames wider than this are downscaled before decoding — keeps the WASM fast
// on mid-range phones while staying sharp enough for small barcodes.
const MAX_DECODE_WIDTH = 640

export default function ScannerModal({ onDetected, onClose, active = true }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const torchTrackRef = useRef(null)

  // C1.3 warm camera: keep the latest onDetected in a ref so the camera effect
  // only re-runs on `active`/`retryKey`. A CollectionView re-render must never
  // tear down and restart the stream (it stays mounted through the result sheet).
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const [statusMsg, setStatusMsg] = useState(t('scan.startingCamera'))
  const [errorMsg, setErrorMsg] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [justDecoded, setJustDecoded] = useState(false)

  useEffect(() => {
    // C1.3: when hidden (e.g. the result sheet is up) the scanner stays MOUNTED
    // but idle — no camera, no decode loop, no battery/LED drain. Re-activating
    // re-requests getUserMedia; the permission is already granted for the page,
    // so iOS doesn't re-prompt (the #87 device gate validates this).
    if (!active) return undefined

    let cancelled = false
    let mediaStream = null
    let rafId = 0

    async function decodeFrame(video, canvas, ctx) {
      const scale = Math.min(1, MAX_DECODE_WIDTH / video.videoWidth)
      const width = Math.max(1, Math.round(video.videoWidth * scale))
      const height = Math.max(1, Math.round(video.videoHeight * scale))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      ctx.drawImage(video, 0, 0, width, height)

      let imageData
      try {
        imageData = ctx.getImageData(0, 0, width, height)
      } catch {
        return // canvas not ready yet — skip this frame
      }

      try {
        const results = await readBarcodes(imageData, READER_OPTIONS)
        if (!cancelled && results.length > 0 && results[0].text) {
          // Prevent further decode attempts while we play the UI pulse.
          cancelled = true
          setJustDecoded(true)
          navigator.vibrate?.(60)
          // Keep camera running briefly so the user sees the pulse animation,
          // then stop tracks and notify the caller.
          const text = results[0].text
          setTimeout(() => {
            cancelAnimationFrame(rafId)
            mediaStream?.getTracks().forEach((track) => track.stop())
            onDetectedRef.current(text)
          }, 320)
        }
      } catch {
        // A single frame failing to decode is normal — keep scanning.
      }
    }

    async function start() {
      // On re-activation (Add & scan next) reset the scan pulse, torch and any
      // stale status so the camera looks freshly armed (the previous track —
      // and its torch — was stopped while hidden).
      setJustDecoded(false)
      setTorchOn(false)
      setStatusMsg(t('scan.startingCamera'))
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
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

        setStatusMsg(t('scan.aimAtBarcode'))

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        let decoding = false
        let lastDecode = 0

        // Detect torch capability on the first video track and cache the track.
        try {
          const [vt] = mediaStream.getVideoTracks()
          torchTrackRef.current = vt
          const caps = vt.getCapabilities?.() || {}
          if (caps.torch) setTorchAvailable(true)
        } catch (e) {
          // ignore — just means torch not available
        }

        const loop = async () => {
          if (cancelled) return
          const now = performance.now()
          if (!decoding && video.readyState >= 2 && now - lastDecode >= DECODE_INTERVAL_MS) {
            lastDecode = now
            decoding = true
            await decodeFrame(video, canvas, ctx)
            decoding = false
          }
          rafId = requestAnimationFrame(loop)
        }
        rafId = requestAnimationFrame(loop)
      } catch (err) {
        if (cancelled) return
        setErrorMsg(
          err?.name === 'NotAllowedError'
            ? t('scan.cameraDenied')
            : t('scan.cameraFail'),
        )
      }
    }

    start()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      mediaStream?.getTracks().forEach((track) => track.stop())
    }
  }, [active, retryKey])

  // Toggle torch if supported. Try applyConstraints first, fall back to ImageCapture.
  const toggleTorch = async () => {
    const vt = torchTrackRef.current
    if (!vt) return
    try {
      const newState = !torchOn
      await vt.applyConstraints?.(newState ? { advanced: [{ torch: true }] } : { advanced: [{ torch: false }] })
      setTorchOn(newState)
    } catch (e) {
      try {
        const ImageCaptureCtor = window.ImageCapture
        if (ImageCaptureCtor) {
          const ic = new ImageCaptureCtor(vt)
          await ic.setOptions?.({ torch: !torchOn })
          setTorchOn((s) => !s)
        }
      } catch (e2) {
        setTorchAvailable(false)
      }
    }
  }

  const handleRetry = () => {
    setErrorMsg('')
    setStatusMsg(t('scan.restartingCamera'))
    setRetryKey((k) => k + 1)
  }

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label={t('scan.scanBarcode')} hidden={!active}>
      <div className="scanner-video">
        <video ref={videoRef} autoPlay muted playsInline />
        <canvas ref={canvasRef} className="scanner-canvas" />
      </div>

      <div className="scanner-chrome">
        <button className="scanner-close" onClick={onClose} aria-label={t('scan.cancelScan')}>
          ✕
        </button>

        {torchAvailable && (
          <button
            className={`scanner-torch ${torchOn ? 'on' : ''}`}
            onClick={toggleTorch}
            aria-pressed={torchOn}
            aria-label={torchOn ? t('scan.torchOff') : t('scan.torchOn')}
          >
            {torchOn ? '🔦' : '💡'}
          </button>
        )}

        <div className={`scanner-target ${justDecoded ? 'pulse' : ''}`}>
          <span className="scanner-corner tl" />
          <span className="scanner-corner tr" />
          <span className="scanner-corner bl" />
          <span className="scanner-corner br" />
          <span className="scanner-line" />
          <span className="scanner-pulse" aria-hidden="true" />
        </div>

        <p className="scanner-status">{errorMsg || statusMsg}</p>

        {errorMsg && (
          <div style={{ marginTop: 8 }}>
            <button className="scanner-retry" onClick={handleRetry} aria-label={t('scan.retryCamera')}>
              {t('common.retry')}
            </button>
          </div>
        )}

        <button className="scanner-manual" onClick={() => onClose('manual')}>
          {t('scan.enterManually')}
        </button>
      </div>
    </div>
  )
}
