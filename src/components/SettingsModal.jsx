import './SettingsModal.css'

export default function SettingsModal({ onClose }) {
  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="sheet">
        <div className="sheet-header">
          <h2>Settings</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="settings-form">
          <p className="settings-section-label">Records</p>
          <div className="settings-card settings-help-books">
            Records are looked up on Discogs, which needs no token — just switch to the Records tab
            and scan a barcode.
          </div>

          <p className="settings-section-label">Books</p>
          <div className="settings-card settings-help-books">
            Books are looked up on Google Books, which needs no token — just switch to the Books tab
            and scan an ISBN.
          </div>
        </div>
      </div>
    </div>
  )
}
