import { useCallback, useEffect, useState } from 'react'
import * as authApi from './api/auth'
import * as feedbackApi from './api/feedback'
import { t, getLocale } from './i18n'
import { deviceLabel } from './utils/appInfo'
import './AdminPanel.css'

const KIND_LABELS = { records: () => t('kind.records'), books: () => t('kind.books') }
const KIND_ACCESS_LABELS = { records: () => t('kind.recordsAccess'), books: () => t('kind.booksAccess') }
const KINDS = ['records', 'books']

// Feedback inbox (epic #74, T6 #75) — mirror the allow-lists in
// netlify/functions/feedback.js so a junk value from the server renders a
// safe fallback instead of an unlabeled tag or a crash (no error boundary).
const FB_STATUSES = ['open', 'in_progress', 'done', 'wontfix', 'duplicate']
const FB_TYPES = ['suggestion', 'bug']
const FB_CATEGORIES = new Set(['records', 'books', 'scanner', 'auth', 'billing', 'games', 'lending', 'other'])

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return ''
  }
}

// Timestamp for the inbox rows (date + time, locale-aware). Guarded — a junk or
// missing ISO string degrades to '' instead of throwing.
function fmtDateTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(getLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

// Feedback fields are untrusted server data — every read goes through a guard
// so a malformed item can never dark-screen the panel. Unknown status/type
// fall back to a safe, labeled default rather than leaking a raw value.
function fbText(v) {
  return typeof v === 'string' ? v : ''
}
function fbStatusLabel(item) {
  const s = FB_STATUSES.includes(item?.status) ? item.status : 'open'
  return t(`admin.feedback.status.${s}`)
}
function fbTypeLabel(item) {
  const ty = FB_TYPES.includes(item?.type) ? item.type : 'suggestion'
  return t(`admin.feedback.type.${ty}`)
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

// Dashboard counts are untrusted server data (ADMIN-EPIC-1, #260) — every read
// goes through a guard so a malformed/partial count renders 0 instead of
// throwing (no error boundary → dark screen). Number() also coerces the
// occasional string count from a misconfigured backend.
function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function fmtNum(v) {
  return num(v).toLocaleString(getLocale())
}

// Display-only stat card: a <dl> with a <dt> label + <dd> value so screen
// readers read them as terms/definitions. Deliberately NOT a link/button —
// cards are glance surfaces, not navigation, so they can't be mis-tapped. No
// aria-live: values change on navigation, not in place.
function StatCard({ label, value, caption, className = '' }) {
  return (
    <dl className={`admin-stat-card ${className}`.trim()}>
      <dt className="admin-stat-label">{label}</dt>
      <dd className="admin-stat-value">{value}</dd>
      {caption ? <dd className="admin-stat-caption">{caption}</dd> : null}
    </dl>
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
  const [draft, setDraft] = useState({ records: true, books: true, lending: false, games: false, plan: 'free' })
  const [granted, setGranted] = useState(null) // { user, code } just approved
  const [rotating, setRotating] = useState(null) // userId with a rotate in flight (double-tap guard)
  const [rotated, setRotated] = useState(null) // { user, code } from a rotate — returned exactly once
  const [copied, setCopied] = useState(null) // which code was just copied

  // Feedback inbox (epic #74, T6 #75). Loaded on mount so the Feedback tab's
  // unread badge (open items) is correct before the owner ever clicks it.
  const [tab, setTab] = useState('members') // 'members' | 'feedback' | 'dashboard' | 'ai'
  const [allItems, setAllItems] = useState([]) // full newest-first inbox (badge source)
  const [fbLoading, setFbLoading] = useState(true)
  const [fbError, setFbError] = useState('')
  const [fbStatus, setFbStatus] = useState('') // '' = all statuses
  const [fbType, setFbType] = useState('') // '' = all types
  const [expandedId, setExpandedId] = useState(null) // expanded feedback id
  const [noteDraft, setNoteDraft] = useState('') // admin note draft for the expanded item
  const [fbBusy, setFbBusy] = useState(null) // id with a status/note/delete in flight
  const [noteSaved, setNoteSaved] = useState(false)

  // Dashboard aggregates (ADMIN-EPIC-1, #260). Loaded on mount (mirroring the
  // inbox) so the tab is ready the instant the owner clicks it. `fetchedAt`
  // is set client-side at load for the "Last updated" caption — the counts
  // payload itself carries no timestamp.
  const [counts, setCounts] = useState(null)
  const [dashLoading, setDashLoading] = useState(true)
  const [dashError, setDashError] = useState('')
  const [fetchedAt, setFetchedAt] = useState('')

  // Admin AI settings (ADMIN-3.2, #304): secure LLM provider-profile
  // management. Loaded on mount so the tab is ready when the owner clicks it.
  // The backend never returns secrets — only `secretSet` + a masked tail — so
  // the client stores only display data, never a credential.
  const [aiProfiles, setAiProfiles] = useState([])
  const [aiLoading, setAiLoading] = useState(true)
  const [aiError, setAiError] = useState('')
  const [aiBusy, setAiBusy] = useState(null) // profileId with an op in flight
  const [aiMsg, setAiMsg] = useState('')
  const [aiDraftOpen, setAiDraftOpen] = useState(false)
  const [aiEditing, setAiEditing] = useState(null) // profile being edited (or null = new)
  const [aiDraft, setAiDraft] = useState({ name: '', providerType: 'openai', baseUrl: '', model: '', apiKey: '', capabilities: '' })

  // Admin AI dashboard (ADMIN-3.8, #310): provider health, cost tracking,
  // fallback status and dry-run capability.
  const [aiDashData, setAiDashData] = useState(null)
  const [aiDashLoading, setAiDashLoading] = useState(true)
  const [aiDashError, setAiDashError] = useState('')
  const [aiDashFetchedAt, setAiDashFetchedAt] = useState('')
  const [dryRunLimit, setDryRunLimit] = useState(10)
  const [dryRunResults, setDryRunResults] = useState(null)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [dryRunError, setDryRunError] = useState('')

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

  // Load the full inbox once — the badge (open count) and the filterable list
  // both derive from it, so a triage action updates both in one place.
  const loadFeedback = useCallback(async () => {
    setFbLoading(true)
    setFbError('')
    try {
      const items = await feedbackApi.listFeedback()
      setAllItems(Array.isArray(items) ? items : [])
    } catch (err) {
      // Coded failure (NO_TOKEN without a session, HTTP_ERROR, …) degrades to
      // an empty inbox + an in-tab error state — never an uncaught throw.
      setAllItems([])
      setFbError(err?.message || '')
    } finally {
      setFbLoading(false)
    }
  }, [])

  useEffect(() => { loadFeedback() }, [loadFeedback])

  // Load the dashboard counts (ADMIN-EPIC-1, #260). Every failure degrades to
  // an in-tab error state with retry — never an uncaught throw. The response
  // is `{ requests, users, counts }`; a missing/malformed `counts` is treated
  // as "no data yet" rather than a crash.
  const loadDashboard = useCallback(async () => {
    setDashLoading(true)
    setDashError('')
    try {
      const res = await authApi.adminDashboard()
      setCounts(res?.counts || null)
      setFetchedAt(new Date().toISOString())
    } catch (err) {
      setCounts(null)
      setDashError(err?.message || '')
    } finally {
      setDashLoading(false)
    }
  }, [])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  // Load the AI provider profiles (ADMIN-3.2, #304). Every failure degrades to
  // an in-tab error state with retry — never an uncaught throw.
  const loadAi = useCallback(async () => {
    setAiLoading(true)
    setAiError('')
    try {
      const res = await authApi.adminAiList()
      setAiProfiles(Array.isArray(res?.providers) ? res.providers : [])
    } catch (err) {
      setAiProfiles([])
      setAiError(err?.message || '')
    } finally {
      setAiLoading(false)
    }
  }, [])

  useEffect(() => { loadAi() }, [loadAi])

  // Load the AI dashboard aggregates (ADMIN-3.8, #310). Every failure degrades
  // to an in-tab error state with retry — never an uncaught throw.
  const loadAiDashboard = useCallback(async () => {
    setAiDashLoading(true)
    setAiDashError('')
    try {
      const res = await authApi.adminAiDashboard()
      setAiDashData(res?.aiDashboard || null)
      setAiDashFetchedAt(new Date().toISOString())
    } catch (err) {
      setAiDashData(null)
      setAiDashError(err?.message || '')
    } finally {
      setAiDashLoading(false)
    }
  }, [])

  useEffect(() => { loadAiDashboard() }, [loadAiDashboard])

  // Run a dry-run evaluation (ADMIN-3.8, #310).
  const runDryRun = useCallback(async () => {
    setDryRunLoading(true)
    setDryRunError('')
    setDryRunResults(null)
    try {
      const res = await authApi.adminAiDryRun({ limit: dryRunLimit })
      setDryRunResults(res)
    } catch (err) {
      setDryRunError(err?.message || '')
    } finally {
      setDryRunLoading(false)
    }
  }, [dryRunLimit])

  // The active profile's secret is never sent back to the client, so opening
  // the edit form for an existing profile leaves the apiKey blank — a blank
  // apiKey on save means "keep the stored secret unchanged".
  const openAiDraft = (profile) => {
    setAiEditing(profile || null)
    setAiDraft({
      name: profile?.name || '',
      providerType: profile?.providerType || 'openai',
      baseUrl: profile?.baseUrl || '',
      model: profile?.model || '',
      apiKey: '',
      capabilities: Array.isArray(profile?.capabilities) ? profile.capabilities.join(', ') : '',
    })
    setAiDraftOpen(true)
    setAiMsg('')
  }

  const closeAiDraft = () => {
    setAiDraftOpen(false)
    setAiEditing(null)
  }

  const saveAiProfile = async () => {
    setAiMsg('')
    setAiBusy('__form__')
    try {
      const capabilities = aiDraft.capabilities.split(',').map((s) => s.trim()).filter(Boolean)
      const payload = {
        name: aiDraft.name,
        providerType: aiDraft.providerType,
        baseUrl: aiDraft.baseUrl,
        model: aiDraft.model,
        capabilities,
        ...(aiDraft.apiKey ? { apiKey: aiDraft.apiKey } : {}),
      }
      if (aiEditing) {
        await authApi.adminAiUpdate({ profileId: aiEditing.id, ...payload })
      } else {
        await authApi.adminAiCreate(payload)
      }
      await loadAi()
      closeAiDraft()
      setAiMsg(aiEditing ? t('admin.ai.saved') : t('admin.ai.created'))
    } catch (err) {
      setAiMsg(err?.message || '')
    } finally {
      setAiBusy(null)
    }
  }

  const testAiProfile = async (profileId) => {
    setAiMsg('')
    setAiBusy(profileId)
    try {
      await authApi.adminAiTest({ profileId })
      setAiMsg(t('admin.ai.testOk'))
      await loadAi()
    } catch (err) {
      setAiMsg(err?.message || t('admin.ai.testFail'))
    } finally {
      setAiBusy(null)
    }
  }

  const activateAiProfile = async (profileId) => {
    setAiMsg('')
    setAiBusy(profileId)
    try {
      await authApi.adminAiActivate({ profileId })
      setAiMsg(t('admin.ai.activated'))
      await loadAi()
    } catch (err) {
      setAiMsg(err?.message || t('admin.ai.activateFail'))
    } finally {
      setAiBusy(null)
    }
  }

  const deleteAiProfile = async (profileId) => {
    setAiMsg('')
    setAiBusy(profileId)
    try {
      await authApi.adminAiDelete({ profileId })
      setAiMsg(t('admin.ai.deleted'))
      await loadAi()
    } catch (err) {
      setAiMsg(err?.message || '')
    } finally {
      setAiBusy(null)
    }
  }

  const unread = allItems.filter((i) => i?.status === 'open').length
  const visibleItems = allItems.filter((i) =>
    (!fbStatus || i?.status === fbStatus) && (!fbType || i?.type === fbType)
  )

  async function approve() {
    setError('')
    try {
      const res = await authApi.adminApprove({
        requestId: approving,
        collections: { records: draft.records, books: draft.books },
        // Full features map — the server's sanitizeFeatures rebuilds the whole
        // map from whatever is sent, so always send both flags together.
        features: { lending: draft.lending, games: draft.games },
        plan: draft.plan,
      })
      setGranted(res)
      setApproving(null)
      setDraft({ records: true, books: true, lending: false, games: false, plan: 'free' })
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

  // Feature toggles MUST send the FULL features map: the server's
  // sanitizeFeatures rebuilds the whole map from whatever the client sends, so
  // sending only the flipped flag would silently wipe the other one. Toggle
  // the target flag while preserving the current value of the other.
  async function toggleFeature(userId) {
    const user = data.users.find((u) => u.id === userId)
    if (!user) return
    setError('')
    try {
      await authApi.adminUpdateUser({
        userId,
        features: { lending: !user.features?.lending, games: !!user.features?.games },
      })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleGames(userId) {
    const user = data.users.find((u) => u.id === userId)
    if (!user) return
    setError('')
    try {
      await authApi.adminUpdateUser({
        userId,
        features: { lending: !!user.features?.lending, games: !user.features?.games },
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

  function toggleExpand(item) {
    if (expandedId === item.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(item.id)
    setNoteDraft(fbText(item?.adminNote))
    setNoteSaved(false)
  }

  // Triage actions — each PATCH/DELETE is guarded by fbBusy (double-tap) and
  // updates allItems in place from the server's response so the badge + list
  // stay consistent; a malformed response falls back to a full reload.
  function replaceItem(updated) {
    if (updated?.id) {
      setAllItems((items) => items.map((i) => (i.id === updated.id ? updated : i)))
      return true
    }
    return false
  }

  async function changeStatus(item, status) {
    if (fbBusy) return
    setError('')
    setFbBusy(item.id)
    try {
      const updated = await feedbackApi.updateFeedback({ id: item.id, status })
      if (!replaceItem(updated)) await loadFeedback()
    } catch (err) {
      setError(err?.message || '')
    } finally {
      setFbBusy(null)
    }
  }

  async function saveNote(item) {
    if (fbBusy) return
    setError('')
    setFbBusy(item.id)
    setNoteSaved(false)
    try {
      const updated = await feedbackApi.updateFeedback({ id: item.id, adminNote: noteDraft })
      if (!replaceItem(updated)) await loadFeedback()
      setNoteDraft(fbText(updated?.adminNote))
      setNoteSaved(true)
    } catch (err) {
      setError(err?.message || '')
    } finally {
      setFbBusy(null)
    }
  }

  // Two-step delete, mirroring member delete: a confirm() gate before the call.
  async function deleteItem(item) {
    if (fbBusy) return
    if (!window.confirm(t('admin.feedback.deleteConfirm'))) return
    setError('')
    setFbBusy(item.id)
    try {
      await feedbackApi.deleteFeedback(item.id)
      setAllItems((items) => items.filter((i) => i.id !== item.id))
      if (expandedId === item.id) {
        setExpandedId(null)
        setNoteDraft('')
        setNoteSaved(false)
      }
    } catch (err) {
      setError(err?.message || '')
    } finally {
      setFbBusy(null)
    }
  }

  const pending = data.requests.filter((r) => r.status === 'pending')
  const members = data.users.filter((u) => u.role !== 'admin')

  // Guarded dashboard reads (ADMIN-EPIC-1, #260) — a malformed/partial counts
  // payload must render 0s, never throw (no error boundary → dark screen).
  const c = counts || {}
  const dashMembers = c.members || {}
  const dashSignups = c.signups || {}
  const dashPlans = c.plans || {}
  const dashCollections = c.collections || {}
  const dashFeedback = c.feedback || {}
  const dashReviews = c.reviews || {}

  return (
    <div className="sheet-overlay" role="dialog" aria-modal="true" aria-label={t('common.adminPanel')}>
      <div className="sheet admin-sheet">
        <div className="sheet-header">
          <h2>{t('common.adminPanel')}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        {error && <p className="sheet-error admin-error">{error}</p>}

        <div className="admin-tabs" role="tablist" aria-label={t('common.adminPanel')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'members'}
            className={`admin-tab${tab === 'members' ? ' active' : ''}`}
            onClick={() => setTab('members')}
          >
            {t('admin.tab.members')}
            {/* Members-tab pending badge (ADMIN-EPIC-1, #263) — reuses the
                already-loaded data.requests (zero extra fetch) and the same
                .admin-badge pattern the Feedback tab uses. */}
            {pending.length > 0 && (
              <span className="admin-badge" aria-label={t('admin.dashboard.pendingBadge', { n: pending.length })}>
                {pending.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'feedback'}
            className={`admin-tab${tab === 'feedback' ? ' active' : ''}`}
            onClick={() => setTab('feedback')}
          >
            {t('admin.tab.feedback')}
            {unread > 0 && (
              <span className="admin-badge" aria-label={t('admin.feedback.unread', { n: unread })}>
                {unread}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'dashboard'}
            className={`admin-tab${tab === 'dashboard' ? ' active' : ''}`}
            onClick={() => setTab('dashboard')}
          >
            {t('admin.tab.dashboard')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'ai'}
            className={`admin-tab${tab === 'ai' ? ' active' : ''}`}
            onClick={() => setTab('ai')}
          >
            {t('admin.tab.ai')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'aiDashboard'}
            className={`admin-tab${tab === 'aiDashboard' ? ' active' : ''}`}
            onClick={() => setTab('aiDashboard')}
          >
            {t('admin.tab.aiDashboard')}
          </button>
        </div>

        <div className="admin-scroll">
          {tab === 'members' ? (
            <>
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
                  <Switch
                    checked={!!draft.games}
                    onChange={() => setDraft((d) => ({ ...d, games: !d.games }))}
                    label={t('games.featureLabel')}
                    hint={t('games.featureHint')}
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
                          checked={!!u.features?.games}
                          onChange={() => toggleGames(u.id)}
                          label={t('games.featureLabel')}
                          hint={t('games.featureHint')}
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
            </>
          ) : tab === 'dashboard' ? (
            <section>
              {/* Admin dashboard (ADMIN-EPIC-1, #260) — aggregate stat cards
                  from GET /admin?dashboard=1 (T1 backend). Display-only <dl>
                  cards (no links, no aria-live); every read guarded so a
                  malformed count degrades to 0 instead of throwing. */}
              <h3 className="admin-h3">{t('admin.dashboard.title')}</h3>

              {dashLoading ? (
                <div className="admin-dash-grid" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="admin-stat-card admin-dash-skeleton" />
                  ))}
                </div>
              ) : dashError ? (
                <p className="sheet-error" role="alert">
                  {dashError}
                  <button type="button" className="btn btn-ghost btn-sm admin-fb-retry" onClick={loadDashboard}>
                    {t('admin.dashboard.retry')}
                  </button>
                </p>
              ) : !counts ? (
                <p className="sheet-empty">{t('admin.dashboard.empty')}</p>
              ) : (
                <>
                  {/* Pending requests — the one number the owner must not
                      miss: a full-width card with a red edge. */}
                  <div className="admin-dash-pending">
                    <StatCard
                      className="is-pending"
                      label={t('admin.dashboard.section.pending')}
                      value={fmtNum(c.pendingRequests)}
                      caption={t('admin.dashboard.pendingCaption')}
                    />
                  </div>

                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.dashboard.section.members')}</h4>
                    <div className="admin-dash-grid">
                      <StatCard label={t('admin.dashboard.member.total')} value={fmtNum(dashMembers.total)} />
                      <StatCard label={t('admin.dashboard.member.active')} value={fmtNum(dashMembers.active)} />
                      <StatCard label={t('admin.dashboard.member.disabled')} value={fmtNum(dashMembers.disabled)} />
                    </div>
                  </section>

                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.dashboard.section.signups')}</h4>
                    <div className="admin-dash-grid">
                      <StatCard label={t('admin.dashboard.signup.today')} value={fmtNum(dashSignups.today)} />
                      <StatCard label={t('admin.dashboard.signup.week')} value={fmtNum(dashSignups.thisWeek)} />
                      <StatCard label={t('admin.dashboard.signup.month')} value={fmtNum(dashSignups.thisMonth)} />
                      <StatCard label={t('admin.dashboard.signup.total')} value={fmtNum(dashSignups.total)} />
                    </div>
                  </section>

                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.dashboard.section.plans')}</h4>
                    <div className="admin-dash-grid">
                      <StatCard label={t('admin.dashboard.plan.free')} value={fmtNum(dashPlans.free)} />
                      <StatCard label={t('admin.dashboard.plan.premium')} value={fmtNum(dashPlans.premium)} />
                      <StatCard label={t('admin.dashboard.plan.lifetime')} value={fmtNum(dashPlans.lifetime)} />
                      <StatCard label={t('admin.dashboard.plan.unlimited')} value={fmtNum(dashPlans.unlimited)} />
                    </div>
                  </section>

                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.dashboard.section.collection')}</h4>
                    <div className="admin-dash-grid">
                      <StatCard label={t('admin.dashboard.collection.records')} value={fmtNum(dashCollections.records)} />
                      <StatCard label={t('admin.dashboard.collection.books')} value={fmtNum(dashCollections.books)} />
                    </div>
                  </section>

                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.dashboard.section.feedback')}</h4>
                    <div className="admin-dash-grid">
                      <StatCard label={t('admin.feedback.status.open')} value={fmtNum(dashFeedback.open)} />
                      <StatCard label={t('admin.feedback.status.in_progress')} value={fmtNum(dashFeedback.in_progress)} />
                      <StatCard label={t('admin.feedback.status.done')} value={fmtNum(dashFeedback.done)} />
                      <StatCard label={t('admin.feedback.status.wontfix')} value={fmtNum(dashFeedback.wontfix)} />
                      <StatCard label={t('admin.feedback.status.duplicate')} value={fmtNum(dashFeedback.duplicate)} />
                      <StatCard label={t('admin.dashboard.feedback.total')} value={fmtNum(dashFeedback.total)} />
                    </div>
                  </section>

                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.dashboard.section.reviews')}</h4>
                    <div className="admin-dash-grid">
                      <StatCard label={t('admin.dashboard.review.total')} value={fmtNum(dashReviews.total)} />
                      <StatCard label={t('admin.dashboard.review.published')} value={fmtNum(dashReviews.published)} />
                      <StatCard label={t('admin.dashboard.review.pending')} value={fmtNum(dashReviews.pending)} />
                      <StatCard label={t('admin.dashboard.review.hidden')} value={fmtNum(dashReviews.hidden)} />
                    </div>
                  </section>

                  {fetchedAt && (
                    <p className="admin-dash-updated">{t('admin.dashboard.updated', { time: fmtDateTime(fetchedAt) })}</p>
                  )}
                </>
              )}
            </section>
          ) : tab === 'ai' ? (
            <section>
              {/* Admin AI settings (ADMIN-3.2, #304) — secure LLM provider-profile
                  management. Secrets are never returned by the backend (only
                  secretSet + a masked tail), so this UI can show "a secret is set"
                  without ever receiving the credential. */}
              <h3 className="admin-h3">{t('admin.ai.title')}</h3>
              <p className="admin-sub">{t('admin.ai.subtitle')}</p>

              {aiMsg && <p className="sheet-status" role="status">{aiMsg}</p>}
              {aiError && (
                <p className="sheet-error" role="alert">
                  {aiError}
                  <button type="button" className="btn btn-ghost btn-sm admin-fb-retry" onClick={loadAi}>
                    {t('admin.dashboard.retry')}
                  </button>
                </p>
              )}

              <div className="admin-row-actions admin-ai-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openAiDraft(null)}>
                  {t('admin.ai.add')}
                </button>
              </div>

              {aiLoading ? (
                <p className="sheet-status">{t('common.loading')}</p>
              ) : aiProfiles.length === 0 && !aiError ? (
                <p className="sheet-empty">{t('admin.ai.empty')}</p>
              ) : (
                <ul className="admin-list">
                  {aiProfiles.map((p) => (
                    <li key={p.id} className="admin-row">
                      <div className="admin-row-main">
                        <span className="admin-name">
                          {p.name || t('admin.ai.unnamed')}
                          {p.active ? <span className="admin-badge">{t('admin.ai.active')}</span> : null}
                        </span>
                        <span className="admin-sub">
                          {p.providerType} · {p.model} · {p.baseUrl}
                        </span>
                        <span className="admin-sub">
                          {p.secretSet ? t('admin.ai.secretSet') : t('admin.ai.secretMissing')}
                          {p.lastTestOk ? ` · ${t('admin.ai.lastTestOk')}` : ''}
                        </span>
                      </div>
                      <div className="admin-row-actions">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => testAiProfile(p.id)}
                          disabled={aiBusy === p.id}
                        >
                          {t('admin.ai.test')}
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => activateAiProfile(p.id)}
                          disabled={aiBusy === p.id || p.active}
                        >
                          {t('admin.ai.activate')}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openAiDraft(p)}>
                          {t('admin.ai.edit')}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteAiProfile(p.id)}>
                          {t('admin.delete')}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {aiDraftOpen && (
                <section className="admin-approve">
                  <h3 className="admin-h3">
                    {aiEditing ? t('admin.ai.editTitle') : t('admin.ai.newTitle')}
                  </h3>
                  <div className="admin-field">
                    <label htmlFor="ai-name">{t('admin.ai.name')}</label>
                    <input
                      id="ai-name"
                      type="text"
                      value={aiDraft.name}
                      onChange={(e) => setAiDraft((d) => ({ ...d, name: e.target.value }))}
                      maxLength={80}
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="ai-provider">{t('admin.ai.providerType')}</label>
                    <select
                      id="ai-provider"
                      value={aiDraft.providerType}
                      onChange={(e) => setAiDraft((d) => ({ ...d, providerType: e.target.value }))}
                    >
                      <option value="openai">OpenAI-compatible</option>
                    </select>
                  </div>
                  <div className="admin-field">
                    <label htmlFor="ai-baseurl">{t('admin.ai.baseUrl')}</label>
                    <input
                      id="ai-baseurl"
                      type="url"
                      value={aiDraft.baseUrl}
                      onChange={(e) => setAiDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                      placeholder="https://api.openai.com/v1"
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="ai-model">{t('admin.ai.model')}</label>
                    <input
                      id="ai-model"
                      type="text"
                      value={aiDraft.model}
                      onChange={(e) => setAiDraft((d) => ({ ...d, model: e.target.value }))}
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="ai-cap">{t('admin.ai.capabilities')}</label>
                    <input
                      id="ai-cap"
                      type="text"
                      value={aiDraft.capabilities}
                      onChange={(e) => setAiDraft((d) => ({ ...d, capabilities: e.target.value }))}
                      placeholder="classify, deduplicate, prioritize"
                    />
                  </div>
                  <div className="admin-field">
                    <label htmlFor="ai-key">{t('admin.ai.apiKey')}</label>
                    <input
                      id="ai-key"
                      type="password"
                      autoComplete="off"
                      value={aiDraft.apiKey}
                      onChange={(e) => setAiDraft((d) => ({ ...d, apiKey: e.target.value }))}
                      placeholder={aiEditing ? t('admin.ai.keyPlaceholder') : ''}
                    />
                    <p className="admin-sub">{t('admin.ai.keyHint')}</p>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={saveAiProfile}
                      disabled={aiBusy === '__form__'}
                    >
                      {t('common.save')}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={closeAiDraft}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </section>
              )}
            </section>
          ) : tab === 'aiDashboard' ? (
            <section>
              {/* Admin AI dashboard (ADMIN-3.8, #310) — provider health, cost
                  tracking, fallback status and dry-run capability. */}
              <h3 className="admin-h3">{t('admin.aiDashboard.title')}</h3>
              <p className="admin-sub">{t('admin.aiDashboard.subtitle')}</p>

              {aiDashLoading ? (
                <p className="sheet-status">{t('admin.aiDashboard.loading')}</p>
              ) : aiDashError ? (
                <p className="sheet-error" role="alert">
                  {aiDashError}
                  <button type="button" className="btn btn-ghost btn-sm admin-fb-retry" onClick={loadAiDashboard}>
                    {t('admin.aiDashboard.retry')}
                  </button>
                </p>
              ) : !aiDashData ? (
                <p className="sheet-empty">{t('admin.aiDashboard.empty')}</p>
              ) : (
                <>
                  {/* Provider health section */}
                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.aiDashboard.section.health')}</h4>
                    <div className="admin-dash-grid">
                      {aiDashData.providers?.filter((p) => p.active).length > 0 ? (
                        aiDashData.providers.filter((p) => p.active).map((p) => (
                          <div key={p.id} className="admin-stat-card">
                            <dt className="admin-stat-label">{t('admin.aiDashboard.activeProvider')}</dt>
                            <dd className="admin-stat-value">{p.name}</dd>
                            <dd className="admin-stat-caption">{p.providerType} · {p.model}</dd>
                          </div>
                        ))
                      ) : (
                        <div className="admin-stat-card">
                          <dt className="admin-stat-label">{t('admin.aiDashboard.activeProvider')}</dt>
                          <dd className="admin-stat-value">{t('admin.aiDashboard.noActiveProvider')}</dd>
                        </div>
                      )}
                      {aiDashData.providers?.filter((p) => p.fallbackProviderId).length > 0 ? (
                        <div className="admin-stat-card">
                          <dt className="admin-stat-label">{t('admin.aiDashboard.fallbackProvider')}</dt>
                          <dd className="admin-stat-value">{t('admin.aiDashboard.yes')}</dd>
                        </div>
                      ) : (
                        <div className="admin-stat-card">
                          <dt className="admin-stat-label">{t('admin.aiDashboard.fallbackProvider')}</dt>
                          <dd className="admin-stat-value">{t('admin.aiDashboard.noFallback')}</dd>
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Usage & cost section — 7-day and 30-day aggregates */}
                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.aiDashboard.section.cost')}</h4>

                    {[7, 30].map((days) => {
                      const agg = days === 7 ? aiDashData.aggregates?.days7 : aiDashData.aggregates?.days30
                      if (!agg) return null
                      return (
                        <div key={days}>
                          <h5 className="admin-h4">{days === 7 ? t('admin.aiDashboard.period.7d') : t('admin.aiDashboard.period.30d')}</h5>
                          <div className="admin-dash-grid">
                            <StatCard label={t('admin.aiDashboard.totalCalls')} value={agg.total} />
                            <StatCard label={t('admin.aiDashboard.ok')} value={agg.ok} />
                            <StatCard label={t('admin.aiDashboard.fail')} value={agg.fail} />
                            <StatCard label={t('admin.aiDashboard.avgLatency')} value={t('admin.aiDashboard.ms', { n: agg.avgLatencyMs })} />
                            <StatCard label={t('admin.aiDashboard.totalTokens')} value={fmtNum(agg.totalTokensIn + agg.totalTokensOut)} />
                            <StatCard label={t('admin.aiDashboard.totalCost')} value={t('admin.aiDashboard.usd', { n: agg.totalCost.toFixed(4) })} />
                          </div>
                          {/* Per-provider breakdown */}
                          {Object.keys(agg.byProvider || {}).length > 0 && (
                            <table className="admin-dash-table">
                              <thead>
                                <tr>
                                  <th>{t('admin.aiDashboard.provider')}</th>
                                  <th>{t('admin.aiDashboard.calls')}</th>
                                  <th>{t('admin.aiDashboard.ok')}</th>
                                  <th>{t('admin.aiDashboard.fail')}</th>
                                  <th>{t('admin.aiDashboard.latency')}</th>
                                  <th>{t('admin.aiDashboard.cost')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Object.entries(agg.byProvider).map(([provider, stats]) => (
                                  <tr key={provider}>
                                    <td>{provider}</td>
                                    <td>{stats.calls}</td>
                                    <td>{stats.ok}</td>
                                    <td>{stats.fail}</td>
                                    <td>{t('admin.aiDashboard.ms', { n: stats.calls > 0 ? Math.round(stats.latencyMs / stats.calls) : 0 })}</td>
                                    <td>{t('admin.aiDashboard.usd', { n: stats.cost.toFixed(4) })}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )
                    })}
                  </section>

                  {/* Fallback & cooldown section */}
                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.aiDashboard.section.fallback')}</h4>
                    {aiDashData.cooldowns?.length > 0 ? (
                      <ul className="admin-list">
                        {aiDashData.cooldowns.map((c) => (
                          <li key={c.providerId} className="admin-row">
                            <span className="admin-name">{t('admin.aiDashboard.cooldown')}</span>
                            <span className="admin-sub">
                              {t('admin.aiDashboard.cooldownRemaining', { s: Math.round(c.remainingMs / 1000) })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="sheet-empty">{t('admin.aiDashboard.cooldownNone')}</p>
                    )}
                  </section>

                  {/* Dry-run section */}
                  <section className="admin-dash-section">
                    <h4 className="admin-h3">{t('admin.aiDashboard.section.dryrun')}</h4>
                    <p className="admin-sub">{t('admin.aiDashboard.dryrun.description')}</p>

                    <div className="admin-field">
                      <label htmlFor="dryrun-limit">{t('admin.aiDashboard.dryrun.label')}</label>
                      <select
                        id="dryrun-limit"
                        value={dryRunLimit}
                        onChange={(e) => setDryRunLimit(Number(e.target.value))}
                      >
                        <option value={1}>1</option>
                        <option value={10}>10</option>
                        <option value={50}>50</option>
                      </select>
                    </div>

                    <div className="admin-row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={runDryRun}
                        disabled={dryRunLoading || !aiDashData.providers?.some((p) => p.active)}
                      >
                        {dryRunLoading ? t('admin.aiDashboard.dryrun.running') : t('admin.aiDashboard.dryrun.run')}
                      </button>
                    </div>

                    {dryRunError && <p className="sheet-error" role="alert">{dryRunError}</p>}

                    {dryRunResults?.error ? (
                      <p className="sheet-error" role="alert">{dryRunResults.error.message}</p>
                    ) : dryRunResults?.summary ? (
                      <div className="admin-dryrun-results">
                        <h5 className="admin-h4">{t('admin.aiDashboard.dryrun.results')}</h5>
                        <div className="admin-dash-grid">
                          <StatCard label={t('admin.aiDashboard.totalCalls')} value={dryRunResults.summary.total} />
                          <StatCard label={t('admin.aiDashboard.ok')} value={dryRunResults.summary.ok} />
                          <StatCard label={t('admin.aiDashboard.fail')} value={dryRunResults.summary.fail} />
                          <StatCard label={t('admin.aiDashboard.avgLatency')} value={t('admin.aiDashboard.ms', { n: dryRunResults.summary.avgLatencyMs })} />
                          <StatCard label={t('admin.aiDashboard.totalCost')} value={t('admin.aiDashboard.usd', { n: dryRunResults.summary.totalCost.toFixed(4) })} />
                        </div>

                        {dryRunResults.results?.length > 0 && (
                          <table className="admin-dash-table">
                            <thead>
                              <tr>
                                <th>{t('admin.aiDashboard.dryrun.feedbackId')}</th>
                                <th>{t('admin.aiDashboard.dryrun.classification')}</th>
                                <th>{t('admin.aiDashboard.dryrun.summary')}</th>
                                <th>{t('admin.aiDashboard.dryrun.confidence')}</th>
                                <th>{t('admin.aiDashboard.dryrun.latency')}</th>
                                <th>{t('admin.aiDashboard.dryrun.cost')}</th>
                                <th>{t('admin.aiDashboard.dryrun.status')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {dryRunResults.results.map((r) => (
                                <tr key={r.feedbackId}>
                                  <td className="admin-dash-cell-id">{r.feedbackId?.slice(0, 8)}…</td>
                                  <td>{r.ok ? r.classification : '—'}</td>
                                  <td className="admin-dash-cell-summary">{r.ok ? r.summary?.slice(0, 60) : '—'}</td>
                                  <td>{r.ok ? (r.confidence * 100).toFixed(0) + '%' : '—'}</td>
                                  <td>{t('admin.aiDashboard.ms', { n: r.latencyMs })}</td>
                                  <td>{r.costEstimate != null ? t('admin.aiDashboard.usd', { n: r.costEstimate.toFixed(6) }) : '—'}</td>
                                  <td>
                                    {r.ok
                                      ? <span className="admin-badge" style={{ background: 'var(--green, #2e7d32)' }}>{t('admin.aiDashboard.dryrun.success')}</span>
                                      : <span className="admin-badge" style={{ background: 'var(--red, #c62828)' }}>{t('admin.aiDashboard.dryrun.fail')}</span>
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ) : (
                      <p className="sheet-empty">{t('admin.aiDashboard.dryrun.noResults')}</p>
                    )}
                  </section>

                  {aiDashFetchedAt && (
                    <p className="admin-dash-updated">{t('admin.aiDashboard.updated', { time: fmtDateTime(aiDashFetchedAt) })}</p>
                  )}
                </>
              )}
            </section>
          ) : (
            <section>
              {/* Feedback inbox — owner-only triage (epic #74, T6 #75) */}
              <h3 className="admin-h3">{t('admin.tab.feedback')}</h3>

              <div className="admin-fb-filters" role="group" aria-label={t('admin.feedback.filterStatus')}>
                <button
                  type="button"
                  aria-pressed={fbStatus === ''}
                  className={`admin-fb-chip${fbStatus === '' ? ' active' : ''}`}
                  onClick={() => setFbStatus('')}
                >
                  {t('admin.feedback.allStatuses')}
                </button>
                {FB_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={fbStatus === s}
                    className={`admin-fb-chip${fbStatus === s ? ' active' : ''}`}
                    onClick={() => setFbStatus(s)}
                  >
                    {t(`admin.feedback.status.${s}`)}
                  </button>
                ))}
              </div>

              <div className="admin-fb-filters" role="group" aria-label={t('admin.feedback.filterType')}>
                <button
                  type="button"
                  aria-pressed={fbType === ''}
                  className={`admin-fb-chip${fbType === '' ? ' active' : ''}`}
                  onClick={() => setFbType('')}
                >
                  {t('admin.feedback.allTypes')}
                </button>
                {FB_TYPES.map((ty) => (
                  <button
                    key={ty}
                    type="button"
                    aria-pressed={fbType === ty}
                    className={`admin-fb-chip${fbType === ty ? ' active' : ''}`}
                    onClick={() => setFbType(ty)}
                  >
                    {t(`admin.feedback.type.${ty}`)}
                  </button>
                ))}
              </div>

              {fbLoading ? (
                <p className="sheet-status">{t('common.loading')}</p>
              ) : fbError ? (
                <p className="sheet-error" role="alert">
                  {fbError}
                  <button type="button" className="btn btn-ghost btn-sm admin-fb-retry" onClick={loadFeedback}>
                    {t('admin.feedback.retry')}
                  </button>
                </p>
              ) : visibleItems.length === 0 ? (
                <p className="sheet-empty">
                  {allItems.length === 0 ? t('admin.feedback.empty') : t('admin.feedback.emptyFiltered')}
                </p>
              ) : (
                <ul className="admin-list">
                  {visibleItems.map((item) => (
                    <li key={item.id} className="admin-fb-item">
                      <button
                        type="button"
                        className="admin-fb-head"
                        aria-expanded={expandedId === item.id}
                        onClick={() => toggleExpand(item)}
                      >
                        <span className="admin-fb-tags">
                          <span className={`admin-fb-tag is-${item?.type === 'bug' ? 'bug' : 'suggestion'}`}>
                            {fbTypeLabel(item)}
                          </span>
                          <span className={`admin-fb-tag is-status is-${item?.status || 'open'}`}>
                            {fbStatusLabel(item)}
                          </span>
                          {FB_CATEGORIES.has(item?.category) && (
                            <span className="admin-fb-tag">{t(`feedback.category.${item.category}`)}</span>
                          )}
                        </span>
                        <span className="admin-fb-snippet">
                          {fbText(item?.message).slice(0, 140) || t('feedback.contextEmpty')}
                        </span>
                        <span className="admin-fb-meta">
                          {t('admin.feedback.from', { name: fbText(item?.authorName) || t('feedback.contextEmpty') })}
                          {fmtDateTime(item?.createdAt) ? ` · ${fmtDateTime(item?.createdAt)}` : ''}
                        </span>
                        <span className="admin-fb-chevron" aria-hidden="true">
                          {expandedId === item.id ? '▾' : '▸'}
                        </span>
                      </button>

                      {expandedId === item.id && (
                        <div className="admin-fb-detail">
                          <p className="admin-fb-message">{fbText(item?.message) || t('feedback.contextEmpty')}</p>

                          <dl className="admin-fb-context">
                            <div>
                              <dt>{t('admin.feedback.route')}</dt>
                              <dd>{fbText(item?.url) || t('feedback.contextEmpty')}</dd>
                            </div>
                            <div>
                              <dt>{t('admin.feedback.version')}</dt>
                              <dd>{fbText(item?.appVersion) || t('feedback.contextEmpty')}</dd>
                            </div>
                            <div>
                              <dt>{t('admin.feedback.device')}</dt>
                              <dd>{deviceLabel(fbText(item?.userAgent)) || t('feedback.contextEmpty')}</dd>
                            </div>
                            <div>
                              <dt>{t('admin.feedback.agent')}</dt>
                              <dd>{fbText(item?.userAgent) || t('feedback.contextEmpty')}</dd>
                            </div>
                          </dl>

                          <div className="admin-fb-status" role="group" aria-label={t('admin.feedback.statusActions')}>
                            {FB_STATUSES.map((s) => (
                              <button
                                key={s}
                                type="button"
                                aria-pressed={item?.status === s}
                                className={`admin-fb-chip${item?.status === s ? ' active' : ''}`}
                                disabled={fbBusy === item.id}
                                onClick={() => changeStatus(item, s)}
                              >
                                {t(`admin.feedback.status.${s}`)}
                              </button>
                            ))}
                          </div>

                          <div className="admin-fb-note">
                            <label className="admin-fb-note-label" htmlFor={`fb-note-${item.id}`}>
                              {t('admin.feedback.noteLabel')}
                            </label>
                            <textarea
                              id={`fb-note-${item.id}`}
                              className="admin-fb-note-input"
                              rows={3}
                              value={noteDraft}
                              placeholder={t('admin.feedback.notePlaceholder')}
                              onChange={(e) => {
                                setNoteDraft(e.target.value)
                                setNoteSaved(false)
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={fbBusy === item.id}
                              onClick={() => saveNote(item)}
                            >
                              {fbBusy === item.id
                                ? t('admin.feedback.saving')
                                : noteSaved ? t('admin.feedback.noteSaved') : t('admin.feedback.saveNote')}
                            </button>
                          </div>

                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={fbBusy === item.id}
                            onClick={() => deleteItem(item)}
                          >
                            {t('admin.feedback.delete')}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
