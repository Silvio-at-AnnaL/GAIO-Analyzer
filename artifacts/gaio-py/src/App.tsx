import { useEffect } from 'react'
import { api } from './lib/api'
import { useAppStore } from './store/appStore'
import { Sidebar } from './components/Sidebar'
import { DomainAnalysis } from './views/DomainAnalysis'
import { HtmlAnalysis } from './views/HtmlAnalysis'
import { Results } from './views/Results'
import { FAQView } from './views/FAQView'
import { Settings } from './views/Settings'

function useTheme() {
  const theme = useAppStore(s => s.theme)
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const apply = () => root.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
      apply()
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    } else {
      root.setAttribute('data-theme', theme)
    }
  }, [theme])
}

function ApiKeyBanner() {
  const apiKeyConfigured = useAppStore(s => s.apiKeyConfigured)
  if (apiKeyConfigured !== false) return null
  return (
    <div style={{
      background: '#FDF0EE',
      borderBottom: '2px solid var(--score-red)',
      padding: '10px 24px',
      fontSize: '0.85rem',
      color: 'var(--score-red)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      position: 'fixed',
      top: 0, left: 'var(--sidebar-w)', right: 0,
      zIndex: 200,
    }}>
      <span style={{ fontSize: '1.1rem' }}>⚠️</span>
      <strong>Kein Anthropic API Key konfiguriert.</strong>
      <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>
        KI-Module sind deaktiviert. Bitte API-Integration konfigurieren und Server neu starten.
      </span>
    </div>
  )
}

export default function App() {
  useTheme()
  const activeView = useAppStore(s => s.activeView)
  const analysisStatus = useAppStore(s => s.analysisStatus)
  const apiKeyConfigured = useAppStore(s => s.apiKeyConfigured)
  const setApiKeyConfigured = useAppStore(s => s.setApiKeyConfigured)
  const resetAnalysis = useAppStore(s => s.resetAnalysis)

  useEffect(() => {
    api.get('health').then(r => {
      setApiKeyConfigured(r.data.api_key_configured)
    }).catch(() => {
      // Backend not reachable
    })
  }, [])

  useEffect(() => {
    if (analysisStatus === 'running') resetAnalysis()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const bannerOffset = apiKeyConfigured === false ? '44px' : '0px'

  return (
    <div className="app-layout">
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ApiKeyBanner />
        <main className="main-content" style={{ marginTop: bannerOffset }}>
          {activeView === 'domain'   && <DomainAnalysis />}
          {activeView === 'html'     && <HtmlAnalysis />}
          {activeView === 'results'  && <Results />}
          {activeView === 'faq'      && <FAQView />}
          {activeView === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  )
}
