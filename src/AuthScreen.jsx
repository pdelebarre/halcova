import { useState } from 'react'
import { t } from './i18n'
import './AuthScreen.css'

// First screen a visitor sees. Two paths:
//   - "I have an access code" — members/owner sign in (code validated server-side)
//   - "Request access" — creates a pending request the admin approves
export default function AuthScreen({ onLogin, onRequestAccess }) {
  const [mode, setMode] = useState('welcome') // welcome | login | request | sent
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onLogin(code.trim())
      // Success unmounts this screen (App renders the collection).
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  async function handleRequest(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onRequestAccess({ name, email })
      setMode('sent')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'sent') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Hokan</h1>
          <p className="auth-done">{t('auth.requestSent')}</p>
          <p className="auth-copy">
            {t('auth.requestSentBody')}
          </p>
          <button className="btn btn-ghost btn-block" onClick={() => { setMode('welcome'); setError('') }}>
            {t('common.back')}
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'login') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Hokan</h1>
          <p className="auth-copy">{t('auth.enterCode')}</p>
          <form onSubmit={handleLogin} className="auth-form" noValidate>
            <input
              className={`auth-input auth-code${error ? ' invalid' : ''}`}
              type="text"
              value={code}
              onChange={(e) => { setCode(e.target.value); if (error) setError('') }}
              placeholder="RU-XXXX-XXXX-XXXX"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-login-error' : undefined}
            />
            <p className="auth-paste-hint">{t('auth.pasteTip')}</p>
            {error && <p id="auth-login-error" className="auth-error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !code.trim()}>
              {busy ? t('auth.signingIn') : t('auth.signIn')}
            </button>
          </form>
          <button className="auth-back" onClick={() => { setMode('welcome'); setError('') }}>← {t('common.back')}</button>
        </div>
      </div>
    )
  }

  if (mode === 'request') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Hokan</h1>
          <p className="auth-copy">
            {t('auth.requestToStart')}
          </p>
          <form onSubmit={handleRequest} className="auth-form">
            <input
              className="auth-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('auth.yourName')}
              autoCapitalize="words"
              autoCorrect="off"
            />
            <input
              className="auth-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoCapitalize="off"
              autoCorrect="off"
            />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !name.trim() || !email.trim()}>
              {busy ? t('auth.requesting') : t('auth.requestAccess')}
            </button>
          </form>
          <button className="auth-back" onClick={() => { setMode('welcome'); setError('') }}>← {t('common.back')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-disc" aria-hidden="true" />
        <h1 className="auth-wordmark">Hokan</h1>
        <p className="auth-tagline">{t('auth.tagline')}</p>
        <div className="auth-actions">
          <button className="btn btn-primary btn-block" onClick={() => setMode('login')}>
            {t('auth.haveCode')}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setMode('request')}>
            {t('auth.requestAccess')}
          </button>
        </div>
      </div>
    </div>
  )
}
