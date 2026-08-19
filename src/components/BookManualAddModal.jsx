import { useState } from 'react'
import * as books from '../api/books'
import { t } from '../i18n'
import { sanitizeItemForCreate } from '../utils/sanitizeItem'
import MatchPicker from './MatchPicker'
import './ManualAddModal.css'

const emptyForm = { title: '', author: '', year: '', publisher: '', category: '' }

export default function BookManualAddModal({ onPick, onClose, copy = {} }) {
  const [mode, setMode] = useState('search') // search | picking | form
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [titleError, setTitleError] = useState('')

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
    if (!form.title.trim()) {
      setTitleError(copy.manualTitleRequired || t('add.titleRequired'))
      return
    }
    onPick(sanitizeItemForCreate({
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
    }))
  }

  if (mode === 'picking') {
    return (
      <MatchPicker
        title={t('add.searchResults')}
        matches={matches}
        loading={loading}
        errorMsg={errorMsg}
        onPick={onPick}
        onManual={() => setMode('form')}
        onClose={onClose}
        loadingLabel={t('add.lookingUpGoogle')}
        noMatchLabel={t('add.noMatchGoogle')}
      />
    )
  }

  if (mode === 'form') {
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('add.addBookManually')}>
        <div className="sheet manual-form-sheet">
          <div className="sheet-header">
            <h2>{t('add.addByHand')}</h2>
            <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
          </div>
          <form className="manual-form" onSubmit={submitManual} noValidate>
            <div className="manual-form-fields">
              <label>
                <span>{t('add.author')}</span>
                <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} placeholder="Ursula K. Le Guin" />
              </label>
              <label>
                <span>{t('add.titleRequired')}</span>
                <input
                  value={form.title}
                  onChange={(e) => { setForm({ ...form, title: e.target.value }); if (titleError) setTitleError('') }}
                  placeholder="A Wizard of Earthsea"
                  aria-invalid={!!titleError}
                  aria-describedby={titleError ? 'manual-title-error' : undefined}
                />
              </label>
              {titleError && <p id="manual-title-error" className="field-error" role="alert">{titleError}</p>}
              <div className="manual-form-row">
                <label>
                  <span>{t('add.year')}</span>
                  <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="1968" inputMode="numeric" />
                </label>
                <label>
                  <span>{t('add.publisher')}</span>
                  <input value={form.publisher} onChange={(e) => setForm({ ...form, publisher: e.target.value })} placeholder="Parnassus Press" />
                </label>
              </div>
              <label>
                <span>{t('add.category')}</span>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Fantasy" />
              </label>
            </div>
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode('search')}>{t('add.backToSearch')}</button>
              <button type="submit" className="btn btn-primary">{t('add.addToShelf')}</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('add.findBook')}>
      <div className="sheet">
        <div className="sheet-header">
          <h2>{t('add.findAnotherWay')}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>
        <form onSubmit={runSearch} className="search-form">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('add.searchPlaceholderBook')}
            className="search-input"
          />
          <button type="submit" className="btn btn-primary btn-block">{t('add.searchGoogleBooks')}</button>
        </form>
        <button className="text-link" onClick={() => setMode('form')}>{t('add.skipSearchAddByHand')}</button>
      </div>
    </div>
  )
}
