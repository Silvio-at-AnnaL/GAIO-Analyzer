import { useState } from 'react'
import { api, sseUrl } from '../lib/api'
import { useAppStore } from '../store/appStore'

interface SitemapStatus {
  '/robots.txt': boolean
  '/sitemap.xml': boolean
  '/sitemap_index.xml': boolean
}

function Tip({ text }: { text: string }) {
  return (
    <span className="tooltip-wrap">
      <span className="tooltip-icon">i</span>
      <span className="tooltip-box">{text}</span>
    </span>
  )
}

export function DomainAnalysis() {
  const {
    questionnaire, setQuestionnaire,
    crawledUrls, selectedUrls, setCrawledUrls, setSelectedUrls,
    startAnalysis, addProgress, setResult, setError,
    setActiveView, resetAnalysis,
  } = useAppStore()

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showAllUrls, setShowAllUrls] = useState(false)
  const [urlsExpanded, setUrlsExpanded] = useState(false)
  const [sitemapStatus, setSitemapStatus] = useState<SitemapStatus | null>(null)
  const [checkingUrl, setCheckingUrl] = useState(false)

  const handleUrlBlur = async () => {
    const url = questionnaire.url.trim()
    if (!url) return
    try { new URL(url) } catch { return }
    setCheckingUrl(true)
    try {
      const res = await api.get('check-sitemap', { params: { url } })
      setSitemapStatus(res.data)
    } catch { /* silently ignore */ }
    finally { setCheckingUrl(false) }
  }

  const updateCompetitor = (i: number, val: string) => {
    const arr = [...questionnaire.competitor_urls]
    arr[i] = val
    if (i === arr.length - 1 && val && arr.length < 10) arr.push('')
    setQuestionnaire({ competitor_urls: arr })
  }

  const normaliseCompetitorUrl = (i: number) => {
    const arr = [...questionnaire.competitor_urls]
    const v = arr[i].trim()
    if (v && !v.startsWith('http')) {
      arr[i] = 'https://' + v
      setQuestionnaire({ competitor_urls: arr })
    }
  }

  const removeCompetitor = (i: number) => {
    const arr = questionnaire.competitor_urls.filter((_, idx) => idx !== i)
    setQuestionnaire({ competitor_urls: arr.length ? arr : [''] })
  }

  const addCompetitorSlot = () => {
    if (questionnaire.competitor_urls.length < 10) {
      setQuestionnaire({ competitor_urls: [...questionnaire.competitor_urls, ''] })
    }
  }

  const updateSocial = (key: string, val: string) => {
    setQuestionnaire({ social_media: { ...questionnaire.social_media, [key]: val } })
  }

  const toggleUrlSelection = (url: string) => {
    const current = selectedUrls ?? crawledUrls
    if (current.includes(url)) {
      setSelectedUrls(current.filter(u => u !== url))
    } else {
      setSelectedUrls([...current, url])
    }
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!questionnaire.company_name.trim()) e.company_name = 'Bitte Unternehmensname eingeben'
    if (!questionnaire.url.trim()) e.url = 'Bitte URL eingeben'
    else {
      try { new URL(questionnaire.url) } catch { e.url = 'Ungültige URL (https://... erwartet)' }
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleStart = async () => {
    if (!validate()) return
    resetAnalysis()
    setActiveView('results')

    try {
      const res = await api.post('analyze/domain', {
        questionnaire: {
          ...questionnaire,
          competitor_urls: questionnaire.competitor_urls.filter(u => u.trim()),
        },
        explicit_urls: selectedUrls && selectedUrls.length > 0 ? selectedUrls : null,
      })
      const { task_id } = res.data
      startAnalysis(task_id)

      const evtSource = new EventSource(sseUrl(`analysis/${task_id}/stream`))
      evtSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data)
        addProgress(data)
        if (data.crawled_urls) {
          setCrawledUrls(data.crawled_urls)
          setSelectedUrls(null)
        }
      })
      evtSource.addEventListener('complete', async () => {
        evtSource.close()
        const r = await api.get(`analysis/${task_id}/results`)
        setResult(r.data)
      })
      evtSource.addEventListener('error', (e: any) => {
        evtSource.close()
        try {
          const d = JSON.parse(e.data || '{}')
          setError(d.message || 'Analysefehler')
        } catch { setError('Verbindungsfehler') }
      })
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Serverfehler')
    }
  }

  const socialPlatforms = [
    'LinkedIn', 'Facebook', 'Instagram', 'YouTube',
    'TikTok', 'WeChat', 'Twitter / X', 'Kununu', 'Xing',
  ]

  const displayedUrls = showAllUrls ? crawledUrls : crawledUrls.slice(0, 15)
  const currentSelected = selectedUrls ?? crawledUrls
  const allSelected = currentSelected.length === crawledUrls.length

  return (
    <div>
      <p className="page-title">Domainanalyse – Basisdaten</p>
      <p className="page-subtitle">
        Geben Sie die zu analysierenden Daten ein. Alle Felder außer Name und URL sind optional.
      </p>

      {/* ── Unternehmen & Website ─────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Unternehmen &amp; Website</div>

        <div className="form-group">
          <label className="form-label">
            Unternehmensname
            <Tip text="Bitte geben Sie die korrekte Unternehmensbezeichnung ein" />
          </label>
          <input
            className="form-input"
            value={questionnaire.company_name}
            onChange={e => setQuestionnaire({ company_name: e.target.value })}
            placeholder="z.B. Mustermann GmbH"
          />
          {errors.company_name && <p className="form-error">{errors.company_name}</p>}
        </div>

        <div className="form-group">
          <label className="form-label">
            Website-URL
            <Tip text="Bitte Ihre hier zu analysierende Website eintragen" />
          </label>
          <input
            className="form-input"
            value={questionnaire.url}
            onChange={e => { setQuestionnaire({ url: e.target.value }); setSitemapStatus(null) }}
            onBlur={handleUrlBlur}
            placeholder="https://www.ihre-website.de"
            type="url"
          />
          {errors.url && <p className="form-error">{errors.url}</p>}
          {checkingUrl && <p className="form-hint">🔍 Prüfe robots.txt und sitemap.xml…</p>}
          {sitemapStatus && !checkingUrl && (
            <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
              {([
                ['/robots.txt', 'robots.txt'],
                ['/sitemap.xml', 'sitemap.xml'],
                ['/sitemap_index.xml', 'sitemap_index.xml'],
              ] as [keyof SitemapStatus, string][]).map(([key, label]) => (
                <span key={key} style={{
                  fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px',
                  borderRadius: 6,
                  background: sitemapStatus[key] ? 'var(--score-green-bg)' : 'var(--score-red-bg)',
                  color: sitemapStatus[key] ? 'var(--score-green)' : 'var(--score-red)',
                }}>
                  {sitemapStatus[key] ? '✓' : '✗'} {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Gecrawlte Unterseiten (after first run) ──────── */}
      {crawledUrls.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            className="collapsible-header"
            onClick={() => setUrlsExpanded(!urlsExpanded)}
            style={{ paddingTop: 0 }}
          >
            <span className="collapse-arrow">{urlsExpanded ? '▼' : '▶'}</span>
            <h3>Zu analysierende Unterseiten</h3>
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {currentSelected.length} / {crawledUrls.length} ausgewählt
            </span>
          </div>
          {urlsExpanded && (
            <>
              <p className="form-hint" style={{ marginBottom: 10 }}>
                Beim letzten Crawl erkannt. Auswahl anpassen für neue Analyse.
              </p>
              <div className="url-list">
                <div className="select-all-row">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelectedUrls(allSelected ? [] : [...crawledUrls])}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                  Alle {allSelected ? 'abwählen' : 'auswählen'}
                </div>
                {displayedUrls.map(url => (
                  <div key={url} className="url-list-item">
                    <input
                      type="checkbox"
                      checked={currentSelected.includes(url)}
                      onChange={() => toggleUrlSelection(url)}
                    />
                    <a href={url} target="_blank" rel="noopener noreferrer">{url}</a>
                  </div>
                ))}
              </div>
              {crawledUrls.length > 15 && (
                <button className="urls-toggle-btn" onClick={() => setShowAllUrls(!showAllUrls)}>
                  {showAllUrls ? '▲ Weniger anzeigen' : `▼ Alle ${crawledUrls.length} anzeigen`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Wettbewerber ──────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">
          Wettbewerber-Domains
          <Tip text="Die Website-Adresse/n Ihrer wichtigsten Wettbewerber" />
        </div>
        <div className="competitor-list">
          {questionnaire.competitor_urls.map((url, i) => (
            <div key={i} className="competitor-row">
              <input
                className="form-input"
                value={url}
                onChange={e => updateCompetitor(i, e.target.value)}
                onBlur={() => normaliseCompetitorUrl(i)}
                placeholder="https://www.wettbewerber.de"
                type="url"
              />
              {questionnaire.competitor_urls.length > 1 && (
                <button className="btn-icon" onClick={() => removeCompetitor(i)} title="Entfernen">×</button>
              )}
            </div>
          ))}
        </div>
        {questionnaire.competitor_urls.length < 10 && (
          <button
            className="btn-icon add"
            onClick={addCompetitorSlot}
            style={{ marginTop: 8, width: 'auto', padding: '6px 14px', gap: 6 }}
            title="Weiteren Wettbewerber hinzufügen"
          >
            + Weiteren Wettbewerber hinzufügen
          </button>
        )}
      </div>

      {/* ── Social Media ──────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Social Media &amp; Online-Profile</div>
        <div className="social-grid">
          {socialPlatforms.map(p => (
            <div key={p} className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label" style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{p}</label>
              <input
                className="form-input"
                value={questionnaire.social_media[p] ?? ''}
                onChange={e => updateSocial(p, e.target.value)}
                placeholder="URL oder @Handle"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Differenzierung & Brand-Keywords ─────────────── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Differenzierung &amp; Marken-Keywords</div>

        <div className="form-group">
          <label className="form-label">
            Differenzierungsmerkmale
            <Tip text="Worin unterscheiden Sie sich klar von Ihren Wettbewerbern? Diese Angabe verbessert den Wettbewerbsvergleich erheblich." />
          </label>
          <textarea
            className="form-textarea"
            value={questionnaire.differentiators}
            onChange={e => setQuestionnaire({ differentiators: e.target.value })}
            placeholder="z.B. Einzige ISO-zertifizierte Anlage in DACH, 48h-Liefergarantie, patentiertes Schnellspannsystem..."
            rows={3}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">
            Brand-Keywords &amp; Slogans
            <Tip text="Markennamen, Produktnamen, Slogans und Fachbegriffe, die eindeutig zu Ihrem Unternehmen gehören. Kommagetrennt." />
          </label>
          <input
            className="form-input"
            value={questionnaire.brand_terms.join(', ')}
            onChange={e => setQuestionnaire({
              brand_terms: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
            })}
            placeholder="z.B. HydroFlex, XR-Série, MachineGuard, schnell sicher präzise"
          />
          <p className="form-hint">Kommagetrennt eingeben</p>
        </div>
      </div>

      {/* ── Zielgruppen ───────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-title">
          Zielgruppen / Käuferpersonas
          <Tip text="Hier Ihre Zielbranchen und Zielpersonen (Einkäufer, Projektingenieure, R+D…) eintragen" />
        </div>
        <textarea
          className="form-textarea"
          value={questionnaire.personas}
          onChange={e => setQuestionnaire({ personas: e.target.value })}
          placeholder="z.B. Einkaufsleiter in der Automobilindustrie, Projektingenieure im Maschinenbau, F&E-Verantwortliche in der Pharma..."
          rows={4}
        />
      </div>

      <button className="btn btn-primary" onClick={handleStart}>
        🚀 Analyse starten
      </button>
    </div>
  )
}
