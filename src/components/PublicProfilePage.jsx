import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import * as profilesApi from '../api/profiles'
import { t } from '../i18n'
import './PublicProfilePage.css'

export default function PublicProfilePage() {
  const { shareId } = useParams()
  const [profile, setProfile] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeKind, setActiveKind] = useState('records')

  useEffect(() => {
    if (!shareId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      profilesApi.getPublicProfile(shareId),
      profilesApi.getPublicCollection(shareId, activeKind),
    ])
      .then(([prof, coll]) => {
        if (cancelled) return
        if (!prof) {
          setError(t('profile.notFound'))
          return
        }
        setProfile(prof)
        setItems(coll)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || t('profile.loadError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [shareId, activeKind])

  const switchKind = useCallback((kind) => {
    setActiveKind(kind)
  }, [])

  if (loading) {
    return (
      <div className="public-profile-page">
        <div className="public-profile-loading">{t('common.loading')}</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="public-profile-page">
        <div className="public-profile-error">
          <h2>{t('profile.notFound')}</h2>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="public-profile-page">
        <div className="public-profile-error">
          <h2>{t('profile.notFound')}</h2>
        </div>
      </div>
    )
  }

  return (
    <div className="public-profile-page">
      <div className="public-profile-header">
        <div className="public-profile-avatar">
          {profile.avatar ? (
            <img src={profile.avatar} alt={profile.username || t('profile.defaultName')} />
          ) : (
            <div className="public-profile-avatar-placeholder">
              {(profile.username || '?')[0]?.toUpperCase()}
            </div>
          )}
        </div>
        <h1 className="public-profile-username">{profile.username || t('profile.defaultName')}</h1>
        {profile.bio && <p className="public-profile-bio">{profile.bio}</p>}
        {Array.isArray(profile.links) && profile.links.length > 0 && (
          <div className="public-profile-links">
            {profile.links.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="public-profile-link"
              >
                {link.label || link.url}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="public-profile-collections">
        <div className="public-profile-kind-tabs">
          <button
            type="button"
            className={`public-profile-kind-tab ${activeKind === 'records' ? 'active' : ''}`}
            onClick={() => switchKind('records')}
          >
            {t('kind.records')}
          </button>
          <button
            type="button"
            className={`public-profile-kind-tab ${activeKind === 'books' ? 'active' : ''}`}
            onClick={() => switchKind('books')}
          >
            {t('kind.books')}
          </button>
        </div>

        <div className="public-profile-items">
          {items.length === 0 ? (
            <p className="public-profile-empty">{t('profile.emptyCollection')}</p>
          ) : (
            <div className="public-profile-item-grid">
              {items.map((item) => (
                <div key={item.id} className="public-profile-item-card">
                  {item.coverImage && (
                    <div className="public-profile-item-cover">
                      <img src={item.coverImage} alt={item.title || ''} loading="lazy" />
                    </div>
                  )}
                  <div className="public-profile-item-info">
                    <h3 className="public-profile-item-title">{item.title || t('common.untitled')}</h3>
                    {item.artists && <p className="public-profile-item-artist">{item.artists}</p>}
                    {item.authorsList && <p className="public-profile-item-artist">{item.authorsList}</p>}
                    {item.year && <p className="public-profile-item-year">{item.year}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}