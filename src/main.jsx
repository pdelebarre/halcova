import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/shared.css'
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
