import { useState } from 'react'
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
          <h1 className="auth-wordmark">Runout</h1>
          <p className="auth-done">Request sent ✉️</p>
          <p className="auth-copy">
            The admin will review it and send you an access code. Once you have it,
            come back and sign in.
          </p>
          <button className="btn btn-ghost btn-block" onClick={() => { setMode('welcome'); setError('') }}>
            Back
          </button>
        </div>
      </div>
    )
  }

  if (mode === 'login') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Runout</h1>
          <p className="auth-copy">Enter the access code the admin gave you.</p>
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
            <p className="auth-paste-hint">Tip: paste your access code — it's case-sensitive</p>
            {error && <p id="auth-login-error" className="auth-error" role="alert">{error}</p>}
            <button className="btn btn-primary btn-block" type="submit" disabled={busy || !code.trim()}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <button className="auth-back" onClick={() => { setMode('welcome'); setError('') }}>← Back</button>
        </div>
      </div>
    )
  }

  if (mode === 'request') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-wordmark">Runout</h1>
          <p className="auth-copy">
            Request access to start cataloging. The admin will approve your account
            and send you an access code.
          </p>
          <form onSubmit={handleRequest} className="auth-form">
            <input
              className="auth-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
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
              {busy ? 'Requesting…' : 'Request access'}
            </button>
          </form>
          <button className="auth-back" onClick={() => { setMode('welcome'); setError('') }}>← Back</button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-disc" aria-hidden="true" />
        <h1 className="auth-wordmark">Runout</h1>
        <p className="auth-tagline">your crate &amp; shelf, cataloged</p>
        <div className="auth-actions">
          <button className="btn btn-primary btn-block" onClick={() => setMode('login')}>
            I have an access code
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setMode('request')}>
            Request access
          </button>
        </div>
      </div>
    </div>
  )
}
