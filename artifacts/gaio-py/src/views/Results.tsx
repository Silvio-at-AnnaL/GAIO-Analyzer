import { useState } from 'react'
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  Cell, PieChart, Pie, Label
} from 'recharts'
import { useAppStore } from '../store/appStore'
import type { AnalysisResult, CompetitorResult } from '../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 71) return 'var(--score-green)'
  if (s >= 41) return 'var(--score-orange)'
  return 'var(--score-red)'
}

function scoreColorHex(s: number) {
  if (s >= 71) return '#3A8A4E'
  if (s >= 41) return '#D97706'
  return '#C0392B'
}

function scoreBgHex(s: number) {
  if (s >= 71) return '#EBF5EE'
  if (s >= 41) return '#FEF3E2'
  return '#FDF0EE'
}

function scoreClass(s: number) {
  if (s >= 71) return 'good'
  if (s >= 41) return 'medium'
  return 'critical'
}

function safeHostname(url: string): string {
  try {
    const u = url.startsWith('http') ? url : 'https://' + url
    return new URL(u).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url
  }
}

function Stars({ rating }: { rating: number }) {
  return (
    <span>
      {[1,2,3,4,5].map(i => (
        <span key={i} className={i <= Math.round(rating) ? 'star' : 'star empty'}>★</span>
      ))}
    </span>
  )
}

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="collapsible-header" onClick={() => setOpen(!open)} style={{ paddingTop: 0 }}>
        <span className="collapse-arrow" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
        <h2 style={{ fontSize: '1rem' }}>{title}</h2>
      </div>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  )
}

// ── Module sections ───────────────────────────────────────────────────────────

