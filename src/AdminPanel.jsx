import { useCallback, useEffect, useState } from 'react'
import * as authApi from './api/auth'
import { t, getLocale } from './i18n'
import './AdminPanel.css'

const KIND_LABELS = { records: () => t('kind.records'), books: () => t('kind.books') }
const KIND_ACCESS_LABELS = { records: () => t('kind.recordsAccess'), books: () => t('kind.booksAccess') }
const KINDS = ['records', 'books']

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

// Switch-style plan toggle (§4.16): a button with role="switch" so the
// Records/Books grants read as on/off rather than chips.
function Switch({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' on' : ''}`}
      onClick={onChange}
    >
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
      <span className="switch-label">
        <span className="switch-label-text">{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
    </button>
  )
}

// The admin screen: accept pending signup requests (granting Records and/or
// Books), manage members' access, disable/delete accounts. Reachable only by
// the owner (the admin key session).
export default function AdminPanel({ onClose }) {
  const [data, setData] = useState({ requests: [], users: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [approving, setApproving] = useState(null) // request id being approved
  const [draft, setDraft] = useState({ records: true, books: true, lending: false, plan: 'free' })
  const [granted, setGranted] = useState(null) // { user, code } just approved
  const [rotating, setRotating] = useState(null) // userId with a rotate in flight (double-tap guard)
  const [rotated, setRotated] = useState(null) // { user, code } from a rotate — returned exactly once
  const [copied, setCopied] = useState(null) // which code was just copied

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
      const res = await authApi.adminApprove({
        requestId: approving,
        collections: { records: draft.records, books: draft.books },
        features: { lending: draft.lending },
        plan: draft.plan,
      })
      setGranted(res)
      setApproving(null)
      setDraft({ records: true, books: true, lending: false, plan: 'free' })
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

  async function toggleFeature(userId) {
    const user = data.users.find((u) => u.id === userId)
    if (!user) return
    setError('')
    try {
      await authApi.adminUpdateUser({
        userId,
        features: { lending: !user.features?.lending },
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  // Free tier (T5): flip a member between 'free' and 'unlimited'. The switch is
  // ON when unlimited; OFF (free) is the default. The owner is never listed here.
  async function togglePlan(userId) {
    const user = data.users.find((u) => u.id === userId)
    if (!user) return
    const plan = user.plan === 'unlimited' ? 'free' : 'unlimited'
    setError('')
    try {
      await authApi.adminUpdateUser({ userId, plan })
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
    if (!window.confirm(t('admin.deleteConfirm'))) return
    setError('')
    try {
      await authApi.adminDeleteUser({ userId })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  // Rotate a member's (lost) code. Scaling Phase 1 hashes codes server-side,
  // so "show the stored code" is impossible — rotating mints a NEW code and
  // returns the plaintext exactly once. The in-flight guard prevents a
  // double-tap from rotating twice (the button is also disabled while busy).
  async function rotateCode(userId) {
    if (rotating) return
    setError('')
    setRotating(userId)
    try {
      const res = await authApi.adminRotate({ userId })
      setRotated(res)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setRotating(null)
    }
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // Fallback for older / non-secure contexts: select + execCommand.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      // execCommand is legacy but is the only portable fallback for copy.
      try { document.execCommand('copy') } catch { /* still unavailable */ }
      ta.remove()
    }
    setCopied(key)
    window.setTimeout(() => setCopied(null), 1500)
  }

  const pending = data.requests.filter((r) => r.status === 'pending')
  const members = data.users.filter((u) => u.role !== 'admin')

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('common.adminPanel')}>
      <div className="sheet admin-sheet">
        <div className="sheet-header">
          <h2>{t('common.adminPanel')}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        {error && <p className="sheet-error admin-error">{error}</p>}

        <div className="admin-scroll">
          <section>
            <h3 className="admin-h3">{t('admin.pendingRequests')}{pending.length ? ` (${pending.length})` : ''}</h3>
            {loading ? (
              <p className="sheet-status">{t('common.loading')}</p>
            ) : pending.length === 0 ? (
              <p className="sheet-empty">{t('admin.noPending')}</p>
            ) : (
              <ul className="admin-list">
                {pending.map((r) => (
                  <li key={r.id} className="admin-row">
                    <div className="admin-row-main">
                      <span className="admin-name">{r.name}</span>
                      <span className="admin-sub">{r.email} · {t('admin.requestedOn', { date: fmtDate(r.createdAt) })}</span>
                    </div>
                    <div className="admin-row-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => setApproving(r.id)}>{t('admin.approve')}</button>
                      <button className="btn btn-danger btn-sm" onClick={() => reject(r.id)}>{t('admin.reject')}</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {approving && (
            <section className="admin-approve">
              <h3 className="admin-h3">{t('admin.grantAccess')}</h3>
              <p className="admin-sub">{t('admin.whichCollections')}</p>
              <div className="admin-switches">
                {KINDS.map((k) => (
                  <Switch
                    key={k}
                    checked={!!draft[k]}
                    onChange={() => setDraft((d) => ({ ...d, [k]: !d[k] }))}
                    label={KIND_LABELS[k]?.() || k}
                  />
                ))}
              </div>
              <div className="admin-features">
                <h4 className="admin-features-title">{t('admin.features')}</h4>
                <p className="admin-sub">{t('admin.whichFeatures')}</p>
                <div className="admin-switches">
                  <Switch
                    checked={!!draft.lending}
                    onChange={() => setDraft((d) => ({ ...d, lending: !d.lending }))}
                    label={t('lending.featureLabel')}
                    hint={t('lending.featureHint')}
                  />
                </div>
              </div>
              <div className="admin-features">
                <h4 className="admin-features-title">{t('admin.plan')}</h4>
                <p className="admin-sub">{t('admin.planFree')} · {t('admin.planUnlimited')}</p>
                <div className="admin-switches">
                  <Switch
                    checked={draft.plan === 'unlimited'}
                    onChange={() => setDraft((d) => ({ ...d, plan: d.plan === 'unlimited' ? 'free' : 'unlimited' }))}
                    label={`${t('admin.plan')}: ${draft.plan === 'unlimited' ? t('admin.planUnlimited') : t('admin.planFree')}`}
                  />
                </div>
              </div>
              <div className="sheet-actions">
                <button
                  className="btn btn-primary"
                  onClick={approve}
                  disabled={!draft.records && !draft.books}
                >
                  {t('admin.generateCode')}
                </button>
                <button className="btn btn-ghost" onClick={() => setApproving(null)}>{t('common.cancel')}</button>
              </div>
            </section>
          )}

          {granted && (
            <section className="admin-code">
              <h3 className="admin-h3">{t('admin.accessCodeFor', { name: granted.user.name })}</h3>
              <p className="admin-sub">{t('admin.shareCodeHint')}</p>
              <div className="admin-code-box">
                <code className="admin-code-text">{granted.code}</code>
                <button className="btn btn-ghost btn-sm" onClick={() => copyText(granted.code, `grant-${granted.code}`)}>
                  {copied === `grant-${granted.code}` ? t('admin.copied') : t('common.copy')}
                </button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setGranted(null)}>{t('common.done')}</button>
            </section>
          )}

          {rotated && (
            <section className="admin-code">
              <h3 className="admin-h3">{t('admin.newCodeFor', { name: rotated.user.name })}</h3>
              <p className="admin-sub">{t('admin.rotatedHint')}</p>
              <div className="admin-code-box">
                <code className="admin-code-text">{rotated.code}</code>
                <button className="btn btn-ghost btn-sm" onClick={() => copyText(rotated.code, `rotate-${rotated.user.id}`)}>
                  {copied === `rotate-${rotated.user.id}` ? t('admin.copied') : t('common.copy')}
                </button>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setRotated(null)}>{t('common.done')}</button>
            </section>
          )}

          <section>
            <h3 className="admin-h3">{t('admin.members')}{members.length ? ` (${members.length})` : ''}</h3>
            {members.length === 0 ? (
              <p className="sheet-empty">{t('admin.noMembers')}</p>
            ) : (
              <ul className="admin-list">
                {members.map((u) => (
                  <li key={u.id} className={`admin-row ${u.status === 'disabled' ? 'is-disabled' : ''}`}>
                    <div className="admin-row-main">
                      <span className="admin-name">
                        {u.name}
                        {u.status === 'disabled' && <span className="admin-status-tag">{t('admin.disabled')}</span>}
                      </span>
                      <span className="admin-sub">{u.email}</span>
                      <div className="admin-switches">
                        {KINDS.map((k) => (
                          <Switch
                            key={k}
                            checked={!!u.collections?.[k]}
                            onChange={() => toggleAccess(u.id, k)}
                            label={KIND_ACCESS_LABELS[k]?.() || k}
                          />
                        ))}
                        <Switch
                          checked={!!u.features?.lending}
                          onChange={() => toggleFeature(u.id)}
                          label={t('lending.featureLabel')}
                          hint={t('lending.featureHint')}
                        />
                        <Switch
                          checked={u.plan === 'unlimited'}
                          onChange={() => togglePlan(u.id)}
                          label={`${t('admin.plan')}: ${u.plan === 'unlimited' ? t('admin.planUnlimited') : t('admin.planFree')}`}
                        />
                      </div>
                    </div>
                    <div className="admin-row-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => rotateCode(u.id)}
                        disabled={rotating === u.id}
                      >
                        {t('admin.rotateCode')}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggleStatus(u.id)}>
                        {u.status === 'active' ? t('admin.disable') : t('admin.enable')}
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeUser(u.id)}>{t('admin.delete')}</button>
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
