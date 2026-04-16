export function FaqView() {
  const modules = [
    {
      modul: "Technische SEO-Basis",
      pruefung: "HTTP-Antwortzeit, HTTPS, robots.txt, sitemap.xml, Canonical-Tags, hreflang, Meta-Daten, Alt-Texte, Mobile-Viewport",
      wichtig: "Grundvoraussetzung für Indexierung durch Suchmaschinen und LLM-Crawler",
    },
    {
      modul: "Strukturierte Daten (Schema.org)",
      pruefung: "JSON-LD, Microdata, RDFa — Typen: Organization, Product, FAQPage, BreadcrumbList u.a.",
      wichtig: "Maschinenlesbare Fakten erhöhen die Wahrscheinlichkeit, dass LLMs korrekte und vollständige Antworten generieren",
    },
    {
      modul: "Heading-Struktur",
      pruefung: "H1/H2/H3-Hierarchie, Keyword-Präsenz in Überschriften",
      wichtig: "Strukturierte Inhalte werden von LLMs bevorzugt als Quellen verarbeitet",
    },
    {
      modul: "Inhaltliche Relevanz (KI-gestützt)",
      pruefung: "Vorhandensein von Anwendungsszenarien, technischer Tiefe, Käufer-Fragetypen",
      wichtig: "LLMs zitieren Seiten häufiger, wenn diese echte Nutzerfragen vollständig beantworten",
    },
    {
      modul: "FAQ-Qualität",
      pruefung: "Erkannte FAQ-Strukturen, Frageformulierung, Antworttiefe",
      wichtig: "FAQPage-Schema ist einer der stärksten Einzelhebel für LLM-Sichtbarkeit",
    },
    {
      modul: "LLM-Sichtbarkeitssimulation",
      pruefung: "Generierte Käuferfragen + prognostizierte Antwortqualität auf Basis des vorhandenen Contents",
      wichtig: "Zeigt direkt, welche Informationslücken LLMs bei Anfragen zu Ihrem Unternehmen haben",
    },
  ];

  const weights = [
    { label: "Strukturierte Daten", pct: 20, color: "hsl(var(--chart-4))" },
    { label: "Inhaltliche Relevanz", pct: 20, color: "hsl(var(--chart-1))" },
    { label: "LLM-Sichtbarkeit", pct: 20, color: "hsl(var(--chart-2))" },
    { label: "Technische SEO-Basis", pct: 15, color: "hsl(var(--chart-3))" },
    { label: "FAQ-Qualität", pct: 15, color: "hsl(var(--chart-5))" },
    { label: "Heading-Struktur", pct: 10, color: "hsl(var(--muted-foreground))" },
  ];

  const scoreRanges = [
    { range: "0–40", bewertung: "Kritisch", bedeutung: "Grundlegende Defizite — LLMs können diese Website kaum als Quelle nutzen", color: "hsl(0 84% 60%)" },
    { range: "41–60", bewertung: "Ausbaufähig", bedeutung: "Technische Basis vorhanden, aber inhaltliche Lücken limitieren die LLM-Sichtbarkeit erheblich", color: "hsl(35 92% 55%)" },
    { range: "61–75", bewertung: "Solide", bedeutung: "Gute Ausgangsbasis — gezielte Maßnahmen können die Sichtbarkeit spürbar steigern", color: "hsl(43 96% 56%)" },
    { range: "76–90", bewertung: "Stark", bedeutung: "Überdurchschnittlich gut aufgestellt; Feinoptimierung empfohlen", color: "hsl(142 71% 45%)" },
    { range: "91–100", bewertung: "Exzellent", bedeutung: "Best-in-class LLM-Readiness", color: "hsl(142 71% 38%)" },
  ];

  return (
    <div className="max-w-3xl space-y-10 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">FAQ / So funktioniert's</h1>
        <p className="text-muted-foreground mt-1">Alles über die Analyse-Methodik und Score-Interpretation.</p>
      </div>

      {/* Was analysiert dieses Tool? */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Was analysiert dieses Tool?</h2>
        <p className="text-base leading-relaxed text-foreground/90">
          GAIO Analyzer untersucht B2B-Industriewebsites auf ihre Auffindbarkeit durch KI-Sprachmodelle (LLMs) sowie auf klassische SEO-Grundlagen. Ziel ist es, konkrete Handlungsempfehlungen zu liefern, die sowohl die Suchmaschinen-Indexierung als auch die Zitierwahrscheinlichkeit durch KI-Assistenten wie ChatGPT, Gemini oder Perplexity erhöhen.
        </p>
      </section>

      {/* Analyse-Module */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Die Analyse-Module im Überblick</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-48">Modul</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Was wird geprüft</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Warum es wichtig ist</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m, i) => (
                <tr key={i} className="border-b border-border last:border-0" style={{ background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.3)" }}>
                  <td className="px-4 py-3 font-medium align-top">{m.modul}</td>
                  <td className="px-4 py-3 text-muted-foreground align-top leading-relaxed">{m.pruefung}</td>
                  <td className="px-4 py-3 text-muted-foreground align-top leading-relaxed">{m.wichtig}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Score-Gewichtung */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Score-Gewichtung (Gesamt-GAIO-Score)</h2>
        <div className="space-y-3">
          {weights.map((w) => (
            <div key={w.label} className="flex items-center gap-4">
              <div className="w-40 text-sm font-medium shrink-0">{w.label}</div>
              <div className="flex-1 h-6 rounded-md overflow-hidden bg-muted/40 relative">
                <div
                  className="h-full rounded-md transition-all"
                  style={{ width: `${w.pct * 5}%`, background: w.color, opacity: 0.85 }}
                />
              </div>
              <div className="w-10 text-sm font-bold text-right" style={{ color: w.color }}>{w.pct}%</div>
            </div>
          ))}
        </div>
      </section>

      {/* Score-Interpretation */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Score-Interpretation</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-24">Score</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-32">Bewertung</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Bedeutung</th>
              </tr>
            </thead>
            <tbody>
              {scoreRanges.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0" style={{ background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.3)" }}>
                  <td className="px-4 py-3 font-bold font-mono" style={{ color: r.color }}>{r.range}</td>
                  <td className="px-4 py-3 font-semibold" style={{ color: r.color }}>{r.bewertung}</td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">{r.bedeutung}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Empfehlungs-Priorisierung */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Empfehlungs-Priorisierung</h2>
        <p className="text-sm text-muted-foreground">Jede Analyse erzeugt priorisierte Handlungsempfehlungen in drei Stufen:</p>
        <div className="space-y-3">
          {[
            {
              dot: "🔴",
              label: "Kritisch",
              color: "hsl(0 84% 60%)",
              bg: "hsl(0 84% 60% / 0.08)",
              border: "hsl(0 84% 60% / 0.3)",
              desc: "Fundamentale Fehler, die sofort behoben werden müssen (z. B. fehlendes HTTPS, keine strukturierten Daten, kein H1).",
            },
            {
              dot: "🟠",
              label: "Hoher Hebel",
              color: "hsl(35 92% 55%)",
              bg: "hsl(35 92% 55% / 0.08)",
              border: "hsl(35 92% 55% / 0.3)",
              desc: "Maßnahmen mit dem größten Wirkungspotenzial (z. B. fehlende FAQPage-Schema, dünne Produktbeschreibungen, fehlende Anwendungsszenarien).",
            },
            {
              dot: "🟡",
              label: "Nachgeordnet",
              color: "hsl(43 96% 50%)",
              bg: "hsl(43 96% 50% / 0.08)",
              border: "hsl(43 96% 50% / 0.3)",
              desc: "Optimierungen für nach der Erstbereinigung (z. B. Meta-Description-Länge, Alt-Text-Lücken).",
            },
          ].map((tier) => (
            <div
              key={tier.label}
              className="rounded-lg border px-4 py-3 flex gap-3 items-start"
              style={{ background: tier.bg, borderColor: tier.border }}
            >
              <span className="text-lg leading-none mt-0.5">{tier.dot}</span>
              <div>
                <p className="font-semibold text-sm" style={{ color: tier.color }}>{tier.label}</p>
                <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{tier.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Hinweise zur Genauigkeit */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b border-border pb-2">Hinweise zur Genauigkeit</h2>
        <p className="text-base leading-relaxed text-muted-foreground">
          Scores basieren auf einer automatisierten Analyse und stellen Annäherungswerte dar. Wettbewerber-Scores beruhen auf einer Stichprobe (Startseite + max. 3 Unterseiten). Die LLM-Sichtbarkeitssimulation verwendet Claude (Anthropic) und spiegelt keine garantierten Rankingfaktoren wider. Alle Empfehlungen sollten mit einem Experten validiert werden.
        </p>
      </section>
    </div>
  );
}
