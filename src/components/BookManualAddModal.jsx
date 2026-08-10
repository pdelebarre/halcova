import { useState } from 'react'
import * as books from '../api/books'
import MatchPicker from './MatchPicker'
import './ManualAddModal.css'

const emptyForm = { title: '', author: '', year: '', publisher: '', category: '' }

export default function BookManualAddModal({ onPick, onClose }) {
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
      const results = await books.searchByText(query.trim())
      setMatches(results)
    } catch (err) {
      setErrorMsg(err.message)
      setMatches([])
    } finally {
      setLoading(false)
    }
  }

  function submitManual(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    onPick({
      title: form.author ? `${form.author} - ${form.title}` : form.title,
      year: form.year,
      label: form.publisher,
      catno: '',
      isbn: '',
      formatRaw: '',
      formatType: '',
      genre: form.category ? [form.category] : [],
      style: [],
      country: '',
      coverImage: '',
      googleBooksId: null,
      infoLink: '',
      resourceUrl: '',
      barcode: '',
      description: '',
      pageCount: '',
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
        loadingLabel="Looking it up on Google Books…"
        noMatchLabel="No matches found on Google Books."
      />
    )
  }

  if (mode === 'form') {
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Add book manually">
        <div className="sheet manual-form-sheet">
          <div className="sheet-header">
            <h2>Add by hand</h2>
            <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <form className="manual-form" onSubmit={submitManual}>
            <label>
              <span>Author</span>
              <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Ursula K. Le Guin" />
            </label>
            <label>
              <span>Title *</span>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="A Wizard of Earthsea" />
            </label>
            <div className="manual-form-row">
              <label>
                <span>Year</span>
                <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="1968" inputMode="numeric" />
              </label>
              <label>
                <span>Publisher</span>
                <input value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} placeholder="Parnassus Press" />
              </label>
            </div>
            <label>
              <span>Category</span>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Fantasy" />
            </label>
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode('search')}>Back to search</button>
              <button type="submit" className="btn btn-primary">Add to shelf</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Find a book">
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
            placeholder="Title or author"
            className="search-input"
          />
          <button type="submit" className="btn btn-primary btn-block">Search Google Books</button>
        </form>
        <button className="text-link" onClick={() => setMode('form')}>Skip search — add it by hand</button>
      </div>
    </div>
  )
}
