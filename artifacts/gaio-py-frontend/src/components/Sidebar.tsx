import { useAppStore } from '../store/appStore'
import type { View } from '../types'

const navItems: { id: View; label: string; icon: string; number: string }[] = [
  { id: 'domain',   label: 'Domainanalyse – Basisdaten', icon: '🌐', number: '1' },
  { id: 'html',     label: 'HTML-Analyse',               icon: '📄', number: '2' },
  { id: 'results',  label: 'Ergebnisse',                 icon: '📊', number: '3' },
  { id: 'faq',      label: 'FAQ / So funktioniert\'s',   icon: '❓', number: '4' },
  { id: 'settings', label: 'Einstellungen',              icon: '⚙️', number: '5' },
]

export function Sidebar() {
  const { activeView, setActiveView, analysisStatus, result } = useAppStore()

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>GAIO Analyzer</h1>
        <p>LLM-Sichtbarkeit · SEO Audit</p>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => setActiveView(item.id)}
          >
            <span style={{ fontSize: '1rem', lineHeight: 1 }}>{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.id === 'results' && analysisStatus === 'done' && result && (
              <span className="nav-badge">{result.gaio_score}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        v1.0 · Powered by Anthropic Claude
      </div>
    </aside>
  )
}
