import { useState } from 'react'
import Header from './components/Header'
import SettingsModal from './components/SettingsModal'
import CollectionView from './CollectionView'
import { recordsCatalog, booksCatalog } from './catalog'
import './App.css'

export default function App() {
  const [tab, setTab] = useState('records') // 'records' | 'books'
  const [settingsOpen, setSettingsOpen] = useState(false)

  const catalog = tab === 'books' ? booksCatalog : recordsCatalog

  return (
    <>
      <Header activeTab={tab} onTabChange={setTab} onOpenSettings={() => setSettingsOpen(true)} />

      {/* keyed by kind so each collection remounts fresh when you switch tabs */}
      <CollectionView key={catalog.kind} catalog={catalog} onRequestSettings={() => setSettingsOpen(true)} />

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  )
}
