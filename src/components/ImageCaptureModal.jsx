// ImageCaptureModal — AI Image Recognition for Collection Capture
// (FEAT-9.5, #336, epic #331).
//
// Allows users to photograph an item when barcode/search fails and receive
// candidate identification from the AI provider.
//
// Flow:
//   1. User captures a photo (camera or gallery)
//   2. Photo is sent to the server as base64
//   3. Server saves to Blobs, mints signed URL, sends to AI provider
//   4. Server returns identification candidates
//   5. User reviews candidates and confirms or dismisses
//
// Security (ADR-0021 §2.5):
//   - Image URLs are server-signed, time-bounded (5 min TTL)
//   - AI suggests only (no auto-add): candidates require user confirmation
//   - XSS-safe rendering via schema validation on the server
//   - Camera permission is never automatically re-requested after failure
//
// Dependencies:
//   - #385 asset signing (server-side)
//   - #303 AI provider abstraction (server-side)
//   - #321 scan flow (ScannerModal.jsx, ScanResult.jsx)

import { useEffect, useRef, useState } from 'react'
import { getSessionToken } from '../utils/session'
import { t } from '../i18n'
import './ImageCaptureModal.css'

// Images are downscaled to 1280px on the long edge before sending to the server
// — keeps the JPEG quick to upload and cheap to process.
const MAX_LONG_EDGE = 1280
const JPEG_QUALITY = 0.8

