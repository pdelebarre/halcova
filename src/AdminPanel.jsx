import { useCallback, useEffect, useState } from 'react'
import * as authApi from './api/auth'
import './AdminPanel.css'

const KIND_LABELS = { records: 'Records', books: 'Books' }
const KINDS = ['records', 'books']

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

// The admin screen: accept pending signup requests (granting Records and/or
// Books), manage members' access, disable/delete accounts. Reachable only by
// the owner (the admin key session).
export default function AdminPanel({ onClose }) {
  const [data, setData] = useState({ requests: [], users: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [approving, setApproving] = useState(null) // request id being approved
  const [draft, setDraft] = useState({ records: true, books: true })
  const [granted, setGranted] = useState(null) // { user, code } just approved
  const [revealed, setRevealed] = useState({}) // userId -> show code?

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await authApi.adminList()
      setData(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function approve() {
    setError('')
    try {
      const res = await authApi.adminApprove({ requestId: approving, collections: draft })
      setGranted(res)
      setApproving(null)
      setDraft({ records: true, books: true })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function reject(requestId) {
    setError('')
    try {
      await authApi.adminReject({ requestId })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleAccess(userId, kind) {
    const user = data.users.find((u) => u.id === userId)
    if (!user) return
    const collections = { ...(user.collections || {}), [kind]: !user.collections?.[kind] }
    setError('')
    try {
      await authApi.adminUpdateUser({ userId, collections })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleStatus(userId) {
    const user = data.users.find((u) => u.id === userId)
    if (!user) return
    setError('')
    try {
      await authApi.adminUpdateUser({
        userId,
        status: user.status === 'active' ? 'disabled' : 'active',
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function removeUser(userId) {
    if (!window.confirm('Delete this member and their collections? This cannot be undone.')) return
    setError('')
    try {
      await authApi.adminDeleteUser({ userId })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch { /* clipboard unavailable — the code stays selectable */ }
  }

  const pending = data.requests.filter((r) => r.status === 'pending')
  const members = data.users.filter((u) => u.role !== 'admin')

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label="Admin">
      <div className="sheet admin-sheet">
        <div className="sheet-header">
          <h2>Admin</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error && <p className="sheet-error admin-error">{error}</p>}

        <div className="admin-scroll">
          <section>
            <h3 className="admin-h3">Pending requests{pending.length ? ` (${pending.length})` : ''}</h3>
            {loading ? (
              <p className="sheet-status">Loading…</p>
            ) : pending.length === 0 ? (
              <p className="sheet-empty">No pending requests right now.</p>
            ) : (
              <ul className="admin-list">
                {pending.map((r) => (
                  <li key={r.id} className="admin-row">
                    <div className="admin-row-main">
                      <span className="admin-name">{r.name}</span>
                      <span className="admin-sub">{r.email} · requested {fmtDate(r.createdAt)}</span>
                    </div>
                    <div className="admin-row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setApproving(r.id)}>Approve</button>
                      <button className="btn btn-danger btn-sm" onClick={() => reject(r.id)}>Reject</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {approving && (
            <section className="admin-approve">
              <h3 className="admin-h3">Grant access</h3>
              <p className="admin-sub">Which collections should this member get?</p>
              <div className="admin-kinds">
                {KINDS.map((k) => (
                  <label key={k} className={`kind-chip ${draft[k] ? 'on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={!!draft[k]}
                      onChange={() => setDraft((d) => ({ ...d, [k]: !d[k] }))}
                    />
                    {KIND_LABELS[k]}
                  </label>
                ))}
              </div>
              <div className="sheet-actions">
                <button
                  className="btn btn-primary"
                  onClick={approve}
                  disabled={!draft.records && !draft.books}
                >
                  Generate access code
                </button>
                <button className="btn btn-ghost" onClick={() => setApproving(null)}>Cancel</button>
              </div>
            </section>
          )}

          {granted && (
            <section className="admin-code">
              <h3 className="admin-h3">Access code for {granted.user.name}</h3>
              <p className="admin-sub">Share this code out of band — it's how they sign in.</p>
              <div className="admin-code-box">
                <code className="admin-code-text">{granted.code}</code>
                <button className="btn btn-ghost btn-sm" onClick={() => copyText(granted.code)}>Copy</button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setGranted(null)}>Done</button>
            </section>
          )}

          <section>
            <h3 className="admin-h3">Members{members.length ? ` (${members.length})` : ''}</h3>
            {members.length === 0 ? (
              <p className="sheet-empty">No members yet.</p>
            ) : (
              <ul className="admin-list">
                {members.map((u) => (
                  <li key={u.id} className={`admin-row ${u.status === 'disabled' ? 'is-disabled' : ''}`}>
                    <div className="admin-row-main">
                      <span className="admin-name">{u.name}</span>
                      <span className="admin-sub">{u.email}</span>
                      <div className="admin-kinds static">
                        {KINDS.map((k) => (
                          <button
                            key={k}
                            type="button"
                            className={`kind-chip mini ${u.collections?.[k] ? 'on' : ''}`}
                            onClick={() => toggleAccess(u.id, k)}
                            aria-pressed={!!u.collections?.[k]}
                          >
                            {KIND_LABELS[k]}
                          </button>
                        ))}
                      </div>
                      {revealed[u.id] && (
                        <div className="admin-code-box inline">
                          <code className="admin-code-text">{u.code}</code>
                        </div>
                      )}
                    </div>
                    <div className="admin-row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setRevealed((prev) => ({ ...prev, [u.id]: !prev[u.id] }))}>
                        {revealed[u.id] ? 'Hide code' : 'Show code'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleStatus(u.id)}>
                        {u.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeUser(u.id)}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
