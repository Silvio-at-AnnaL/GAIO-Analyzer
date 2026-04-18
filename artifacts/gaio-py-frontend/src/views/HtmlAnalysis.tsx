import { useState, useRef } from 'react'
import axios from 'axios'
import { useAppStore } from '../store/appStore'

export function HtmlAnalysis() {
  const {
    htmlContent, setHtmlContent,
    questionnaire,
    startAnalysis, addProgress, setResult, setError,
    setActiveView, setCrawledUrls, resetAnalysis,
  } = useAppStore()

  const [tab, setTab] = useState<'paste' | 'upload'>('paste')
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [formError, setFormError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    if (!file.name.match(/\.(html?|htm)$/i)) {
      setFormError('Nur .html oder .htm Dateien erlaubt')
      return
    }
    setFileName(`${file.name} (${(file.size / 1024).toFixed(1)} KB)`)
    const reader = new FileReader()
    reader.onload = (e) => setHtmlContent(e.target?.result as string ?? '')
    reader.readAsText(file)
    setFormError('')
  }

  const handleStart = async () => {
    if (!htmlContent.trim()) {
      setFormError('Bitte HTML-Code einfügen oder Datei hochladen')
      return
    }
    setFormError('')
    resetAnalysis()
    setActiveView('results')
    setCrawledUrls([])

    try {
      const res = await axios.post('/api/analyze/html', {
        html_content: htmlContent,
        questionnaire,
      })
      const { task_id } = res.data
      startAnalysis(task_id)

      const evtSource = new EventSource(`/api/analysis/${task_id}/stream`)
      evtSource.addEventListener('progress', (e) => addProgress(JSON.parse(e.data)))
      evtSource.addEventListener('complete', async () => {
        evtSource.close()
        const r = await axios.get(`/api/analysis/${task_id}/results`)
        setResult(r.data)
      })
      evtSource.addEventListener('error', (e: any) => {
        evtSource.close()
        try { setError(JSON.parse(e.data || '{}').message || 'Fehler') }
        catch { setError('Verbindungsfehler') }
      })
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Serverfehler')
    }
  }

  return (
    <div>
      <p className="page-title">HTML-Analyse</p>
      <p className="page-subtitle">Analysieren Sie eine einzelne Seite anhand ihres HTML-Codes.</p>

      <div className="info-box">
        ℹ️ Wenn Sie diesen Weg wählen, wird <strong>nur die einzelne Seite</strong> analysiert,
        die Sie hier bereitstellen. Crawler-abhängige Module werden übersprungen.
      </div>

      <div className="card">
        <div className="tabs">
          <button className={`tab-btn ${tab === 'paste' ? 'active' : ''}`} onClick={() => setTab('paste')}>
            Code einfügen
          </button>
          <button className={`tab-btn ${tab === 'upload' ? 'active' : ''}`} onClick={() => setTab('upload')}>
            Datei hochladen
          </button>
        </div>

        {tab === 'paste' && (
          <textarea
            className="form-input form-textarea"
            style={{ fontFamily: 'monospace', fontSize: '0.82rem', minHeight: 320 }}
            value={htmlContent}
            onChange={e => setHtmlContent(e.target.value)}
            placeholder="HTML-Code hier einfügen..."
          />
        )}

        {tab === 'upload' && (
          <div
            className={`upload-zone ${dragOver ? 'dragover' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault(); setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFile(f)
            }}
          >
            <div className="upload-icon">📂</div>
            {fileName ? (
              <>
                <p><strong>{fileName}</strong></p>
                <p style={{ fontSize: '0.78rem', marginTop: 4, color: 'var(--text-muted)' }}>
                  Erneut klicken zum Ersetzen
                </p>
              </>
            ) : (
              <>
                <p>Datei hierher ziehen oder <strong>klicken zum Auswählen</strong></p>
                <p style={{ fontSize: '0.78rem', marginTop: 4, color: 'var(--text-muted)' }}>
                  Akzeptierte Formate: .html, .htm
                </p>
              </>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".html,.htm"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
            />
          </div>
        )}

        {formError && <p className="form-error" style={{ marginTop: 10 }}>{formError}</p>}
      </div>

      <button className="btn btn-primary" onClick={handleStart} style={{ marginTop: 16 }}>
        🚀 Analyse starten
      </button>
    </div>
  )
}
