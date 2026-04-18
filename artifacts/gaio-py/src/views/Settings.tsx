import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import type { Theme } from '../types'

const themes: { id: Theme; label: string; icon: string; desc: string }[] = [
  { id: 'light',  label: 'Hell',              icon: '☀️', desc: 'Heller Hintergrund' },
  { id: 'dark',   label: 'Dunkel',            icon: '🌙', desc: 'Dunkler Hintergrund' },
  { id: 'system', label: 'Systemeinstellung', icon: '💻', desc: 'Folgt dem Betriebssystem' },
]

export function Settings() {
  const { theme, setTheme, result, resetAnalysis, setResult, apiKeyConfigured } = useAppStore()
  const [cleared, setCleared] = useState(false)

  const handleClearResult = () => {
    resetAnalysis()
    setCleared(true)
    setTimeout(() => setCleared(false), 2000)
  }

  return (
    <div>
      <p className="page-title">Einstellungen</p>
      <p className="page-subtitle">Darstellung und Datenverwaltung.</p>

      {/* Theme */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Farbmodus</div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 14 }}>
          Wählen Sie zwischen hellem und dunklem Design — oder folgen Sie automatisch der Systemeinstellung.
        </p>
        <div className="theme-options">
          {themes.map(t => (
            <button
              key={t.id}
              className={`theme-opt ${theme === t.id ? 'selected' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <span>{t.icon}</span>
              <div style={{ textAlign: 'left' }}>
                <div>{t.label}</div>
                <div style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--text-muted)' }}>{t.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* API Key status */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">API-Konfiguration</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          background: 'var(--bg-sidebar)', borderRadius: 'var(--radius-md)' }}>
          <span style={{ fontSize: '1.4rem' }}>
            {apiKeyConfigured === true ? '✅' : apiKeyConfigured === false ? '❌' : '❓'}
          </span>
          <div>
            <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>
              {apiKeyConfigured === true
                ? 'Anthropic API Key konfiguriert'
                : apiKeyConfigured === false
                ? 'Kein API Key gefunden'
                : 'Status unbekannt (Backend nicht erreichbar?)'}
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {apiKeyConfigured === false
                ? 'Bitte ANTHROPIC_API_KEY in backend/.env eintragen und Server neu starten.'
                : 'Der Key wird serverseitig aus der .env-Datei gelesen und nie an den Browser übertragen.'}
            </p>
          </div>
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 10 }}>
          Datei: <code style={{ background: 'var(--bg-active)', padding: '1px 6px', borderRadius: 4, fontSize: '0.78rem' }}>backend/.env</code>
          {' '}→{' '}
          <code style={{ background: 'var(--bg-active)', padding: '1px 6px', borderRadius: 4, fontSize: '0.78rem' }}>ANTHROPIC_API_KEY=sk-ant-...</code>
        </p>
      </div>

      {/* Data management */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Daten &amp; Cache</div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', background: 'var(--bg-sidebar)', borderRadius: 'var(--radius-md)', marginBottom: 10 }}>
          <div>
            <p style={{ fontWeight: 700, fontSize: '0.9rem' }}>Letzte Analyse</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {result
                ? `${result.questionnaire.company_name || result.questionnaire.url || 'HTML-Upload'} · Score ${result.gaio_score}/100`
                : 'Keine Analyse vorhanden'}
            </p>
          </div>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.82rem', padding: '7px 14px' }}
            onClick={handleClearResult}
            disabled={!result}
          >
            {cleared ? '✓ Geleert' : '🗑 Löschen'}
          </button>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Ergebnisse werden in Ihrem Browser-Speicher (localStorage) gehalten.
          Ein Löschen entfernt nur die gespeicherten Analysedaten — Eingabefelder bleiben erhalten.
        </p>
      </div>

      {/* About */}
      <div className="card">
        <div className="section-title">Über GAIO Analyzer</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Version', '1.0.0'],
            ['LLM-Backend', 'Anthropic Claude Sonnet 4'],
            ['Framework', 'FastAPI + React 18'],
            ['Lizenz', 'Intern / Agenturnutzung'],
          ].map(([label, val]) => (
            <div key={label} style={{ background: 'var(--bg-sidebar)', borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{val}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
