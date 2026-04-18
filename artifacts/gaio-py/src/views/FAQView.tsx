export function FAQView() {
  return (
    <div className="faq-page">
      <p className="page-title">FAQ &amp; So funktioniert's</p>
      <p className="page-subtitle">Hintergründe zum GAIO Analyzer: Module, Scores, Gewichtungen.</p>

      <div className="card">
        <h2>Was analysiert dieses Tool?</h2>
        <p>
          Der GAIO Analyzer untersucht B2B-Industriewebsites auf ihre Auffindbarkeit und Verwertbarkeit
          durch KI-Sprachmodelle (LLMs wie ChatGPT, Gemini, Claude) sowie auf klassische SEO-Grundlagen.
          Das Ergebnis ist ein praxisorientierter Bericht mit priorisierten Handlungsempfehlungen.
        </p>
      </div>

      <div className="card">
        <h2>Die Analyse-Module im Überblick</h2>
        <table className="info-table">
          <thead>
            <tr>
              <th>Modul</th>
              <th>Was wird geprüft</th>
              <th>Warum es wichtig ist</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Technische SEO-Basis</strong></td>
              <td>HTTPS, HTTP-Antwortzeit, robots.txt, sitemap.xml, Canonical-Tags, hreflang, Meta-Titel &amp; -Beschreibungen, Alt-Texte, Mobile-Viewport</td>
              <td>Grundvoraussetzung für Indexierung durch Suchmaschinen und LLM-Crawler. Fehlende Basics blockieren jeden anderen Optimierungsversuch.</td>
            </tr>
            <tr>
              <td><strong>Strukturierte Daten (Schema.org)</strong></td>
              <td>JSON-LD, Microdata, RDFa — erkannte Typen: Organization, Product, FAQPage, BreadcrumbList u.a.; Vollständigkeit der Pflichtfelder</td>
              <td>Maschinenlesbare Fakten erhöhen die Wahrscheinlichkeit, dass LLMs korrekte und vollständige Antworten über das Unternehmen generieren.</td>
            </tr>
            <tr>
              <td><strong>Heading-Struktur</strong></td>
              <td>H1/H2/H3-Hierarchie, Anzahl H1 pro Seite, Hierarchiefehler (H3 ohne H2)</td>
              <td>Strukturierte Inhalte werden von LLMs bevorzugt als Quellen verarbeitet. Eine klare Hierarchie signalisiert Relevanz und Kontext.</td>
            </tr>
            <tr>
              <td><strong>Inhaltliche Relevanz (KI-gestützt)</strong></td>
              <td>Anwendungsszenarien, technische Tiefe, Beantwortung von Käufer-Fragetypen, identifizierte Inhaltslücken</td>
              <td>LLMs zitieren Seiten häufiger, wenn diese echte Nutzerfragen vollständig beantworten. Oberflächlicher Content wird ignoriert.</td>
            </tr>
            <tr>
              <td><strong>FAQ-Qualität</strong></td>
              <td>Erkannte FAQ-Strukturen (Schema + HTML-Patterns), Anzahl der Einträge, Qualität der Frageformulierungen und Antworttiefe</td>
              <td>FAQPage-Schema ist einer der stärksten Einzelhebel für LLM-Sichtbarkeit. KI-Systeme nutzen FAQs als strukturierte Wissensquelle.</td>
            </tr>
            <tr>
              <td><strong>LLM-Sichtbarkeits-Simulation</strong></td>
              <td>Generierte Käufer-Fragen auf Basis des Website-Contents + prognostizierte Antwortqualität (Sterne 1–5)</td>
              <td>Zeigt direkt, welche Informationslücken LLMs bei Anfragen zu diesem Unternehmen haben — und wo konkret nachgebessert werden muss.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Score-Gewichtung (Gesamt-GAIO-Score)</h2>
        <p>Der Gesamt-Score ergibt sich aus den gewichteten Einzel-Scores der sechs Module:</p>
        <table className="info-table" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Modul</th><th>Gewichtung</th><th>Begründung</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>Strukturierte Daten</strong></td><td>20 %</td><td>Direkt maschinenlesbar, höchste LLM-Verwertung</td></tr>
            <tr><td><strong>Inhaltliche Relevanz</strong></td><td>20 %</td><td>Substanz ist Grundlage jeder LLM-Zitation</td></tr>
            <tr><td><strong>LLM-Sichtbarkeit</strong></td><td>20 %</td><td>Direktes Maß der KI-Auffindbarkeit</td></tr>
            <tr><td><strong>Technische SEO-Basis</strong></td><td>15 %</td><td>Enabler für alle anderen Module</td></tr>
            <tr><td><strong>FAQ-Qualität</strong></td><td>15 %</td><td>Hoher Impact bei geringem Aufwand</td></tr>
            <tr><td><strong>Heading-Struktur</strong></td><td>10 %</td><td>Wichtig aber nicht allein entscheidend</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Score-Interpretation</h2>
        <table className="info-table">
          <thead>
            <tr><th>Score</th><th>Bewertung</th><th>Bedeutung</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong style={{ color: 'var(--score-red)' }}>0–40</strong></td>
              <td>🔴 Kritisch</td>
              <td>Grundlegende Defizite — LLMs können diese Website kaum als verlässliche Quelle nutzen</td>
            </tr>
            <tr>
              <td><strong style={{ color: 'var(--score-red)' }}>41–60</strong></td>
              <td>🟠 Ausbaufähig</td>
              <td>Technische Basis teilweise vorhanden, aber inhaltliche Lücken limitieren die LLM-Sichtbarkeit erheblich</td>
            </tr>
            <tr>
              <td><strong style={{ color: 'var(--score-orange)' }}>61–75</strong></td>
              <td>🟡 Solide</td>
              <td>Gute Ausgangsbasis — gezielte Maßnahmen können die Sichtbarkeit spürbar steigern</td>
            </tr>
            <tr>
              <td><strong style={{ color: 'var(--score-green)' }}>76–90</strong></td>
              <td>🟢 Stark</td>
              <td>Überdurchschnittlich gut aufgestellt — Feinoptimierung für Spitzenwerte empfohlen</td>
            </tr>
            <tr>
              <td><strong style={{ color: 'var(--score-green)' }}>91–100</strong></td>
              <td>✅ Exzellent</td>
              <td>Best-in-class LLM-Readiness — weiter so und Wettbewerb beobachten</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Empfehlungs-Priorisierung</h2>
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <div style={{ background: 'var(--score-red-bg)', borderLeft: '4px solid var(--score-red)', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ fontWeight: 800, color: 'var(--score-red)', marginBottom: 4 }}>🔴 Kritisch</p>
            <p>Fundamentale Fehler, die sofort behoben werden müssen. Beispiele: kein HTTPS, keine strukturierten Daten auf keiner Seite, H1 auf der Mehrheit der Seiten fehlend.</p>
          </div>
          <div style={{ background: 'var(--score-orange-bg)', borderLeft: '4px solid var(--score-orange)', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ fontWeight: 800, color: 'var(--score-orange)', marginBottom: 4 }}>🟠 Hoher Hebel</p>
            <p>Maßnahmen mit dem größten Wirkungspotenzial. Beispiele: fehlende FAQPage-Schema, dünne Produktbeschreibungen ohne Anwendungsszenarien, fehlende Organization-Schema.</p>
          </div>
          <div style={{ background: '#FEFCE8', borderLeft: '4px solid #B8860B', borderRadius: 8, padding: '12px 16px' }}>
            <p style={{ fontWeight: 800, color: '#B8860B', marginBottom: 4 }}>🟡 Nachgeordnet</p>
            <p>Optimierungen für nach der Erstbereinigung. Beispiele: Meta-Description-Länge, Alt-Text-Lücken bei Nebenbildern, Heading-Hierarchiefehler auf Unterseiten.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Hinweise zur Genauigkeit</h2>
        <p>
          Scores basieren auf einer automatisierten Analyse und stellen Annäherungswerte dar.
          Wettbewerber-Scores beruhen auf einer Stichprobe (max. 1 Seite pro Wettbewerber).
          Die LLM-Sichtbarkeits-Simulation verwendet Claude (Anthropic) und spiegelt keine garantierten
          Rankingfaktoren wider — sie prognostiziert die Antwortqualität auf Basis des verfügbaren Contents.
          Alle Empfehlungen sollten mit einem Experten validiert werden.
        </p>
        <p style={{ marginTop: 10 }}>
          Für Websites mit Login-Bereichen, dynamisch geladenem Content (JavaScript-heavy SPA)
          oder sehr aggressiven Bot-Schutzmechanismen kann die Crawling-Abdeckung eingeschränkt sein.
        </p>
      </div>
    </div>
  )
}
