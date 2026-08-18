import { useEffect, useRef, useState } from 'react'
import { prepareZXingModule, purgeZXingModule, readBarcodes } from 'zxing-wasm/reader'
import zxingReaderWasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { t } from '../i18n'
import './ScannerModal.css'

// Serve the WASM decoder from our own bundle instead of a third-party CDN, so
// scanning keeps working reliably (and gets precached by the service worker)
// rather than depending on an external host.
//
// The `?url` import is already a bundled asset URL. Keep it base-robust: only
// absolute URLs ("/…" or full http(s)) are used as-is; anything else gets
// prefixed with the app's base path so the self-hosted wasm still resolves to
// the right asset when the app is served from a sub-path.
const APP_BASE = import.meta.env.BASE_URL || '/'
const wasmUrl =
  zxingReaderWasmUrl.startsWith('http') || zxingReaderWasmUrl.startsWith('/')
    ? zxingReaderWasmUrl
    : `${APP_BASE}${zxingReaderWasmUrl}`

// Self-hosted WASM via the bundled `?url` asset — a plain SAME-ORIGIN URL.
// Do NOT hand the decoder a Blob URL here: the deployed Content-Security-Policy
// sets `connect-src 'self'` (netlify.toml), which blocks blob: fetches and
// therefore breaks the decoder entirely ("both async and sync fetching of the
// wasm failed"). prepareZXingModule is idempotent; readBarcodes initialises
// the module on first use.
prepareZXingModule({
  overrides: { locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) },
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
// After this long of armed scanning with no barcode detected, show a subtle
// hint so it's never a silent black hole. Never fatal, never resets the camera.
const WATCHDOG_MS = 9000
// After this many CONSECUTIVE readBarcodes throws (each ~180ms apart), re-init
// the wasm module so a transient load/instantiation failure self-heals. The
// scanner NEVER hard-stops with an error — a per-frame failure just keeps
// scanning, which is the behavior that predated the decode-hardening changes.
const REINIT_AFTER_FAILURES = 6

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
  const [hintMsg, setHintMsg] = useState('')
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
    let watchdogShown = false
    let armedAt = 0

    const stopStream = () => {
      mediaStream?.getTracks().forEach((track) => track.stop())
    }

    // Harden C1.3 re-acquisition: if the OS reclaims / ends the camera track
    // (backgrounded tab, iOS camera handoff), stop the decode loop cleanly and
    // surface a recoverable error instead of a silent frozen preview.
    const handleTrackEnded = () => {
      if (cancelled) return
      cancelAnimationFrame(rafId)
      setErrorMsg(t('scan.cameraLost'))
      stopStream()
    }

    // Self-heal: a transient decoder load/instantiation failure must not
    // permanently break scanning. Purge the cached module and re-prepare with
    // the plain same-origin URL so the next decode attempt re-downloads +
    // re-instantiates.
    const reinitWasm = () => {
      try {
        purgeZXingModule()
      } catch {
        // ignore — purge is best-effort
      }
      prepareZXingModule({
        overrides: { locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) },
      })
      console.warn('[scanner] re-initializing barcode decoder after decode failures')
    }

    async function decodeFrame(video, canvas, ctx) {
      const srcW = video.videoWidth
      const srcH = video.videoHeight
      // Guard the video-readiness race: never decode a 0-dims / 1×1 frame.
      if (!srcW || !srcH) return null

      const scale = Math.min(1, MAX_DECODE_WIDTH / srcW)
      const width = Math.max(1, Math.round(srcW * scale))
      const height = Math.max(1, Math.round(srcH * scale))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      ctx.drawImage(video, 0, 0, width, height)

      // getImageData can throw TRANSIENTLY on iOS Safari right after the first
      // video frames are drawn ("canvas not ready yet") or when the canvas is
      // mid-resize. That's a normal skip-this-frame condition, never fatal:
      // return null and keep scanning (the original code tolerated this).
      let imageData
      try {
        imageData = ctx.getImageData(0, 0, width, height)
      } catch {
        return null
      }

      // readBarcodes only throws on real failures (e.g. the wasm failing to
      // load/instantiate). An EMPTY array is a normal "no barcode in frame"
      // and stays silent. Exceptions propagate to the loop, which only halts
      // after several consecutive failures so a one-off throw never breaks an
      // otherwise-working scanner.
      const results = await readBarcodes(imageData, READER_OPTIONS)
      if (cancelled) return results
      if (results.length > 0 && results[0].text) {
        // Prevent further decode attempts while we play the UI pulse.
        cancelled = true
        setJustDecoded(true)
        navigator.vibrate?.(60)
        // Keep camera running briefly so the user sees the pulse animation,
        // then stop tracks and notify the caller.
        const text = results[0].text
        setTimeout(() => {
          cancelAnimationFrame(rafId)
          stopStream()
          onDetectedRef.current(text)
        }, 320)
      }
      return results
    }

    async function start() {
      // On re-activation (Add & scan next) reset the scan pulse, torch, hint
      // and any stale status so the camera looks freshly armed (the previous
      // track — and its torch — was stopped while hidden).
      setJustDecoded(false)
      setTorchOn(false)
      setStatusMsg(t('scan.startingCamera'))
      setHintMsg('')
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
          stopStream()
          return
        }

        // Watch for the camera being interrupted mid-scan (iOS Safari reclaims
        // the camera when the tab backgrounds) so we never show a frozen feed.
        mediaStream
          .getVideoTracks()
          .forEach((track) => track.addEventListener?.('ended', handleTrackEnded))

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
        let decodeFailures = 0

        // Detect torch capability on the first video track and cache the track.
        try {
          const [vt] = mediaStream.getVideoTracks()
          torchTrackRef.current = vt
          const caps = vt.getCapabilities?.() || {}
          if (caps.torch) setTorchAvailable(true)
        } catch {
          // ignore — just means torch not available
        }

        const loop = async () => {
          if (cancelled) return
          const now = performance.now()

          // No-detection watchdog: after WATCHDOG_MS of armed scanning with no
          // decode, nudge the user. Never fatal and never resets the camera.
          if (!watchdogShown && now - armedAt >= WATCHDOG_MS) {
            watchdogShown = true
            setHintMsg(t('scan.noBarcodeYet'))
          }

          // Wait for real frames before decoding. Never fatal — the watchdog
          // above still gives feedback while the video becomes ready.
          if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
            rafId = requestAnimationFrame(loop)
            return
          }

          if (!decoding && now - lastDecode >= DECODE_INTERVAL_MS) {
            lastDecode = now
            decoding = true
            try {
              // A normal return — null (a transient skipped frame) or a results
              // array — means the decode path is healthy, so reset the failure
              // counter. Only a thrown exception counts against us.
              await decodeFrame(video, canvas, ctx)
              decodeFailures = 0
            } catch (err) {
              // readBarcodes threw (e.g. wasm not loaded/instantiated). This is
              // NEVER fatal: count consecutive failures and, past a threshold,
              // re-init the wasm module so a transient load failure self-heals.
              // The loop keeps scanning regardless (as it did before the
              // decode-hardening changes).
              decodeFailures += 1
              console.warn('[scanner] decode failed', err?.message || err)
              if (decodeFailures >= REINIT_AFTER_FAILURES) {
                decodeFailures = 0
                reinitWasm()
              }
            } finally {
              decoding = false
            }
          }
          rafId = requestAnimationFrame(loop)
        }

        armedAt = performance.now()
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
      mediaStream?.getTracks().forEach((track) => {
        track.removeEventListener?.('ended', handleTrackEnded)
        track.stop()
      })
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
    } catch {
      try {
        const ImageCaptureCtor = window.ImageCapture
        if (ImageCaptureCtor) {
          const ic = new ImageCaptureCtor(vt)
          await ic.setOptions?.({ torch: !torchOn })
          setTorchOn((s) => !s)
        }
      } catch {
        setTorchAvailable(false)
      }
    }
  }

  const handleRetry = () => {
    setErrorMsg('')
    setHintMsg('')
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
        <button type="button" className="scanner-close" onClick={onClose} aria-label={t('scan.cancelScan')}>
          ✕
        </button>

        {torchAvailable && (
          <button
            type="button"
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
        {!errorMsg && hintMsg && <p className="scanner-hint">{hintMsg}</p>}

        {errorMsg && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="scanner-retry" onClick={handleRetry} aria-label={t('scan.retryCamera')}>
              {t('common.retry')}
            </button>
          </div>
        )}

        <button type="button" className="scanner-manual" onClick={() => onClose('manual')}>
          {t('scan.enterManually')}
        </button>
      </div>
    </div>
  )
}
