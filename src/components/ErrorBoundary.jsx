import { Component } from 'react'
import { t } from '../i18n'
import './ErrorBoundary.css'

// ---------------------------------------------------------------------------
// Last-resort error boundary (T7, ADR-0002 Phase 0).
//
// There is no error boundary elsewhere in the app, so any uncaught render
// error unmounts React to a dark screen (`body` background is #16130F) with no
// way back. This boundary catches those errors and swaps the broken subtree
// for a friendly, on-theme card with a Reload button instead of a blank page.
//
// It is deliberately a safety net, NOT a replacement for `?.`-guards and
// defensive rendering — the data paths still guard themselves. Error
// boundaries only catch errors during rendering, in lifecycle methods, and in
// constructors of the tree below; they don't catch event-handler or async
// errors (those never take down the tree in the first place).
// ---------------------------------------------------------------------------

export default class ErrorBoundary extends Component {
  state = { hasError: false }

  static getDerivedStateFromError() {
    // The subtree below failed to render — render the fallback instead.
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Surface the failure without blanking the app. Never log access codes or
    // the admin key — this only ever receives render/lifecycle errors.
    console.error('[ErrorBoundary] Unhandled render error:', error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      // Default to a full page reload (resets all app state). An optional
      // `onReload` prop is a testability seam — the default can't be spied on
      // because jsdom's Location#reload is non-configurable.
      const reload = this.props.onReload || (() => window.location.reload())
      return (
        <main className="error-boundary" role="alert">
          <div className="error-boundary-card">
            <h1 className="error-boundary-title">{t('error.title')}</h1>
            <p className="error-boundary-message">{t('error.message')}</p>
            <button
              type="button"
              className="error-boundary-reload"
              onClick={reload}
            >
              {t('error.reload')}
            </button>
            <p className="error-boundary-note">{t('error.reported')}</p>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
