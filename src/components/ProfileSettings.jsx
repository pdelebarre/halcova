import { useCallback, useEffect, useState } from 'react'
import * as profilesApi from '../api/profiles'
import { t } from '../i18n'
import './ProfileSettings.css'

export default function ProfileSettings({ userId, onClose }) {
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [visibility, setVisibility] = useState('private')
  const [collectionVisibility, setCollectionVisibility] = useState('private')
  const [links, setLinks] = useState([])

  useEffect(() => {
    let cancelled = false
    profilesApi.getMyProfile()
      .then((p) => {
        if (cancelled) return
        if (p) {
          setProfile(p)
          setUsername(p.username || '')
          setBio(p.bio || '')
          setVisibility(p.visibility || 'private')
          setCollectionVisibility(p.collectionVisibility || 'private')
          setLinks(Array.isArray(p.links) ? p.links : [])
        }
      })
      .catch(() => { /* profile may not exist yet */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [userId])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const updated = await profilesApi.upsertProfile({
        username: username.trim(),
        bio: bio.trim(),
        visibility,
        collectionVisibility,
        links: links.filter((l) => l.label || l.url),
      })
      setProfile(updated)
      setSuccess(t('common.saved'))
    } catch (err) {
      setError(err.message || 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }, [username, bio, visibility, collectionVisibility, links])

  const addLink = useCallback(() => {
    setLinks((prev) => [...prev, { label: '', url: '' }])
  }, [])

  const updateLink = useCallback((index, field, value) => {
    setLinks((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }, [])

  const removeLink = useCallback((index) => {
    setLinks((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const shareUrl = profile?.shareId
    ? `${window.location.origin}/profile/${profile.shareId}`
    : null

  if (loading) {
    return <div className="profile-settings-loading">{t('common.loading')}</div>
  }

  return (
    <div className="profile-settings">
      <h3 className="profile-settings-title">{t('profile.settings')}</h3>

      {error && <div className="profile-settings-error" role="alert">{error}</div>}
      {success && <div className="profile-settings-success" role="status">{success}</div>}

      <div className="profile-settings-field">
        <label htmlFor="profile-username">{t('profile.username')}</label>
        <input
          id="profile-username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={80}
          placeholder={t('profile.usernamePlaceholder')}
        />
      </div>

      <div className="profile-settings-field">
        <label htmlFor="profile-bio">{t('profile.bio')}</label>
        <textarea
          id="profile-bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t('profile.bioPlaceholder')}
        />
      </div>

      <div className="profile-settings-field">
        <label htmlFor="profile-visibility">{t('profile.profileVisibility')}</label>
        <select
          id="profile-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value)}
        >
          <option value="private">{t('profile.visibilityPrivate')}</option>
          <option value="owner">{t('profile.visibilityMembers')}</option>
          <option value="public">{t('profile.visibilityPublic')}</option>
        </select>
      </div>

      <div className="profile-settings-field">
        <label htmlFor="profile-collection-visibility">{t('profile.collectionVisibility')}</label>
        <select
          id="profile-collection-visibility"
          value={collectionVisibility}
          onChange={(e) => setCollectionVisibility(e.target.value)}
        >
          <option value="private">{t('profile.visibilityPrivate')}</option>
          <option value="owner">{t('profile.visibilityMembers')}</option>
          <option value="public">{t('profile.visibilityPublic')}</option>
        </select>
      </div>

      <div className="profile-settings-links">
        <label>{t('profile.links')}</label>
        {links.map((link, i) => (
          <div key={i} className="profile-settings-link-row">
            <input
              type="text"
              value={link.label}
              onChange={(e) => updateLink(i, 'label', e.target.value)}
              placeholder={t('profile.linkLabelPlaceholder')}
              maxLength={50}
            />
            <input
              type="url"
              value={link.url}
              onChange={(e) => updateLink(i, 'url', e.target.value)}
              placeholder={t('profile.linkUrlPlaceholder')}
              maxLength={500}
            />
            <button
              type="button"
              className="profile-settings-link-remove"
              onClick={() => removeLink(i)}
              aria-label={t('common.remove')}
            >
              ✕
            </button>
          </div>
        ))}
        {links.length < 10 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={addLink}>
            + {t('profile.addLink')}
          </button>
        )}
      </div>

      {shareUrl && visibility === 'public' && (
        <div className="profile-settings-share">
          <label>{t('profile.shareUrl')}</label>
          <div className="profile-settings-share-url">
            <input type="text" readOnly value={shareUrl} onClick={(e) => e.target.select()} />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigator.clipboard?.writeText(shareUrl)}
            >
              {t('common.copy')}
            </button>
          </div>
        </div>
      )}

      <div className="profile-settings-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}