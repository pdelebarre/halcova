import { useState } from 'react'
import * as discogs from '../api/discogs'
import { useLookup } from '../hooks/useLookup'
import { t } from '../i18n'
import { sanitizeItemForCreate } from '../utils/sanitizeItem'
import MatchPicker from './MatchPicker'
import './ManualAddModal.css'

const FORMATS = ['LP', 'EP', 'CD', '7"', '12"', 'Other']
const emptyForm = { title: '', artist: '', formatType: 'LP', year: '', label: '', catno: '', genre: '' }
// RES-1.7 T7 (#293): the ordered chain, matching recordsCatalog.providers.
// CollectionView passes the catalog's own list; this default keeps the modal
// self-sufficient (e.g. in tests) without importing catalog.js (circular).
const DEFAULT_PROVIDERS = ['discogs', 'musicbrainz']

export default function ManualAddModal({ onPick, onClose, copy = {}, api = discogs, providers = DEFAULT_PROVIDERS }) {
  const [mode, setMode] = useState('search') // search | picking | form
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [titleError, setTitleError] = useState('')

  // RES-1.7 T7 (#293): the shared lookup client — text search now chains
  // primary → fallback through useLookup instead of a hardcoded discogs call.
  const lookup = useLookup({ api, providers })

  async function runSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setMode('picking')
    setLoading(true)
    setErrorMsg('')
    try {
      const out = await lookup.run('text', query.trim())
      setMatches(out.results)
    } catch (err) {
      // A healthy-empty chain throws NO_MATCH — keep the empty "no matches"
      // label (not an error), exactly like today's empty-array path.
      setMatches([])
      setErrorMsg(err.code === 'NO_MATCH'
        ? ''
        : (err.code === 'SERVER_NO_TOKEN' ? t('err.lookupsNotConfiguredToken') : err.message))
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
        loadingLabel={t('add.lookingUpDiscogs')}
        noMatchLabel={t('add.noMatchDiscogs')}
      />
    )
  }

  if (mode === 'form') {
    return (
      <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('add.addRecordManually')}>
        <div className="sheet manual-form-sheet">
          <div className="sheet-header">
            <h2>{t('add.addByHand')}</h2>
            <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
          </div>
          <form className="manual-form" onSubmit={submitManual} noValidate>
            <div className="manual-form-fields">
              <label>
                <span>{t('add.artist')}</span>
                <input value={form.artist} onChange={(e) => setForm({ ...form, artist: e.target.value })} placeholder="Miles Davis" />
              </label>
              <label>
                <span>{t('add.titleRequired')}</span>
                <input
                  value={form.title}
                  onChange={(e) => { setForm({ ...form, title: e.target.value }); if (titleError) setTitleError('') }}
                  placeholder="Kind of Blue"
                  aria-invalid={!!titleError}
                  aria-describedby={titleError ? 'manual-title-error' : undefined}
                />
              </label>
              {titleError && <p id="manual-title-error" className="field-error" role="alert">{titleError}</p>}
              <div className="manual-form-row">
                <label>
                  <span>{t('add.format')}</span>
                  <select value={form.formatType} onChange={(e) => setForm({ ...form, formatType: e.target.value })}>
                    {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('add.year')}</span>
                  <input value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="1959" inputMode="numeric" />
                </label>
              </div>
              <div className="manual-form-row">
                <label>
                  <span>{t('add.label')}</span>
                  <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Columbia" />
                </label>
                <label>
                  <span>{t('add.catalogNumber')}</span>
                  <input value={form.catno} onChange={(e) => setForm({ ...form, catno: e.target.value })} placeholder="CL 1355" />
                </label>
              </div>
              <label>
                <span>{t('add.genre')}</span>
                <input value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} placeholder="Jazz" />
              </label>
            </div>
            <div className="sheet-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setMode('search')}>{t('add.backToSearch')}</button>
              <button type="submit" className="btn btn-primary">{t('add.addToCrate')}</button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('add.findRecord')}>
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
            placeholder={t('add.searchPlaceholderRecord')}
            className="search-input"
          />
          <button type="submit" className="btn btn-primary btn-block">{t('add.searchDiscogs')}</button>
        </form>
        <button className="text-link" onClick={() => setMode('form')}>{t('add.skipSearchAddByHand')}</button>
      </div>
    </div>
  )
}
