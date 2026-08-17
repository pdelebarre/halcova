// App version surfaced in feedback auto-context (feat/feedback #82). Mirrors
// the "version" field in package.json — kept as a single constant so the
// FeedbackModal doesn't re-derive it. (Vite has no `define` wired for a
// build-time bump yet; revisit if we add one.)
export const APP_VERSION = '0.1.0'

// A short, human-readable device label from the User-Agent — shown in the
// feedback auto-context row so the submitter knows what context ships with the
// report. (The server also captures the full UA from the request header, so
// this is purely a transparency line in the UI, never a data path.) Returns ''
// for anything it can't classify rather than throwing — dark-screen safety.
export function deviceLabel(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  if (!userAgent) return ''
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'iOS'
  if (/Android/.test(userAgent)) return 'Android'
  if (/Windows/.test(userAgent)) return 'Windows'
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'macOS'
  if (/Linux/.test(userAgent)) return 'Linux'
  return ''
}