// Draw a video frame or <img> onto a canvas, downscale to MAX_LONG_EDGE, and
// resolve with the base64-encoded JPEG data.
function captureToBase64(source, width, height) {
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
      (blob) => {
        if (!blob) return reject(new Error('Could not encode image'))
        const reader = new FileReader()
        reader.onload = () => {
          const base64 = reader.result.split(',')[1] // strip data:image/jpeg;base64,
          resolve(base64)
        }
        reader.onerror = () => reject(new Error('Could not read image'))
        reader.readAsDataURL(blob)
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

// Send the image to the server for AI identification.
async function identifyImage(imageBase64, { collectionType } = {}) {
  const token = getSessionToken()
  const body = {
    action: 'identify',
    image: imageBase64,
    mimeType: 'image/jpeg',
  }
  if (collectionType) {
    body.hints = { collectionType }
  }

  const res = await fetch('/.netlify/functions/image-identify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || 'Image identification failed')
    err.code = data.code || 'IDENTIFY_FAILED'
    throw err
  }
  return data
}

/**
 * Image capture modal: frame an item and Capture, or pick a photo from the
 * device. Sends the image to the server for AI identification and returns
 * candidate results via `onIdentified`.
 *
 * Props:
 *   onIdentified(candidates, assetId) — called when AI returns candidates
 *   onClose() — close the modal
 *   onManual() — fallback to manual entry
 *   copy — i18n copy object
 *   collectionType — optional hint for the AI provider
 */
export default function ImageCaptureModal({ onIdentified, onClose, onManual, copy, collectionType }) {
  const imgCopy = copy?.imageCapture || {}
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const lastCaptureRef = useRef(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [identifying, setIdentifying] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraStarting, setCameraStarting] = useState(false)

  const busy = capturing || identifying

  // Hoist stable copy values so the camera effect doesn't restart on every render
  const helpText = imgCopy.help || t('coverScan.help')
  const errorText = imgCopy.error || t('coverScan.error')

  // Camera lifecycle
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
        markReady()
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

  // Capture the current camera frame and send for identification
  async function handleCapture() {
    const video = videoRef.current
    if (!video || !cameraReady || busy) return
    setCapturing(true)
    setErrorMsg('')
    try {
      const base64 = await captureToBase64(video, video.videoWidth, video.videoHeight)
      lastCaptureRef.current = base64
      await sendForIdentification(base64)
    } catch {
      setCapturing(false)
      setErrorMsg(imgCopy.error || t('coverScan.error'))
    }
  }

  // Gallery pick: run the chosen file through the same capture path
  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || busy) return
    setCapturing(true)
    setErrorMsg('')
    try {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = async () => {
        try {
          const base64 = await captureToBase64(img, img.naturalWidth, img.naturalHeight)
          URL.revokeObjectURL(url)
          lastCaptureRef.current = base64
          await sendForIdentification(base64)
        } catch {
          URL.revokeObjectURL(url)
          setCapturing(false)
          setErrorMsg(imgCopy.error || t('coverScan.error'))
        }
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        setCapturing(false)
        setErrorMsg(imgCopy.error || t('coverScan.error'))
      }
      img.src = url
    } catch {
      setCapturing(false)
      setErrorMsg(imgCopy.error || t('coverScan.error'))
    }
  }

  // Send the base64 image to the server for AI identification
  async function sendForIdentification(base64) {
    setIdentifying(true)
    try {
      const result = await identifyImage(base64, { collectionType })
      setCapturing(false)
      setIdentifying(false)
      // AI suggests only (no auto-add): candidates require user confirmation
      onIdentified(result.candidates, result.assetId)
    } catch (err) {
      setCapturing(false)
      setIdentifying(false)
      setErrorMsg(err.message || (imgCopy.identifyFailed || t('coverScan.noText')))
    }
  }

  // Retry with the last captured photo
  function handleRetryCapture() {
    if (!lastCaptureRef.current || busy) return
    setCapturing(true)
    sendForIdentification(lastCaptureRef.current)
  }

  function handleRetry() {
    setErrorMsg('')
    setRetryKey((k) => k + 1)
  }

  function handleChoosePhoto() {
    if (busy) return
    fileRef.current?.click()
  }

  // Status text
  let statusText
  if (errorMsg) statusText = errorMsg
  else if (identifying) statusText = imgCopy.identifying || t('coverScan.identifying')
  else if (!cameraReady) statusText = cameraStarting ? t('scan.startingCamera') : (imgCopy.help || t('coverScan.help'))
  else statusText = imgCopy.help || t('coverScan.help')

  return (
    <div
      className={`image-capture-overlay${busy ? ' identifying' : ''}${!cameraReady && !busy ? ' no-camera' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={imgCopy.title || t('coverScan.title')}
    >
      <div className="image-capture-video">
        <video ref={videoRef} autoPlay muted playsInline />
      </div>

      <div className="image-capture-chrome">
        <button
          className="image-capture-close"
          onClick={onClose}
          aria-label={imgCopy.close || t('coverScan.close')}
        >
          ✕
        </button>

        <p className="image-capture-status" role={errorMsg ? 'alert' : 'status'}>
          {statusText}
        </p>

        {errorMsg && !identifying && (
          <div className="image-capture-errors">
            {lastCaptureRef.current && (
              <button type="button" className="image-capture-retry" onClick={handleRetryCapture}>
                {t('common.retry')}
              </button>
            )}
            <button type="button" className="image-capture-retry" onClick={handleRetry}>
              {imgCopy.retryCamera || t('scan.retryCamera')}
            </button>
          </div>
        )}

        <div className="image-capture-actions">
          <button
            type="button"
            className="image-capture-capture"
            onClick={handleCapture}
            disabled={!cameraReady || busy}
          >
            {capturing ? t('common.loading') : (imgCopy.capture || t('coverScan.capture'))}
          </button>
          <button
            type="button"
            className="image-capture-gallery"
            onClick={handleChoosePhoto}
            disabled={busy}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-3.5-3.5a2 2 0 0 0-2.83 0L6 20" />
            </svg>
            {imgCopy.choosePhoto || t('coverScan.choosePhoto')}
          </button>
        </div>

        <button
          type="button"
          className="image-capture-manual"
          onClick={onManual}
          disabled={busy}
        >
          {imgCopy.enterManually || t('scan.enterManually')}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="image-capture-file"
          onChange={handleFileChange}
        />
      </div>
    </div>
  )
}