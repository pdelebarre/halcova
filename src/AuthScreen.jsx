import { useState } from 'react'
import { t } from './i18n'
import { requestMagicLink, DEMO_CODE } from './api/auth'
import TreasureNookMark from './components/TreasureNookMark'
import './AuthScreen.css'

// First screen a visitor sees. Three paths:
//   - "I have an access code" — members/owner sign in (code validated server-side)
//   - "Sign up with email" — self-serve: email → one-time magic link → session
//     (ADR-0003 S1, no admin approval)
//   - "Request access" — creates a pending request the admin approves
// Plus a public "Try the free demo" that signs into the read-only demo space
// (ADR-0001) with the intentionally-public DEMO_CODE.
export default function AuthScreen({ onLogin, onRequestAccess }) {
  const [mode, setMode] = useState('welcome') // welcome | login | magic | magicSent | request | sent
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

  async function handleDemo() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onLogin(DEMO_CODE)
      // Success unmounts this screen; App renders the read-only demo space.
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

  // Self-serve signup (ADR-0003 S1): request a one-time email magic link. The
  // emailed link points back at the SPA with ?magic-link=<token>, which App
  // verifies on mount and turns into a session.
  async function handleMagic(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await requestMagicLink({ email })
      setMode('magicSent')
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
          <h1 className="auth-wordmark">Halcova</h1>
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
          <h1 className="auth-wordmark">Halcova</h1>
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
          <h1 className="auth-wordmark">Halcova</h1>
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

  if (mode === 'magicSent') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Halcova</h1>
          <p className="auth-done">{t('auth.magicSent')}</p>
          <p className="auth-copy">
            {t('auth.magicSentBody')}
          </p>
          <button className="btn btn-ghost btn-block" onClick={() => { setMode('welcome'); setError('') }}>
            {t('common.back')}
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'magic') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Halcova</h1>
          <p className="auth-copy">{t('auth.enterEmail')}</p>
          <form onSubmit={handleMagic} className="auth-form" noValidate>
            <input
              className={`auth-input${error ? ' invalid' : ''}`}
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (error) setError('') }}
              placeholder={t('auth.emailPlaceholder')}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="email"
              inputMode="email"
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? 'auth-magic-error' : undefined}
            />
            {error && <p id="auth-magic-error" className="auth-error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !email.trim()}>
              {busy ? t('auth.sendingLink') : t('auth.sendLink')}
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
        <TreasureNookMark className="auth-mark" size={104} />
        <h1 className="auth-wordmark">Halcova</h1>
        <p className="auth-tagline">{t('auth.tagline')}</p>
        <div className="auth-actions">
          <button className="btn btn-primary btn-block" onClick={() => setMode('login')}>
            {t('auth.haveCode')}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setMode('magic')}>
            {t('auth.signUpEmail')}
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setMode('request')}>
            {t('auth.requestAccess')}
          </button>
          <button className="btn btn-demo btn-block" onClick={handleDemo} disabled={busy}>
            {t('demo.tryButton')}
          </button>
        </div>
      </div>
    </div>
  )
}