function TechnicalSection({ data }: { data: any }) {
  const sub = [
    { label: 'HTTPS',        val: data.is_https ? 100 : 0 },
    { label: 'Antwortzeit',  val: data.avg_response_ms < 500 ? 100 : data.avg_response_ms < 1500 ? 60 : 20 },
    { label: 'Meta-Titel',   val: Math.round((1 - data.missing_meta_title / Math.max(data.total_pages_crawled, 1)) * 100) },
    { label: 'Meta-Desc.',   val: Math.round((1 - data.missing_meta_desc / Math.max(data.total_pages_crawled, 1)) * 100) },
    { label: 'Alt-Texte',    val: data.alt_coverage_pct },
    { label: 'H1-Tags',      val: Math.round((1 - data.h1_missing_pages / Math.max(data.total_pages_crawled, 1)) * 100) },
  ]

  const [showPages, setShowPages] = useState(false)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
        <Metric label="HTTPS" value={data.is_https ? '✅ Aktiv' : '❌ Fehlt'} />
        <Metric label="Ø Antwortzeit" value={`${data.avg_response_ms} ms (${data.avg_response_ms < 500 ? 'gut' : data.avg_response_ms < 1500 ? 'mittel' : 'schlecht'})`} />
        <Metric label="Gecrawlte Seiten" value={data.total_pages_crawled} />
        <Metric label="Alt-Text-Abdeckung" value={`${data.alt_coverage_pct}%`} />
        <Metric label="Fehlende Meta-Titel" value={`${data.missing_meta_title} Seite(n)`} />
        <Metric label="Fehlende Meta-Desc." value={`${data.missing_meta_desc} Seite(n)`} />
        <Metric label="Seiten ohne H1" value={data.h1_missing_pages} />
        <Metric label="hreflang-Sprachen" value={data.hreflang_langs?.length ? data.hreflang_langs.join(', ') : '–'} />
        <Metric label="Canonical-Tags" value={data.canonical_count > 0 ? `✅ ${data.canonical_count} Seite(n)` : '⚠ Keine gefunden'} />
        <Metric label="Mobile-Viewport fehlt" value={data.viewport_missing_pages > 0 ? `⚠ ${data.viewport_missing_pages} Seite(n)` : '✅ Vorhanden'} />
      </div>

      {data.title_too_short > 0 || data.title_too_long > 0 || data.desc_too_short > 0 || data.desc_too_long > 0 ? (
        <div style={{ background: 'var(--score-orange-bg)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '0.85rem' }}>
          <strong>Meta-Tag-Längen:</strong>
          {data.title_too_short > 0 && <span style={{ marginLeft: 10 }}>🔸 {data.title_too_short}× Titel zu kurz (&lt;30 Zeichen)</span>}
          {data.title_too_long > 0 && <span style={{ marginLeft: 10 }}>🔸 {data.title_too_long}× Titel zu lang (&gt;60 Zeichen)</span>}
          {data.desc_too_short > 0 && <span style={{ marginLeft: 10 }}>🔸 {data.desc_too_short}× Beschreibung zu kurz (&lt;70 Zeichen)</span>}
          {data.desc_too_long > 0 && <span style={{ marginLeft: 10 }}>🔸 {data.desc_too_long}× Beschreibung zu lang (&gt;160 Zeichen)</span>}
        </div>
      ) : null}

      <div className="chart-card" style={{ height: 220 }}>
        <p className="chart-title">Sub-Metriken (0–100)</p>
        <ResponsiveContainer width="100%" height={175}>
          <BarChart data={sub} layout="vertical" margin={{ left: 80, right: 20 }}>
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fontFamily: 'Nunito' }} />
            <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fontFamily: 'Nunito' }} width={80} />
            <Tooltip formatter={(v: any) => [`${v}/100`, 'Score']} />
            <Bar dataKey="val" radius={[0, 4, 4, 0]}>
              {sub.map((entry, i) => <Cell key={i} fill={scoreColor(entry.val)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {data.pages_detail?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button className="urls-toggle-btn" onClick={() => setShowPages(!showPages)}>
            {showPages ? '▲ Seiten-Details ausblenden' : `▼ Seiten-Details anzeigen (${data.pages_detail.length} Seiten)`}
          </button>
          {showPages && (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table className="comp-table" style={{ fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th>URL</th><th>Status</th><th>ms</th><th>Titel-Länge</th><th>Desc.-Länge</th><th>H1</th><th>Canonical</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pages_detail.map((p: any, i: number) => (
                    <tr key={i}>
                      <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a>
                      </td>
                      <td><span style={{ color: p.status === 200 ? 'var(--score-green)' : 'var(--score-red)', fontWeight: 700 }}>{p.status}</span></td>
                      <td>{p.response_ms}</td>
                      <td style={{ color: p.title_len < 30 || p.title_len > 60 ? 'var(--score-orange)' : 'inherit' }}>{p.title_len}</td>
                      <td style={{ color: p.desc_len === 0 ? 'var(--score-red)' : p.desc_len < 70 || p.desc_len > 160 ? 'var(--score-orange)' : 'inherit' }}>{p.desc_len || '–'}</td>
                      <td style={{ color: p.h1_count !== 1 ? 'var(--score-red)' : 'var(--score-green)', fontWeight: 700 }}>{p.h1_count}</td>
                      <td>{p.has_canonical ? '✅' : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div style={{ background: 'var(--bg-sidebar)', borderRadius: 8, padding: '10px 14px' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{String(value)}</div>
    </div>
  )
}

function SchemaSection({ data }: { data: any }) {
  const types = Object.entries(data.types_found as Record<string, number>)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <Metric label="Organization" value={data.has_org_schema ? '✅' : '❌'} />
        <Metric label="Product" value={data.has_product_schema ? '✅' : '❌'} />
        <Metric label="FAQPage" value={data.has_faq_schema ? '✅' : '❌'} />
      </div>
      {types.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p className="section-title">Gefundene Schema-Typen</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {types.map(([t, c]) => (
              <span key={t} style={{ background: 'var(--accent-light)', color: 'var(--accent)', borderRadius: 6, padding: '2px 10px', fontSize: '0.8rem', fontWeight: 700 }}>
                {t} ×{c}
              </span>
            ))}
          </div>
        </div>
      )}
      {data.missing_important_types?.length > 0 && (
        <div>
          <p className="section-title">Fehlende B2B-relevante Typen</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {data.missing_important_types.map((t: string) => (
              <span key={t} style={{ background: 'var(--score-red-bg)', color: 'var(--score-red)', borderRadius: 6, padding: '2px 10px', fontSize: '0.8rem', fontWeight: 700 }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function HeadingSection({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <Metric label="Seiten ohne H1" value={data.h1_missing_pages} />
        <Metric label="Seiten mit >1 H1" value={data.h1_multiple_pages} />
        <Metric label="Hierarchiefehler" value={data.hierarchy_errors} />
      </div>
      {data.pages?.slice(0, 3).map((p: any, i: number) => (
        <div key={i} style={{ marginBottom: 10, background: 'var(--bg-sidebar)', borderRadius: 8, padding: '10px 14px' }}>
          <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{p.url}</a>
          {p.h1?.[0] && <p style={{ fontWeight: 700, marginTop: 4, fontSize: '0.88rem' }}>H1: {p.h1[0]}</p>}
          {p.errors?.length > 0 && p.errors.map((e: string, j: number) => (
            <p key={j} style={{ color: 'var(--score-red)', fontSize: '0.78rem', marginTop: 3 }}>⚠ {e}</p>
          ))}
        </div>
      ))}
    </div>
  )
}

function ContentSection({ data }: { data: any }) {
  if (data.error) return <p style={{ color: 'var(--text-muted)' }}>{data.error}</p>
  const dims = [
    { key: 'use_cases', label: 'Anwendungsszenarien' },
    { key: 'buyer_questions', label: 'Käufer-Fragetypen' },
    { key: 'technical_depth', label: 'Technische Tiefe' },
    { key: 'content_gaps', label: 'Inhaltslücken (inv.)' },
  ]
  return (
    <div>
      {data.overall_summary && (
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.7 }}>{data.overall_summary}</p>
      )}
      {dims.map(d => data[d.key] && (
        <div key={d.key} style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{d.label}</span>
            <span className={`score-badge ${scoreClass(data[d.key].score * 10)}`}>{data[d.key].score}/10</span>
          </div>
          <ul style={{ paddingLeft: 18, display: 'grid', gap: 4 }}>
            {data[d.key].findings?.map((f: string, i: number) => (
              <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{f}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function FaqSection({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
        <Metric label="FAQ-Einträge" value={data.faq_count} />
        <Metric label="Seiten mit FAQ" value={data.pages_with_faq} />
        <Metric label="FAQPage Schema" value={data.has_faq_schema ? '✅' : '❌'} />
      </div>
      {data.quality_findings?.length > 0 && (
        <ul style={{ paddingLeft: 18, marginBottom: 14 }}>
          {data.quality_findings.map((f: string, i: number) => (
            <li key={i} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>{f}</li>
          ))}
        </ul>
      )}
      {data.sample_faqs?.length > 0 && (
        <div>
          <p className="section-title">Gefundene FAQ-Einträge (Auszug)</p>
          {data.sample_faqs.map((faq: any, i: number) => (
            <div key={i} style={{ background: 'var(--bg-sidebar)', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
              <p style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: 4 }}>❓ {faq.question}</p>
              <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>{faq.answer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LlmSection({ data }: { data: any }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontWeight: 700 }}>Ø Antwortqualität:</span>
        <Stars rating={data.avg_rating} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{data.avg_rating}/5</span>
      </div>
      {data.questions_rated?.map((q: any, i: number) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '10px 14px', background: 'var(--bg-sidebar)', borderRadius: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <p style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 4 }}>{q.question}</p>
            {q.gap && q.gap !== 'Analyse nicht verfügbar' && (
              <p style={{ fontSize: '0.80rem', color: 'var(--text-muted)' }}>⚠ {q.gap}</p>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>
            <Stars rating={q.rating} />
          </div>
        </div>
      ))}
    </div>
  )
}

function CompetitorSection({ competitors, mainScores, mainUrl }: {
  competitors: CompetitorResult[]
  mainScores: any
  mainUrl: string
}) {
  if (!competitors.length) return <p style={{ color: 'var(--text-muted)' }}>Keine Wettbewerber-Daten verfügbar.</p>

  // Summary bar chart
  const mainHostname = safeHostname(mainUrl)
  const chartData = [
    { name: mainHostname, score: mainScores.total ?? 0, isMain: true },
    ...competitors.map(c => ({
      name: safeHostname(c.url),
      score: c.composite,
      isMain: false,
    }))
  ].sort((a, b) => b.score - a.score)

  const dims = ['technical_seo', 'schema', 'headings', 'content', 'faq'] as const
  const dimLabels: Record<string, string> = {
    technical_seo: 'Technische SEO',
    schema: 'Schema.org',
    headings: 'Headings',
    content: 'Content',
    faq: 'FAQ',
  }

  return (
    <div>
      <div className="chart-card" style={{ marginBottom: 16 }}>
        <p className="chart-title">Gesamt-Score Vergleich</p>
        <ResponsiveContainer width="100%" height={40 + chartData.length * 38}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 120 }}>
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fontFamily: 'Nunito' }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fontFamily: 'Nunito' }} width={120} />
            <Tooltip formatter={(v: any) => `${v}/100`} />
            <Bar dataKey="score" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.isMain ? 'var(--accent)' : scoreColor(entry.score)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {competitors.map((comp, i) => {
      const compHostname = safeHostname(comp.url)
        if (comp.error) return (
          <div key={i} className="comp-card">
            <div className="comp-card-header">
              <span className="comp-domain">{compHostname}</span>
              <span style={{ color: 'var(--score-red)', fontSize: '0.83rem', marginLeft: 'auto' }}>
                Nicht erreichbar: {comp.error}
              </span>
            </div>
          </div>
        )

        return (
          <div key={i} className="comp-card">
            <div className="comp-card-header">
              <span className="comp-domain">{compHostname}</span>
              <a href={comp.url} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>↗ Öffnen</a>
              <span className="comp-composite" style={{ color: scoreColor(comp.composite) }}>
                {comp.composite}
              </span>
            </div>

            <table className="comp-table">
              <thead>
                <tr>
                  <th>Metrik</th>
                  <th>Ihre Website</th>
                  <th>{compHostname}</th>
                  <th>Delta</th>
                  <th>Bewertung</th>
                </tr>
              </thead>
              <tbody>
                {dims.map(d => {
                  const main = mainScores[d] ?? 0
                  const cval = comp.scores?.[d] ?? 0
                  const delta = main - cval
                  return (
                    <tr key={d}>
                      <td style={{ fontWeight: 600 }}>{dimLabels[d]}</td>
                      <td><span className={`score-badge ${scoreClass(main)}`}>{main}</span></td>
                      <td><span className={`score-badge ${scoreClass(cval)}`}>{cval}</span></td>
                      <td>
                        <span className={`delta ${delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral'}`}>
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {delta > 5 ? 'Ihr Vorteil' : delta < -5 ? 'Aufholbedarf' : 'Gleichstand'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {comp.insights && (
              <div className="comp-insights">
                <div className="comp-insight-row">
                  <span className="comp-insight-label">Ihr Vorteil</span>
                  <span className="comp-insight-value">{comp.insights.main_advantages}</span>
                </div>
                <div className="comp-insight-row">
                  <span className="comp-insight-label">Wettbewerbervorteil</span>
                  <span className="comp-insight-value">{comp.insights.competitor_advantages}</span>
                </div>
                <div className="comp-insight-row">
                  <span className="comp-insight-label">Empfehlung</span>
                  <span className="comp-insight-value" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                    {comp.insights.recommendation}
                  </span>
                </div>
              </div>
            )}
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 10 }}>
              Score-Basis: {comp.pages_analyzed} gecrawlte Seite(n)
            </p>
          </div>
        )
      })}
    </div>
  )
}

function Recommendations({ recs }: { recs: any }) {
  const tiers = [
    { key: 'critical', label: '🔴 Kritisch', color: 'var(--score-red)' },
    { key: 'high_leverage', label: '🟠 Hoher Hebel', color: 'var(--score-orange)' },
    { key: 'secondary', label: '🟡 Nachgeordnet', color: '#B8860B' },
  ]
  return (
    <div>
      {tiers.map(tier => (
        recs[tier.key]?.length > 0 && (
          <div key={tier.key} className="rec-tier">
            <div className="rec-tier-header" style={{ color: tier.color }}>
              {tier.label}
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {recs[tier.key].length} Empfehlung{recs[tier.key].length > 1 ? 'en' : ''}
              </span>
            </div>
            {recs[tier.key].map((r: any, i: number) => (
              <div key={i} className="rec-item">
                <h3>{r.title}</h3>
                <div className="rec-meta">
                  <div className="rec-meta-row">
                    <span className="rec-meta-label">Problem</span>
                    <span className="rec-meta-value">{r.problem}</span>
                  </div>
                  <div className="rec-meta-row">
                    <span className="rec-meta-label">Relevanz</span>
                    <span className="rec-meta-value">{r.why_matters}</span>
                  </div>
                </div>
                {r.fix && <div className="rec-fix">💡 {r.fix}</div>}
              </div>
            ))}
          </div>
        )
      ))}
    </div>
  )
}

// ── Main Results view ─────────────────────────────────────────────────────────

const MODULE_STEPS = [
  { label: 'Crawler', step: 1 },
  { label: 'Technische SEO', step: 2 },
  { label: 'Strukturierte Daten (Schema.org)', step: 3 },
  { label: 'Heading-Struktur', step: 4 },
  { label: 'Inhaltliche Relevanz (KI)', step: 5 },
  { label: 'FAQ-Analyse', step: 6 },
  { label: 'LLM-Sichtbarkeits-Simulation', step: 7 },
  { label: 'Wettbewerbsvergleich', step: 8 },
  { label: 'Empfehlungen', step: 9 },
]

export function Results() {
  const { analysisStatus, progressEvents, result, analysisError } = useAppStore()

  if (analysisStatus === 'idle') {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <p>Noch keine Analyse durchgeführt.</p>
        <p style={{ marginTop: 8, fontSize: '0.85rem' }}>
          Starten Sie unter <strong>Domainanalyse</strong> oder <strong>HTML-Analyse</strong>.
        </p>
      </div>
    )
  }

  if (analysisStatus === 'error') {
    return (
      <div className="empty-state">
        <div className="empty-icon">❌</div>
        <p><strong>Analysefehler</strong></p>
        <p style={{ fontSize: '0.85rem', marginTop: 8, color: 'var(--score-red)' }}>{analysisError}</p>
      </div>
    )
  }

  if (analysisStatus === 'running' || !result) {
    const done = new Set(progressEvents.filter(e => e.status === 'done').map(e => e.module))
    const running = progressEvents.find(e => e.status === 'running')?.module
    const htmlMode = !progressEvents.some(e => e.module === 'Crawler')

    const steps = htmlMode
      ? MODULE_STEPS.filter(s => s.label !== 'Crawler' && s.label !== 'Wettbewerbsvergleich')
      : MODULE_STEPS

    const totalSteps = steps.length
    const doneCount = steps.filter(s => done.has(s.label)).length
    const pct = Math.round(doneCount / totalSteps * 100)

    return (
      <div>
        <p className="page-title">Analyse läuft…</p>
        <p className="page-subtitle">Bitte warten Sie, während die Analyse durchgeführt wird.</p>

        {/* Overall progress bar */}
        <div style={{ background: 'var(--border)', borderRadius: 8, height: 8, marginBottom: 24, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 8,
            background: 'var(--accent)',
            width: `${pct}%`,
            transition: 'width 0.4s ease',
          }} />
        </div>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: -18, marginBottom: 20, textAlign: 'right' }}>
          {pct}% — Schritt {doneCount} von {totalSteps}
        </p>

        <div className="progress-list">
          {steps.map(s => {
            const isDone = done.has(s.label)
            const isRunning = running === s.label
            const status = isDone ? 'done' : isRunning ? 'running' : 'waiting'
            return (
              <div key={s.label} className={`progress-item ${status}`}>
                <div className={`progress-icon ${status}`}>
                  {isDone ? '✓' : isRunning ? '…' : '○'}
                </div>
                <span className="progress-name">{s.label}</span>
                <span className="progress-status">
                  {isDone ? 'Fertig' : isRunning ? 'Läuft' : 'Wartend'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Full results ───────────────────────────────────────────

  const r = result
  const setActiveView = useAppStore(s => s.setActiveView)
  const radarData = [
    { subject: 'Techn. SEO',  A: r.scores.technical_seo },
    { subject: 'Schema.org',  A: r.scores.schema },
    { subject: 'Headings',    A: r.scores.headings },
    { subject: 'Content',     A: r.scores.content },
    { subject: 'FAQ',         A: r.scores.faq },
    { subject: 'LLM-Sicht.',  A: r.scores.llm_discoverability },
  ]

  const donutColor = scoreColor(r.gaio_score)

  // Custom label rendered inside the donut
  const DonutLabel = ({ viewBox }: any) => {
    const { cx, cy } = viewBox
    return (
      <g>
        <text x={cx} y={cy - 8} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: '2rem', fontWeight: 900, fill: donutColor, fontFamily: 'Nunito' }}>
          {r.gaio_score}
        </text>
        <text x={cx} y={cy + 18} textAnchor="middle" dominantBaseline="middle"
          style={{ fontSize: '0.7rem', fontWeight: 700, fill: 'var(--text-muted)', fontFamily: 'Nunito', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          / 100
        </text>
      </g>
    )
  }

  const generateReport = () => {
    const date = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
    const company = r.questionnaire.company_name || r.questionnaire.url || 'HTML-Upload'
    const scoreCol = (s: number) => scoreColorHex(s)
    const scoreBg  = (s: number) => scoreBgHex(s)
    const tierIcon = (t: string) => t === 'critical' ? '🔴' : t === 'high_leverage' ? '🟠' : '🟡'
    const tierLabel = (t: string) => t === 'critical' ? 'Kritisch' : t === 'Hoher Hebel' ? '🟠' : 'Nachgeordnet'

    const moduleRows = [
      ['Technische SEO-Basis',         r.scores.technical_seo,      15],
      ['Strukturierte Daten (Schema)', r.scores.schema,             20],
      ['Heading-Struktur',             r.scores.headings,           10],
      ['Inhaltliche Relevanz (KI)',    r.scores.content,            20],
      ['FAQ-Qualität',                 r.scores.faq,                15],
      ['LLM-Sichtbarkeits-Simulation', r.scores.llm_discoverability,20],
    ] as [string, number, number][]

    const recSection = (key: 'critical' | 'high_leverage' | 'secondary', label: string, icon: string) => {
      const items = r.recommendations[key] ?? []
      if (!items.length) return ''
      return `<h2 style="margin:32px 0 14px;font-size:1.1rem;color:#1C1914;border-bottom:2px solid #EDE7DE;padding-bottom:8px;">
        ${icon} ${label} <span style="font-weight:400;font-size:0.85rem;color:#9C8E80">(${items.length})</span>
      </h2>
      ${items.map(rec => `
        <div style="background:#FAFAF7;border:1px solid #E0DAD2;border-left:4px solid ${icon==='🔴'?'#C0392B':icon==='🟠'?'#D97706':'#B8860B'};border-radius:8px;padding:16px;margin-bottom:12px;">
          <p style="font-weight:700;font-size:0.95rem;margin:0 0 10px;">${rec.title}</p>
          <table style="width:100%;border-collapse:collapse;font-size:0.83rem;">
            <tr><td style="padding:4px 0;font-weight:700;color:#9C8E80;width:90px;vertical-align:top;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;">Problem</td><td style="padding:4px 8px;color:#5C5345;">${rec.problem}</td></tr>
            <tr><td style="padding:4px 0;font-weight:700;color:#9C8E80;vertical-align:top;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;">Relevanz</td><td style="padding:4px 8px;color:#5C5345;">${rec.why_matters}</td></tr>
            ${rec.fix ? `<tr><td style="padding:4px 0;font-weight:700;color:#C4761A;vertical-align:top;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.04em;">Fix</td><td style="padding:4px 8px;"><span style="background:#F0E0C5;border-left:3px solid #C4761A;display:block;padding:6px 10px;border-radius:0 6px 6px 0;color:#1C1914;">💡 ${rec.fix}</span></td></tr>` : ''}
          </table>
        </div>`).join('')}`
    }

    const compRows = r.competitors.map(c => {
      if (c.error) return `<tr><td>${safeHostname(c.url)}</td><td colspan="6" style="color:#C0392B;">Nicht erreichbar</td></tr>`
      const delta = (r.gaio_score - c.composite)
      return `<tr>
        <td><strong>${safeHostname(c.url)}</strong></td>
        <td style="color:${scoreCol(c.composite)};font-weight:700;">${c.composite}</td>
        <td style="color:${scoreCol(c.scores?.technical_seo??0)}">${c.scores?.technical_seo??'–'}</td>
        <td style="color:${scoreCol(c.scores?.schema??0)}">${c.scores?.schema??'–'}</td>
        <td style="color:${scoreCol(c.scores?.content??0)}">${c.scores?.content??'–'}</td>
        <td style="color:${scoreCol(c.scores?.faq??0)}">${c.scores?.faq??'–'}</td>
        <td style="color:${delta>=0?'#3A8A4E':'#C0392B'};font-weight:700;">${delta>0?'+':''}${delta}</td>
      </tr>`
    }).join('')

    const urlsList = (r.crawled_urls ?? [])
      .filter(u => u !== 'html-upload')
      .map(u => `<li><a href="${u}" style="color:#C4761A;">${u}</a></li>`)
      .join('')

    const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GAIO Analyse – ${company}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Nunito', system-ui, sans-serif; background: #FAFAF7; color: #1C1914; line-height: 1.65; }
  .page { max-width: 860px; margin: 0 auto; padding: 48px 32px; }
  .header { border-bottom: 3px solid #C4761A; padding-bottom: 24px; margin-bottom: 32px; display: flex; justify-content: space-between; align-items: flex-end; }
  .header-left h1 { font-size: 1.6rem; font-weight: 800; color: #C4761A; letter-spacing: -0.02em; }
  .header-left p { font-size: 0.85rem; color: #9C8E80; margin-top: 4px; }
  .header-right { text-align: right; }
  .gaio-score { font-size: 3.5rem; font-weight: 900; color: ${scoreCol(r.gaio_score)}; line-height: 1; }
  .gaio-label { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #9C8E80; }
  h2 { font-size: 1.1rem; font-weight: 800; color: #1C1914; margin: 32px 0 14px; border-bottom: 2px solid #EDE7DE; padding-bottom: 8px; }
  h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
  th { background: #F2EDE6; padding: 8px 12px; text-align: left; font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #9C8E80; }
  td { padding: 9px 12px; border-bottom: 1px solid #EDE7DE; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .score-pill { display: inline-block; padding: 3px 10px; border-radius: 6px; font-weight: 800; font-size: 0.85rem; }
  .meta { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 28px; }
  .meta-item { background: #F2EDE6; border-radius: 8px; padding: 12px 14px; }
  .meta-item .label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #9C8E80; margin-bottom: 4px; }
  .meta-item .val { font-weight: 800; font-size: 1rem; }
  ul { padding-left: 20px; }
  li { margin-bottom: 4px; font-size: 0.85rem; color: #5C5345; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #EDE7DE; font-size: 0.75rem; color: #9C8E80; text-align: center; }
  @media print {
    body { background: white; }
    .page { padding: 24px; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <h1>GAIO Analyse Report</h1>
      <p><strong>Unternehmen:</strong> ${company}</p>
      <p><strong>URL:</strong> ${r.questionnaire.url || 'HTML-Upload'}</p>
      <p><strong>Erstellt am:</strong> ${date}</p>
      ${r.html_mode ? '<p style="color:#D97706;font-size:0.8rem;margin-top:4px;">⚠ HTML-Einzelseiten-Analyse (kein Vollcrawl)</p>' : ''}
    </div>
    <div class="header-right">
      <div class="gaio-score">${r.gaio_score}</div>
      <div class="gaio-label">GAIO Score / 100</div>
    </div>
  </div>

  ${r.executive_summary ? `
  <!-- Executive Summary -->
  <div style="background:#FFF8F0;border-left:4px solid #C4761A;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
    <p style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#C4761A;margin-bottom:8px;">Executive Summary</p>
    <p style="font-size:0.92rem;line-height:1.75;color:#5C5345;">${r.executive_summary}</p>
  </div>` : ''}

  <!-- Score overview -->
  <h2>Modul-Scores im Überblick</h2>
  <table style="margin-bottom:28px;">
    <thead><tr><th>Modul</th><th>Score</th><th>Gewichtung</th><th>Bewertung</th></tr></thead>
    <tbody>
      ${moduleRows.map(([label, score, weight]) => `
        <tr>
          <td><strong>${label}</strong></td>
          <td><span class="score-pill" style="background:${scoreBg(score as number)};color:${scoreCol(score as number)}">${score}</span></td>
          <td style="color:#9C8E80;">${weight} %</td>
          <td style="color:${scoreCol(score as number)};font-weight:600;">${(score as number) >= 71 ? 'Gut' : (score as number) >= 41 ? 'Ausbaufähig' : 'Kritisch'}</td>
        </tr>`).join('')}
    </tbody>
  </table>

  <!-- Meta facts -->
  <div class="meta">
    <div class="meta-item"><div class="label">HTTPS</div><div class="val">${r.technical_seo?.is_https ? '✅ Aktiv' : '❌ Fehlt'}</div></div>
    <div class="meta-item"><div class="label">Ø Antwortzeit</div><div class="val">${r.technical_seo?.avg_response_ms ?? '–'} ms</div></div>
    <div class="meta-item"><div class="label">Gecrawlte Seiten</div><div class="val">${(r.crawled_urls??[]).filter(u=>u!=='html-upload').length}</div></div>
    <div class="meta-item"><div class="label">Schema-Typen</div><div class="val">${Object.keys(r.schema?.types_found??{}).length}</div></div>
    <div class="meta-item"><div class="label">FAQ-Einträge</div><div class="val">${r.faq?.faq_count ?? 0}</div></div>
    <div class="meta-item"><div class="label">LLM Ø-Qualität</div><div class="val">${r.llm?.avg_rating ?? 0} / 5 ★</div></div>
  </div>

  <!-- Recommendations -->
  ${recSection('critical', 'Kritisch – sofort beheben', '🔴')}
  ${recSection('high_leverage', 'Hoher Hebel – größter Impact', '🟠')}
  ${recSection('secondary', 'Nachgeordnet – nach Prio 1+2', '🟡')}

  <!-- Schema types -->
  ${Object.keys(r.schema?.types_found??{}).length > 0 ? `
  <h2>📋 Gefundene Schema.org-Typen</h2>
  <p style="font-size:0.85rem;color:#5C5345;margin-bottom:12px;">
    ${Object.entries(r.schema.types_found).map(([t,c]) =>
      `<span style="background:#F0E0C5;color:#C4761A;border-radius:6px;padding:2px 10px;font-weight:700;margin:2px;display:inline-block;">${t} ×${c}</span>`
    ).join(' ')}
  </p>
  ${r.schema.missing_important_types?.length > 0 ? `
  <p style="font-size:0.83rem;color:#9C8E80;margin-top:8px;"><strong>Fehlende B2B-Typen:</strong>
    ${r.schema.missing_important_types.map((t: string) =>
      `<span style="background:#FDF0EE;color:#C0392B;border-radius:6px;padding:2px 10px;font-weight:700;margin:2px;display:inline-block;">${t}</span>`
    ).join(' ')}
  </p>` : ''}` : ''}

  <!-- LLM Questions -->
  ${r.llm?.questions_rated?.length > 0 ? `
  <h2>🤖 LLM-Sichtbarkeits-Simulation</h2>
  <table>
    <thead><tr><th>Käufer-Frage</th><th style="width:100px;">Antwortqualität</th><th>Inhaltslücke</th></tr></thead>
    <tbody>
      ${r.llm.questions_rated.map((q: any) => `
        <tr>
          <td>${q.question}</td>
          <td style="text-align:center;font-weight:800;color:${scoreCol(q.rating*20)}">${q.rating}/5</td>
          <td style="color:#9C8E80;font-size:0.8rem;">${q.gap || '–'}</td>
        </tr>`).join('')}
    </tbody>
  </table>` : ''}

  <!-- Competitor table -->
  ${r.competitors?.length > 0 ? `
  <h2>🏆 Wettbewerbsvergleich</h2>
  <table>
    <thead><tr><th>Domain</th><th>Gesamt</th><th>Techn. SEO</th><th>Schema</th><th>Content</th><th>FAQ</th><th>Delta zu Ihnen</th></tr></thead>
    <tbody>${compRows}</tbody>
  </table>
  <p style="font-size:0.72rem;color:#9C8E80;margin-top:8px;">Wettbewerber-Scores basieren auf Einzelseiten-Stichproben.</p>` : ''}

  <!-- Content insights -->
  ${r.content?.overall_summary ? `
  <h2>🧠 Inhaltliche Analyse</h2>
  <p style="color:#5C5345;font-size:0.9rem;line-height:1.75;margin-bottom:12px;">${r.content.overall_summary}</p>` : ''}

  <!-- Crawled URLs -->
  ${urlsList ? `
  <h2>🔗 Gecrawlte Seiten (${(r.crawled_urls??[]).filter(u=>u!=='html-upload').length})</h2>
  <ul>${urlsList}</ul>` : ''}

  <div class="footer">
    GAIO Analyzer · Erstellt am ${date} · Powered by Anthropic Claude
  </div>
</div>
</body></html>`

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `GAIO-Report-${(company).replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const mainScores = { ...r.scores, total: r.gaio_score }

  return (
    <div>
      <p className="page-title">Analyse-Ergebnisse</p>
      {r.html_mode && (
        <div className="info-box" style={{ marginBottom: 16 }}>
          HTML-Analyse – Crawler-Module wurden übersprungen.
        </div>
      )}

      {/* Download + neue Analyse */}
      <div className="download-bar">
        <div>
          <strong style={{ fontSize: '1rem' }}>{r.questionnaire.company_name || r.questionnaire.url || 'HTML-Upload'}</strong>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
            {r.crawled_urls?.filter(u => u !== 'html-upload').length || 1} Seite(n) analysiert
            · {new Date().toLocaleDateString('de-DE')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: '0.85rem', padding: '8px 14px' }}
            onClick={() => setActiveView(r.html_mode ? 'html' : 'domain')}>
            ↩ Neue Analyse
          </button>
          <button className="btn btn-secondary" onClick={generateReport} style={{ fontSize: '0.85rem', padding: '8px 14px' }}>
            ⬇ Download
          </button>
        </div>
      </div>

      {/* Executive summary */}
      {r.executive_summary && (
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderLeft: '4px solid var(--accent)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px 24px',
          marginBottom: 20,
        }}>
          <p style={{
            fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.06em', color: 'var(--accent)', marginBottom: 10,
          }}>Executive Summary</p>
          <p style={{ fontSize: '0.95rem', lineHeight: 1.75, color: 'var(--text-secondary)' }}>
            {r.executive_summary}
          </p>
          <button
            style={{
              marginTop: 12, background: 'none', border: 'none',
              color: 'var(--text-muted)', fontSize: '0.78rem', cursor: 'pointer',
              fontFamily: 'var(--font)', padding: 0, textDecoration: 'underline',
            }}
            onClick={() => navigator.clipboard.writeText(r.executive_summary!).then(() => alert('Kopiert!'))}
          >
            📋 In Zwischenablage kopieren
          </button>
        </div>
      )}

      {/* Score overview */}
      <div className="charts-grid" style={{ marginBottom: 20 }}>
        <div className="chart-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p className="chart-title">GAIO Gesamt-Score</p>
          <PieChart width={200} height={200}>
            <Pie data={[{ value: r.gaio_score }, { value: 100 - r.gaio_score }]}
              cx={96} cy={96} innerRadius={60} outerRadius={80}
              startAngle={90} endAngle={-270} dataKey="value"
              labelLine={false}>
              <Cell fill={donutColor} />
              <Cell fill="var(--border)" />
              <Label content={<DonutLabel />} position="center" />
            </Pie>
          </PieChart>
        </div>

        <div className="chart-card">
          <p className="chart-title">Dimensionen-Überblick</p>
          {r.scores.llm_discoverability === 0 && r.scores.content === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8 }}>
              <ResponsiveContainer width="100%" height={200}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fontFamily: 'Nunito', fill: 'var(--text-muted)' }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar dataKey="A" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: -50 }}>
                KI-Module ohne API Key nicht verfügbar
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fontFamily: 'Nunito', fill: 'var(--text-muted)' }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar dataKey="A" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.25} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Score cards */}
      <div className="scores-grid" style={{ marginBottom: 24 }}>
        {Object.entries(r.scores).map(([key, val]) => {
          const labels: Record<string, string> = {
            technical_seo: 'Technische SEO', schema: 'Schema.org', headings: 'Headings',
            content: 'Content-Relevanz', faq: 'FAQ-Qualität', llm_discoverability: 'LLM-Sichtbarkeit',
          }
          return (
            <div key={key} className="score-card">
              <p className="score-label">{labels[key] ?? key}</p>
              <p className="score-val" style={{ color: scoreColor(val as number) }}>{val as number}</p>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>/100</p>
            </div>
          )
        })}
      </div>

      {/* Module sections */}
      <Section title="📊 Empfehlungen" defaultOpen>
        <Recommendations recs={r.recommendations} />
      </Section>

      <Section title="⚙️ Technische SEO-Analyse" defaultOpen={false}>
        <TechnicalSection data={r.technical_seo} />
      </Section>

      <Section title="🏷️ Strukturierte Daten (Schema.org)" defaultOpen={false}>
        <SchemaSection data={r.schema} />
      </Section>

      <Section title="📝 Heading-Struktur" defaultOpen={false}>
        <HeadingSection data={r.headings} />
      </Section>

      <Section title="🧠 Inhaltliche Relevanz (KI-Analyse)" defaultOpen={false}>
        <ContentSection data={r.content} />
      </Section>

      <Section title="❓ FAQ-Qualität" defaultOpen={false}>
        <FaqSection data={r.faq} />
      </Section>

      <Section title="🤖 LLM-Sichtbarkeits-Simulation" defaultOpen={false}>
        <LlmSection data={r.llm} />
      </Section>

      {r.competitors?.length > 0 && (
        <Section title="🏆 Wettbewerbsvergleich" defaultOpen={false}>
          <CompetitorSection
            competitors={r.competitors}
            mainScores={mainScores}
            mainUrl={r.questionnaire.url || 'Ihre Website'}
          />
        </Section>
      )}
    </div>
  )
}
