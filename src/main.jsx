import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/shared.css'
// Self-hosted webfonts (replaces the Google Fonts <link> in index.html): the
// shell is now offline-complete and renders identically on Safari/Chrome/Vivaldi.
// Latin + Latin-Ext cover every supported locale (en, en-GB, fr, nl, pt-BR, de, es, it).
import '@fontsource-variable/fraunces/opsz.css' // variable display face w/ optical-size axis
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/inter/latin-ext-400.css'
import '@fontsource/inter/latin-ext-500.css'
import '@fontsource/inter/latin-ext-600.css'
import '@fontsource/inter/latin-ext-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-ext-400.css'
import '@fontsource/ibm-plex-mono/latin-ext-500.css'
import '@fontsource/ibm-plex-mono/latin-ext-600.css'
import App from './App.jsx'
import UpdateNotice from './components/UpdateNotice.jsx'
import { LocaleProvider } from './i18n'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LocaleProvider>
      <App />
      {/* Uses t(), so it must live inside LocaleProvider. */}
      <UpdateNotice />
    </LocaleProvider>
  </StrictMode>,
)
