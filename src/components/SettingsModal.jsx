import { useState } from 'react'
import * as discogs from '../api/discogs'
import './SettingsModal.css'

export default function SettingsModal({ onClose }) {
  const [token, setToken] = useState(discogs.hasToken() ? '••••••••••••••••' : '')
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

        <form onSubmit={save} className="settings-form">
          <label>
            <span>Discogs personal access token</span>
            <input
              type="text"
              value={token}
              onChange={(e) => { setToken(e.target.value); setDirty(true) }}
              onFocus={() => { if (!dirty) setToken('') }}
              placeholder="Paste your token"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <p className="settings-help">
            Used to look up records by barcode. Get a free token at discogs.com → Settings → Developers →
            Generate new token. It's stored only on this device.
          </p>
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
