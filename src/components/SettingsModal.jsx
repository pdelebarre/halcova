import { useState } from 'react'
import * as discogs from '../api/discogs'
import './SettingsModal.css'

export default function SettingsModal({ onClose }) {
  const [token, setToken] = useState(discogs.hasToken() ? '••••••••••••••••' : '')
  const [showToken, setShowToken] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  function save(e) {
    e.preventDefault()
    if (dirty && token.trim()) {
      discogs.setToken(token.trim())
      setSaved(true)
      setDirty(false)
      setTimeout(() => setSaved(false), 1800)
    }
  }

  function clear() {
    discogs.clearToken()
    setToken('')
    setDirty(false)
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="sheet">
        <div className="sheet-header">
          <h2>Settings</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={save} className="settings-form" noValidate>
          <p className="settings-section-label">Records</p>
          <div className="settings-card">
            <label className="settings-row">
              <span className="settings-row-label">Discogs personal access token</span>
              <span className="settings-input-wrap">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setDirty(true) }}
                  onFocus={() => { if (!dirty) setToken('') }}
                  placeholder="Paste your token"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Discogs personal access token"
                />
                <button
                  type="button"
                  className="settings-eye"
                  onClick={() => setShowToken((s) => !s)}
                  aria-label={showToken ? 'Hide token' : 'Show token'}
                  aria-pressed={showToken}
                >
                  {showToken ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </span>
            </label>
          </div>
          <p className="settings-help">
            Used to look up records by barcode. Get a free token at discogs.com → Settings → Developers →
            Generate new token. It's stored only on this device.
          </p>

          <p className="settings-section-label">Books</p>
          <div className="settings-card settings-help-books">
            Books are looked up on Google Books, which needs no token — just switch to the Books tab
            and scan an ISBN.
          </div>

          <div className="sheet-actions">
            {discogs.hasToken() && (
              <button type="button" className="btn btn-danger" onClick={clear}>Remove token</button>
            )}
            <button type="submit" className="btn btn-primary" disabled={!dirty}>
              {saved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <path d="M1 1l22 22" />
    </svg>
  )
}
