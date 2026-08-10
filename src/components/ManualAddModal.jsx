import { useState } from 'react'
import * as discogs from '../api/discogs'
import MatchPicker from './MatchPicker'
import './ManualAddModal.css'

const FORMATS = ['LP', 'EP', 'CD', '7"', '12"', 'Other']
const emptyForm = { title: '', artist: '', formatType: 'LP', year: '', label: '', catno: '', genre: '' }

export default function ManualAddModal({ onPick, onClose }) {
  const [mode, setMode] = useState('search') // search | picking | form
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState(emptyForm)

  async function runSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setMode('picking')
    setLoading(true)
    setErrorMsg('')
    try {
      const results = await discogs.searchByText(query.trim())
      setMatches(results)
    } catch (err) {
      setErrorMsg(err.code === 'NO_TOKEN'
        ? 'Add a Discogs token in Settings first, or add this record manually below.'
        : err.message)
      setMatches([])
    } finally {
      setLoading(false)
    }
  }

  function submitManual(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    onPick({
      title: form.artist ? `${form.artist} - ${form.title}` : form.title,
      year: form.year,
      label: form.label,
      catno: form.catno,
      formatRaw: form.formatType,
      formatType: form.formatType,
      genre: form.genre ? [form.genre] : [],
      style: [],
      country: '',
      coverImage: '',
      discogsId: null,
      resourceUrl: '',
      barcode: '',
    })
  }

  if (mode === 'picking') {
    return (
      <MatchPicker
        title="Search results"
        matches={matches}
        loading={loading}
        errorMsg={errorMsg}
        onPick={onPick}
        onManual={() => setMode('form')}
        onClose={onClose}
      />
    )
  }

  if (mode === 'form') {
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Add record manually">
        <div className="sheet manual-form-sheet">
          <div className="sheet-header">
            <h2>Add by hand</h2>
            <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <form className="manual-form" onSubmit={submitManual}>
            <label>
              <span>Artist</span>
              <input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} placeholder="Miles Davis" />
            </label>
            <label>
              <span>Title *</span>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Kind of Blue" />
            </label>
            <div className="manual-form-row">
              <label>
                <span>Format</span>
                <select value={form.formatType} onChange={(e) => setForm({ ...form, formatType: e.target.value })}>
                  {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
              <label>
                <span>Year</span>
                <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="1959" inputMode="numeric" />
              </label>
            </div>
            <div className="manual-form-row">
              <label>
                <span>Label</span>
                <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Columbia" />
              </label>
              <label>
                <span>Catalog #</span>
                <input value={form.catno} onChange={(e) => setForm({ ...form, catno: e.target.value })} placeholder="CL 1355" />
              </label>
            </div>
            <label>
              <span>Genre</span>
              <input value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} placeholder="Jazz" />
            </label>
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode('search')}>Back to search</button>
              <button type="submit" className="btn btn-primary">Add to crate</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Find a record">
      <div className="sheet">
        <div className="sheet-header">
          <h2>Find it another way</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={runSearch} className="search-form">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artist or album title"
            className="search-input"
          />
          <button type="submit" className="btn btn-primary btn-block">Search Discogs</button>
        </form>
        <button className="text-link" onClick={() => setMode('form')}>Skip search — add it by hand</button>
      </div>
    </div>
  )
}
