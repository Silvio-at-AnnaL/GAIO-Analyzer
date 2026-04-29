// ─── Types ────────────────────────────────────────────────────────────────────

type LlmQ = {
  question: string;
  rating: number;
  gap: string;
  sourceUrl?: string | null;
};

type LlmPart = {
  label: string;
  weight: number;
  avgRating: number;
  score: number;
  questions: LlmQ[];
};

type CompetitorEntry = {
  name: string;
  url: string;
  technicalScore: number;
  schemaScore: number;
  contentScore: number;
  headingScore: number;
  faqScore: number;
  compositeScore: number;
  crawledPagesCount: number;
  crawledPages?: Array<{ url: string; title: string | null }>;
  findings?: { betterThanYou: string; yourAdvantage: string; recommendation: string } | null;
  error?: string;
};

// ─── Light theme palette (hardcoded hex — no CSS vars, works standalone) ─────

const C = {
  bg:          "#f4f5f7",
  card:        "#ffffff",
  text:        "#1a1d23",
  textSec:     "#4a4d57",
  textMuted:   "#787b86",
  border:      "#dde0e8",
  accent:      "#3b82f6",
  codeBg:      "#eef0f4",
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function scoreColor(s: number): string {
  if (s >= 71) return "#22c55e";
  if (s >= 41) return "#f59e0b";
  return "#ef4444";
}

function tierLabel(tier: string): string {
  switch (tier) {
    case "critical":      return "KRITISCH";
    case "high_leverage": return "HOHER HEBEL";
    case "secondary":     return "SEKUNDÄR";
    default:              return tier.toUpperCase();
  }
}

function tierColor(tier: string): string {
  switch (tier) {
    case "critical":      return "#ef4444";
    case "high_leverage": return "#f59e0b";
    case "secondary":     return "#eab308";
    default:              return "#9ca3af";
  }
}

function stars(n: number): string {
  return "★".repeat(Math.max(0, Math.min(5, n))) + "☆".repeat(Math.max(0, 5 - n));
}

function divider(label: string): string {
  return `<div class="section-divider"><span>${esc(label)}</span></div>`;
}

// ─── Section renderers ────────────────────────────────────────────────────────

function renderDetailsSection(report: Record<string, unknown>): string {
  const technicalSeo   = report.technicalSeo   as Record<string, unknown> | null;
  const schemaOrg      = report.schemaOrg      as Record<string, unknown> | null;
  const headings       = report.headingStructure as Record<string, unknown> | null;
  const content        = report.contentRelevance as Record<string, unknown> | null;
  const faq            = report.faqQuality      as Record<string, unknown> | null;
  const hreflang       = (report.hreflangVariants as Array<{ lang: string; url: string }> | undefined) ?? [];
  const crawledPages   = ((report.crawledPages as string[]) ?? []).filter((p) => p !== "uploaded-page");
  const crawledCount   = (report.crawledPages as string[])?.length ?? 0;

  let html = divider("Details");
  html += `<h2>Technische Analyse</h2>`;
  html += `<p style="font-size:12px;color:${C.textMuted};margin-bottom:12px;">${crawledCount} Seiten analysiert</p>`;

  if (technicalSeo) {
    const metaTitlePct   = Math.round(((technicalSeo.metaTitles as Record<string, number>)?.present / Math.max(1, crawledCount)) * 100);
    const metaDescPct    = Math.round(((technicalSeo.metaDescriptions as Record<string, number>)?.present / Math.max(1, crawledCount)) * 100);
    const altPct         = (technicalSeo.imageAltCoverage as number) ?? 0;
    const httpsPct       = (technicalSeo.httpsEnforced as boolean) ? 100 : 0;
    const viewportPct    = (technicalSeo.mobileViewport as boolean) ? 100 : 0;

    html += `
    <h3>SEO-Metriken Abdeckung</h3>
    <table class="data-table">
      <thead><tr><th>Metrik</th><th>Wert</th></tr></thead>
      <tbody>
        <tr><td>Meta-Titel</td><td>${metaTitlePct}%</td></tr>
        <tr><td>Meta-Beschreibung</td><td>${metaDescPct}%</td></tr>
        <tr><td>Alt-Texte</td><td>${altPct}%</td></tr>
        <tr><td>HTTPS</td><td>${httpsPct === 100 ? "✓ Ja" : "✗ Nein"}</td></tr>
        <tr><td>Viewport</td><td>${viewportPct === 100 ? "✓ Ja" : "✗ Nein"}</td></tr>
      </tbody>
    </table>
    <div class="detail-grid">
      <div class="detail-item"><div class="label">Score</div><div class="val" style="color:${scoreColor((technicalSeo.score as number) ?? 0)}">${technicalSeo.score}/100</div></div>
      <div class="detail-item"><div class="label">Antwortzeit</div><div class="val">${technicalSeo.responseTime} ms</div></div>
      <div class="detail-item"><div class="label">TTFB</div><div class="val">${technicalSeo.ttfb} ms</div></div>
      <div class="detail-item"><div class="label">robots.txt</div><div class="val">${(technicalSeo.robotsTxt as boolean) ? "✓ Ja" : "✗ Nein"}</div></div>
      <div class="detail-item"><div class="label">sitemap.xml</div><div class="val">${(technicalSeo.sitemapXml as boolean) ? "✓ Ja" : "✗ Nein"}</div></div>
      <div class="detail-item"><div class="label">Canonical Tags</div><div class="val">${(technicalSeo.canonicalTags as Record<string, unknown>)?.count ?? 0}</div></div>
    </div>`;
  }

  if (schemaOrg) {
    const types = (schemaOrg.detectedTypes as string[] | undefined) ?? [];
    html += `
    <h3>Schema.org / Strukturierte Daten</h3>
    <div class="detail-grid">
      <div class="detail-item"><div class="label">Score</div><div class="val" style="color:${scoreColor((schemaOrg.score as number) ?? 0)}">${schemaOrg.score}/100</div></div>
      <div class="detail-item"><div class="label">Typen erkannt</div><div class="val">${types.length}</div></div>
    </div>
    ${types.length > 0 ? `<p style="font-size:12px;color:${C.textSec};margin:6px 0;">Erkannte Typen: ${types.map(esc).join(", ")}</p>` : ""}`;
  }

  if (headings) {
    const h1 = (headings.h1Tags as Record<string, unknown>)?.count ?? 0;
    const issues = (headings.issues as string[] | undefined) ?? [];
    html += `
    <h3>Heading-Struktur</h3>
    <div class="detail-grid">
      <div class="detail-item"><div class="label">Score</div><div class="val" style="color:${scoreColor((headings.score as number) ?? 0)}">${headings.score}/100</div></div>
      <div class="detail-item"><div class="label">H1-Tags</div><div class="val">${h1}</div></div>
    </div>
    ${issues.length > 0 ? `<ul style="font-size:12px;color:${C.textSec};margin:6px 0;padding-left:16px;">${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}`;
  }

  if (content) {
    html += `
    <h3>Inhaltliche Relevanz</h3>
    <div class="detail-grid">
      <div class="detail-item"><div class="label">Score</div><div class="val" style="color:${scoreColor((content.score as number) ?? 0)}">${content.score}/100</div></div>
    </div>`;
  }

  if (faq) {
    html += `
    <h3>FAQ-Qualität</h3>
    <div class="detail-grid">
      <div class="detail-item"><div class="label">Score</div><div class="val" style="color:${scoreColor((faq.score as number) ?? 0)}">${faq.score}/100</div></div>
      <div class="detail-item"><div class="label">FAQ gefunden</div><div class="val">${(faq.faqFound as boolean) ? "✓ Ja" : "✗ Nein"}</div></div>
      ${(faq.questionCount as number | undefined) !== undefined ? `<div class="detail-item"><div class="label">Fragen</div><div class="val">${faq.questionCount}</div></div>` : ""}
    </div>`;
  }

  if (hreflang.length > 0) {
    html += `
    <h3>Hreflang-Sprachvarianten (${hreflang.length})</h3>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
      ${hreflang.map((v) => `<span style="background:${C.bg};border:1px solid ${C.border};border-radius:4px;padding:3px 8px;font-size:11px;font-family:monospace;"><strong>${esc(v.lang)}</strong>&nbsp;&nbsp;<a href="${esc(v.url)}" style="color:${C.accent};">${esc(v.url)}</a></span>`).join("")}
    </div>`;
  }

  if (crawledPages.length > 0) {
    html += `
    <h3>Gecrawlte Seiten (${crawledPages.length})</h3>
    <ul style="margin:4px 0;padding-left:16px;font-size:12px;color:${C.textSec};">
      ${crawledPages.map((p) => `<li><a href="${esc(p)}" style="color:${C.accent};">${esc(p)}</a></li>`).join("")}
    </ul>`;
  }

  return html;
}

function renderLlmSection(report: Record<string, unknown>): string {
  const llm = report.llmDiscoverability as Record<string, unknown> | null;
  if (!llm) return "";

  const partA     = llm.partA as LlmPart | undefined;
  const partB     = llm.partB as LlmPart | undefined;
  const qs        = (llm.questions || []) as LlmQ[];
  const avgRating = (llm.avgRating as number | undefined) ?? 0;
  const llmScore  = (llm.score as number | undefined) ?? 0;

  let html = divider("LLM-Auffindbarkeit");
  html += `<h2>LLM-Auffindbarkeit</h2>
  <div class="score-grid">
    ${partA ? `<div class="score-card"><div class="label">Teil A – Auffindbarkeit (70%)</div><div class="val" style="color:${scoreColor(partA.score)}">${partA.score}</div><div class="meta">Ø ${partA.avgRating.toFixed(2)} / 5</div></div>` : ""}
    ${partB ? `<div class="score-card"><div class="label">Teil B – Informationstiefe (30%)</div><div class="val" style="color:${scoreColor(partB.score)}">${partB.score}</div><div class="meta">Ø ${partB.avgRating.toFixed(2)} / 5</div></div>` : ""}
    <div class="score-card"><div class="label">Gesamt (gewichtet)</div><div class="val" style="color:${scoreColor(llmScore)}">${llmScore}</div><div class="meta">Ø ${avgRating.toFixed(2)} / 5</div></div>
  </div>`;

  const renderPartQuestions = (part: LlmPart): string => `
  <h3>${esc(part.label)}</h3>
  <p style="font-size:11px;color:${C.textMuted};margin-bottom:8px;">Gewichtung: ${Math.round(part.weight * 100)}% · Ø ${part.avgRating.toFixed(2)} / 5 · Score ${part.score}/100</p>
  ${part.questions.map((q) => `
  <div class="question">
    <div class="q-head"><div class="q">${esc(q.question)}</div><div class="stars">${stars(q.rating)}</div></div>
    ${q.gap ? `<div class="gap">${esc(q.gap)}</div>` : ""}
    ${q.sourceUrl ? `<a class="src" href="${esc(q.sourceUrl)}" target="_blank" rel="noreferrer">${esc(q.sourceUrl)}</a>` : `<span class="src-missing">Keine passende Quellseite gefunden</span>`}
  </div>`).join("")}`;

  if (partA || partB) {
    if (partA) html += renderPartQuestions(partA);
    if (partB) html += renderPartQuestions(partB);
  } else if (qs.length > 0) {
    html += qs.map((q) => `
    <div class="question">
      <div class="q-head"><div class="q">${esc(q.question)}</div><div class="stars">${stars(q.rating)}</div></div>
      ${q.gap ? `<div class="gap">${esc(q.gap)}</div>` : ""}
      ${q.sourceUrl ? `<a class="src" href="${esc(q.sourceUrl)}" target="_blank" rel="noreferrer">${esc(q.sourceUrl)}</a>` : `<span class="src-missing">Keine passende Quellseite gefunden</span>`}
    </div>`).join("");
  }

  return html;
}

function renderCompetitorSection(report: Record<string, unknown>): string {
  const cc = report.competitorComparison as { competitors: CompetitorEntry[] } | null;
  if (!cc || cc.competitors.length === 0) return "";

  const myScore        = (report.overallScore as number) ?? 0;
  const myTechnical    = ((report.technicalSeo      as Record<string, unknown>)?.score as number) ?? 0;
  const mySchema       = ((report.schemaOrg         as Record<string, unknown>)?.score as number) ?? 0;
  const myContent      = ((report.contentRelevance  as Record<string, unknown>)?.score as number) ?? 0;
  const myHeadings     = ((report.headingStructure  as Record<string, unknown>)?.score as number) ?? 0;
  const myFaq          = ((report.faqQuality        as Record<string, unknown>)?.score as number) ?? 0;
  const myDomain = report.url
    ? (() => { try { return new URL(report.url as string).hostname; } catch { return "Ihre Seite"; } })()
    : "Ihre Seite";

  let html = divider("Wettbewerb");
  html += `<h2>Wettbewerbsvergleich</h2>`;

  html += `
  <table class="comp-table">
    <thead><tr>
      <th>Domain</th><th>Gesamt</th><th>Techn.</th><th>Schema</th><th>Inhalt</th><th>Headings</th><th>FAQ</th>
    </tr></thead>
    <tbody>
      <tr style="background:${C.bg};">
        <td><strong>${esc(myDomain)}</strong> <span style="font-size:10px;color:${C.textMuted}">(Ihre Seite)</span></td>
        <td><strong style="color:${scoreColor(myScore)}">${myScore}</strong></td>
        <td style="color:${scoreColor(myTechnical)}">${myTechnical}</td>
        <td style="color:${scoreColor(mySchema)}">${mySchema}</td>
        <td style="color:${scoreColor(myContent)}">${myContent}</td>
        <td style="color:${scoreColor(myHeadings)}">${myHeadings}</td>
        <td style="color:${scoreColor(myFaq)}">${myFaq}</td>
      </tr>
      ${cc.competitors.map((c) => `
      <tr>
        <td>${esc(c.name)}${c.error ? ` <span style="font-size:10px;background:#fef2f2;color:#ef4444;border:1px solid #fca5a5;border-radius:3px;padding:1px 5px;">Nicht erreichbar</span>` : ""}</td>
        <td style="color:${scoreColor(c.compositeScore)}"><strong>${c.compositeScore}</strong></td>
        <td>${c.error ? "—" : c.technicalScore}</td>
        <td>${c.error ? "—" : c.schemaScore}</td>
        <td>${c.error ? "—" : c.contentScore}</td>
        <td>${c.error ? "—" : c.headingScore}</td>
        <td>${c.error ? "—" : c.faqScore}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;

  html += cc.competitors.map((c) => `
  <div class="comp-card">
    <div class="comp-header">
      <strong style="font-size:15px;">${esc(c.name)}</strong>
      <a href="${esc(c.url)}" target="_blank" rel="noreferrer" style="font-size:12px;color:${C.accent};word-break:break-all;">${esc(c.url)}</a>
    </div>
    ${c.error
      ? `<p style="font-size:12px;color:${C.textMuted};margin-top:6px;">Diese Domain konnte nicht gecrawlt werden (Timeout, Zugriffsblockierung oder ungültige URL).</p>`
      : `
    ${c.findings ? `
    <div class="findings">
      <div class="finding-item"><span class="finding-label">Stärke des Wettbewerbers:</span> ${esc(c.findings.betterThanYou)}</div>
      <div class="finding-item"><span class="finding-label">Ihr Vorteil:</span> ${esc(c.findings.yourAdvantage)}</div>
      <div class="finding-item"><span class="finding-label">Empfehlung:</span> ${esc(c.findings.recommendation)}</div>
    </div>` : ""}
    ${c.crawledPages && c.crawledPages.length > 0 ? `
    <div style="margin-top:10px;">
      <p style="font-size:11px;font-weight:600;color:${C.textMuted};margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">Analysierte Seiten</p>
      <ul style="padding-left:16px;margin:0;font-size:12px;">
        ${c.crawledPages.map((p) => `<li><a href="${esc(p.url)}" target="_blank" style="color:${C.accent};">${esc(p.title || p.url)}</a></li>`).join("")}
      </ul>
    </div>` : ""}`}
  </div>`).join("");

  return html;
}

function renderRecommendationsSection(report: Record<string, unknown>): string {
  const recs = (report.recommendations || []) as Array<{
    tier: string; finding: string; whyItMatters: string; fixInstruction: string;
  }>;
  if (recs.length === 0) return "";

  const bySeverity = [
    { key: "critical",      label: "Kritisch" },
    { key: "high_leverage", label: "Hoher Hebel" },
    { key: "secondary",     label: "Nachgeordnet" },
  ];

  let html = divider("Empfehlungen");
  html += `<h2>Empfehlungen</h2>`;

  for (const { key, label } of bySeverity) {
    const group = recs.filter((r) => r.tier === key);
    if (group.length === 0) continue;
    html += `<h3 style="color:${tierColor(key)}">${esc(label)} (${group.length})</h3>`;
    html += group.map((r) => `
  <div class="rec" style="border-color:${tierColor(r.tier)}">
    <div class="tier" style="color:${tierColor(r.tier)}">${tierLabel(r.tier)}</div>
    <div class="finding">${esc(r.finding)}</div>
    <div class="why">${esc(r.whyItMatters)}</div>
    <div class="fix">${esc(r.fixInstruction)}</div>
  </div>`).join("");
  }

  return html;
}

// ─── FAQ / So funktioniert's ─────────────────────────────────────────────────
// Static content — written directly, not fetched dynamically.

/** Inner HTML for the HTML one-pager (uses shared stylesheet classes). */
function renderFaqSection(): string {
  return `
${divider("FAQ / So funktioniert's")}
<h2>FAQ / So funktioniert's</h2>

<h3>Was analysiert dieses Tool?</h3>
<p style="font-size:13px;color:#4a4d57;margin-bottom:16px;line-height:1.7;">
  Der GAIO Analyzer untersucht B2B-Websites auf ihre Auffindbarkeit durch KI-Sprachmodelle (LLMs wie
  ChatGPT, Gemini, Claude) sowie auf klassische SEO-Grundlagen. Das Ergebnis ist ein praxisorientierter
  Bericht mit priorisierten Handlungsempfehlungen.
</p>

<h3>Die Analyse-Module im Überblick</h3>
<table class="data-table">
  <thead><tr><th>Modul</th><th>Was wird geprüft</th><th>Warum es wichtig ist</th></tr></thead>
  <tbody>
    <tr><td>Technische SEO-Basis</td><td>HTTP-Antwortzeit, HTTPS, robots.txt, sitemap.xml, Canonical-Tags, hreflang, Meta-Titel und -Beschreibungen, Alt-Texte, Mobile-Viewport</td><td>Grundvoraussetzung für Indexierung durch Suchmaschinen und LLM-Crawler</td></tr>
    <tr><td>Strukturierte Daten (Schema.org)</td><td>JSON-LD, Microdata, RDFa — erkannte Typen: Organization, Product, FAQPage, BreadcrumbList u.a.; Vollständigkeit der Pflichtfelder</td><td>Maschinenlesbare Fakten erhöhen die Wahrscheinlichkeit, dass LLMs korrekte und vollständige Antworten generieren</td></tr>
    <tr><td>Heading-Struktur</td><td>H1/H2/H3-Hierarchie, Anzahl H1 pro Seite, Hierarchiefehler</td><td>Strukturierte Inhalte werden von LLMs bevorzugt als Quellen verarbeitet</td></tr>
    <tr><td>Inhaltliche Relevanz (KI-gestützt)</td><td>Anwendungsszenarien, technische Tiefe, Beantwortung von Käufer-Fragetypen, identifizierte Inhaltslücken</td><td>LLMs zitieren Seiten häufiger, wenn diese echte Nutzerfragen vollständig beantworten</td></tr>
    <tr><td>FAQ-Qualität</td><td>Erkannte FAQ-Strukturen, Anzahl der Einträge, Qualität der Frageformulierungen und Antworttiefe</td><td>FAQPage-Schema ist einer der stärksten Einzelhebel für LLM-Sichtbarkeit</td></tr>
    <tr><td>LLM-Sichtbarkeits-Simulation</td><td>Generierte Käufer-Fragen (ohne und mit Markenbezug) + prognostizierte Antwortqualität (1–5 Sterne)</td><td>Zeigt direkt, welche Informationslücken LLMs bei Anfragen zu diesem Unternehmen haben</td></tr>
  </tbody>
</table>

<h3>Score-Gewichtung (Gesamt-GAIO-Score)</h3>
<table class="data-table">
  <thead><tr><th>Modul</th><th>Gewichtung</th><th>Begründung</th></tr></thead>
  <tbody>
    <tr><td>Strukturierte Daten</td><td><strong>20%</strong></td><td>Direkt maschinenlesbar, höchste LLM-Verwertung</td></tr>
    <tr><td>Inhaltliche Relevanz</td><td><strong>20%</strong></td><td>Substanz ist Grundlage jeder LLM-Zitation</td></tr>
    <tr><td>LLM-Sichtbarkeit</td><td><strong>20%</strong></td><td>Direktes Maß der KI-Auffindbarkeit</td></tr>
    <tr><td>Technische SEO-Basis</td><td><strong>15%</strong></td><td>Enabler für alle anderen Module</td></tr>
    <tr><td>FAQ-Qualität</td><td><strong>15%</strong></td><td>Hoher Impact bei geringem Aufwand</td></tr>
    <tr><td>Heading-Struktur</td><td><strong>10%</strong></td><td>Wichtig, aber nicht allein entscheidend</td></tr>
  </tbody>
</table>

<h3>Score-Interpretation</h3>
<table class="data-table">
  <thead><tr><th>Score</th><th>Bewertung</th><th>Bedeutung</th></tr></thead>
  <tbody>
    <tr><td><strong style="color:#ef4444">0–40</strong></td><td>Kritisch</td><td>Grundlegende Defizite — LLMs können diese Website kaum als verlässliche Quelle nutzen</td></tr>
    <tr><td><strong style="color:#f59e0b">41–60</strong></td><td>Ausbaufähig</td><td>Technische Basis teilweise vorhanden, aber inhaltliche Lücken limitieren die LLM-Sichtbarkeit erheblich</td></tr>
    <tr><td><strong style="color:#84cc16">61–75</strong></td><td>Solide</td><td>Gute Ausgangsbasis — gezielte Maßnahmen können die Sichtbarkeit spürbar steigern</td></tr>
    <tr><td><strong style="color:#22c55e">76–90</strong></td><td>Stark</td><td>Überdurchschnittlich gut aufgestellt — Feinoptimierung empfohlen</td></tr>
    <tr><td><strong style="color:#22c55e">91–100</strong></td><td>Exzellent</td><td>Best-in-class LLM-Readiness</td></tr>
  </tbody>
</table>

<h3>Empfehlungs-Priorisierung</h3>
<div class="rec" style="border-color:#ef4444;margin-bottom:8px;">
  <div class="tier" style="color:#ef4444">KRITISCH</div>
  <div class="finding">Fundamentale Fehler, die sofort behoben werden müssen.</div>
  <div class="why">Beispiele: kein HTTPS, keine strukturierten Daten, H1 auf der Mehrheit der Seiten fehlend.</div>
</div>
<div class="rec" style="border-color:#f59e0b;margin-bottom:8px;">
  <div class="tier" style="color:#f59e0b">HOHER HEBEL</div>
  <div class="finding">Maßnahmen mit dem größten Wirkungspotenzial.</div>
  <div class="why">Beispiele: fehlende FAQPage-Schema, dünne Produktbeschreibungen ohne Anwendungsszenarien, fehlende Organization-Schema.</div>
</div>
<div class="rec" style="border-color:#eab308;margin-bottom:16px;">
  <div class="tier" style="color:#eab308">NACHGEORDNET</div>
  <div class="finding">Optimierungen für nach der Erstbereinigung.</div>
  <div class="why">Beispiele: Meta-Description-Länge, Alt-Text-Lücken, Heading-Hierarchiefehler.</div>
</div>

<h3>Hinweise zur Genauigkeit</h3>
<p style="font-size:13px;color:#4a4d57;line-height:1.7;">
  Scores basieren auf einer automatisierten Analyse und stellen Annäherungswerte dar.
  Wettbewerber-Scores beruhen auf einer Stichprobe von maximal 3 Seiten pro Wettbewerber.
  Die LLM-Sichtbarkeits-Simulation verwendet Claude (Anthropic) und spiegelt keine garantierten
  Rankingfaktoren wider. Alle Empfehlungen sollten mit einem Experten validiert werden.
</p>`;
}

/** Self-contained FAQ HTML for DOM injection during PDF capture (inline styles only). */
export function buildFaqPanelHtml(): string {
  const bg    = "#f4f5f7";
  const card  = "#ffffff";
  const text  = "#1a1d23";
  const sec   = "#4a4d57";
  const muted = "#787b86";
  const bdr   = "#dde0e8";
  const code  = "#eef0f4";

  const tblStyle = `width:100%;border-collapse:collapse;font-size:13px;margin:10px 0 20px;border:1px solid ${bdr};border-radius:6px;overflow:hidden;`;
  const thStyle  = `background:${bg};color:${muted};font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;padding:8px 10px;text-align:left;border-bottom:1px solid ${bdr};`;
  const tdStyle  = `padding:8px 10px;border-bottom:1px solid ${bdr};color:${text};vertical-align:top;line-height:1.5;`;
  const tdLast   = `padding:8px 10px;color:${text};vertical-align:top;line-height:1.5;`;
  const h2Style  = `font-size:20px;font-weight:700;color:${text};margin:0 0 20px;padding-bottom:10px;border-bottom:2px solid ${bdr};`;
  const h3Style  = `font-size:14px;font-weight:600;color:${text};margin:24px 0 10px;`;
  const pStyle   = `font-size:13px;color:${sec};line-height:1.7;margin-bottom:16px;`;
  const recBase  = `border-left:3px solid;border-radius:6px;padding:12px 14px;margin:8px 0;background:${card};`;

  const row = (cells: string[], last = false): string =>
    `<tr>${cells.map((c, i) => `<td style="${i === cells.length - 1 && last ? tdLast : tdStyle}">${c}</td>`).join("")}</tr>`;

  return `
<div style="background:${card};padding:32px 40px;font-family:-apple-system,'Inter',BlinkMacSystemFont,'Segoe UI',sans-serif;color:${text};line-height:1.6;max-width:1120px;">
  <h2 style="${h2Style}">FAQ / So funktioniert's</h2>

  <h3 style="${h3Style}">Was analysiert dieses Tool?</h3>
  <p style="${pStyle}">Der GAIO Analyzer untersucht B2B-Websites auf ihre Auffindbarkeit durch KI-Sprachmodelle (LLMs wie ChatGPT, Gemini, Claude) sowie auf klassische SEO-Grundlagen. Das Ergebnis ist ein praxisorientierter Bericht mit priorisierten Handlungsempfehlungen.</p>

  <h3 style="${h3Style}">Die Analyse-Module im Überblick</h3>
  <table style="${tblStyle}">
    <thead><tr><th style="${thStyle}">Modul</th><th style="${thStyle}">Was wird geprüft</th><th style="${thStyle}">Warum es wichtig ist</th></tr></thead>
    <tbody>
      ${row(["Technische SEO-Basis","HTTP-Antwortzeit, HTTPS, robots.txt, sitemap.xml, Canonical-Tags, hreflang, Meta-Titel und -Beschreibungen, Alt-Texte, Mobile-Viewport","Grundvoraussetzung für Indexierung durch Suchmaschinen und LLM-Crawler"])}
      ${row(["Strukturierte Daten (Schema.org)","JSON-LD, Microdata, RDFa — erkannte Typen: Organization, Product, FAQPage, BreadcrumbList u.a.; Vollständigkeit der Pflichtfelder","Maschinenlesbare Fakten erhöhen die Wahrscheinlichkeit, dass LLMs korrekte und vollständige Antworten generieren"])}
      ${row(["Heading-Struktur","H1/H2/H3-Hierarchie, Anzahl H1 pro Seite, Hierarchiefehler","Strukturierte Inhalte werden von LLMs bevorzugt als Quellen verarbeitet"])}
      ${row(["Inhaltliche Relevanz (KI-gestützt)","Anwendungsszenarien, technische Tiefe, Beantwortung von Käufer-Fragetypen, identifizierte Inhaltslücken","LLMs zitieren Seiten häufiger, wenn diese echte Nutzerfragen vollständig beantworten"])}
      ${row(["FAQ-Qualität","Erkannte FAQ-Strukturen, Anzahl der Einträge, Qualität der Frageformulierungen und Antworttiefe","FAQPage-Schema ist einer der stärksten Einzelhebel für LLM-Sichtbarkeit"])}
      ${row(["LLM-Sichtbarkeits-Simulation","Generierte Käufer-Fragen (ohne und mit Markenbezug) + prognostizierte Antwortqualität (1–5 Sterne)","Zeigt direkt, welche Informationslücken LLMs bei Anfragen zu diesem Unternehmen haben"], true)}
    </tbody>
  </table>

  <h3 style="${h3Style}">Score-Gewichtung (Gesamt-GAIO-Score)</h3>
  <table style="${tblStyle}">
    <thead><tr><th style="${thStyle}">Modul</th><th style="${thStyle}">Gewichtung</th><th style="${thStyle}">Begründung</th></tr></thead>
    <tbody>
      ${row(["Strukturierte Daten","<strong>20%</strong>","Direkt maschinenlesbar, höchste LLM-Verwertung"])}
      ${row(["Inhaltliche Relevanz","<strong>20%</strong>","Substanz ist Grundlage jeder LLM-Zitation"])}
      ${row(["LLM-Sichtbarkeit","<strong>20%</strong>","Direktes Maß der KI-Auffindbarkeit"])}
      ${row(["Technische SEO-Basis","<strong>15%</strong>","Enabler für alle anderen Module"])}
      ${row(["FAQ-Qualität","<strong>15%</strong>","Hoher Impact bei geringem Aufwand"])}
      ${row(["Heading-Struktur","<strong>10%</strong>","Wichtig, aber nicht allein entscheidend"], true)}
    </tbody>
  </table>

  <h3 style="${h3Style}">Score-Interpretation</h3>
  <table style="${tblStyle}">
    <thead><tr><th style="${thStyle}">Score</th><th style="${thStyle}">Bewertung</th><th style="${thStyle}">Bedeutung</th></tr></thead>
    <tbody>
      ${row(["<strong style='color:#ef4444'>0–40</strong>","Kritisch","Grundlegende Defizite — LLMs können diese Website kaum als verlässliche Quelle nutzen"])}
      ${row(["<strong style='color:#f59e0b'>41–60</strong>","Ausbaufähig","Technische Basis teilweise vorhanden, aber inhaltliche Lücken limitieren die LLM-Sichtbarkeit erheblich"])}
      ${row(["<strong style='color:#84cc16'>61–75</strong>","Solide","Gute Ausgangsbasis — gezielte Maßnahmen können die Sichtbarkeit spürbar steigern"])}
      ${row(["<strong style='color:#22c55e'>76–90</strong>","Stark","Überdurchschnittlich gut aufgestellt — Feinoptimierung empfohlen"])}
      ${row(["<strong style='color:#22c55e'>91–100</strong>","Exzellent","Best-in-class LLM-Readiness"], true)}
    </tbody>
  </table>

  <h3 style="${h3Style}">Empfehlungs-Priorisierung</h3>
  <div style="${recBase}border-color:#ef4444;margin-bottom:8px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#ef4444;">KRITISCH</div>
    <div style="font-size:14px;font-weight:600;color:${text};margin:4px 0;">Fundamentale Fehler, die sofort behoben werden müssen.</div>
    <div style="font-size:12px;color:${sec};">Beispiele: kein HTTPS, keine strukturierten Daten, H1 auf der Mehrheit der Seiten fehlend.</div>
  </div>
  <div style="${recBase}border-color:#f59e0b;margin-bottom:8px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#f59e0b;">HOHER HEBEL</div>
    <div style="font-size:14px;font-weight:600;color:${text};margin:4px 0;">Maßnahmen mit dem größten Wirkungspotenzial.</div>
    <div style="font-size:12px;color:${sec};">Beispiele: fehlende FAQPage-Schema, dünne Produktbeschreibungen ohne Anwendungsszenarien, fehlende Organization-Schema.</div>
  </div>
  <div style="${recBase}border-color:#eab308;margin-bottom:20px;">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#eab308;">NACHGEORDNET</div>
    <div style="font-size:14px;font-weight:600;color:${text};margin:4px 0;">Optimierungen für nach der Erstbereinigung.</div>
    <div style="font-size:12px;color:${sec};">Beispiele: Meta-Description-Länge, Alt-Text-Lücken, Heading-Hierarchiefehler.</div>
  </div>

  <h3 style="${h3Style}">Hinweise zur Genauigkeit</h3>
  <p style="${pStyle}">Scores basieren auf einer automatisierten Analyse und stellen Annäherungswerte dar. Wettbewerber-Scores beruhen auf einer Stichprobe von maximal 3 Seiten pro Wettbewerber. Die LLM-Sichtbarkeits-Simulation verwendet Claude (Anthropic) und spiegelt keine garantierten Rankingfaktoren wider. Alle Empfehlungen sollten mit einem Experten validiert werden.</p>

  <div style="margin-top:32px;padding-top:16px;border-top:1px solid ${bdr};font-size:11px;color:${muted};">
    GAIO Analyzer · <a href="https://gaio-analyzer.com" style="color:#3b82f6;text-decoration:none;">gaio-analyzer.com</a>
    · Exportiert am ${new Date().toLocaleDateString("de-DE")}
  </div>
</div>`;
}

// ─── Main export function ─────────────────────────────────────────────────────

export function generateHtmlReport(report: Record<string, unknown>): string {
  const overallScore = (report.overallScore as number) ?? 0;
  const url          = String(report.url ?? "HTML-Upload");
  const crawledCount = ((report.crawledPages as string[]) ?? []).length;

  const scoreDefs = [
    { name: "Technisches SEO",      score: ((report.technicalSeo        as Record<string, unknown>)?.score as number) ?? 0 },
    { name: "Schema.org",           score: ((report.schemaOrg           as Record<string, unknown>)?.score as number) ?? 0 },
    { name: "Heading-Struktur",     score: ((report.headingStructure    as Record<string, unknown>)?.score as number) ?? 0 },
    { name: "Inhaltliche Relevanz", score: ((report.contentRelevance    as Record<string, unknown>)?.score as number) ?? 0 },
    { name: "FAQ-Qualität",         score: ((report.faqQuality          as Record<string, unknown>)?.score as number) ?? 0 },
    { name: "LLM-Auffindbarkeit",   score: ((report.llmDiscoverability  as Record<string, unknown>)?.score as number) ?? 0 },
  ];

  const bodyContent = [
    renderDetailsSection(report),
    renderLlmSection(report),
    renderCompetitorSection(report),
    renderRecommendationsSection(report),
    renderFaqSection(),
  ].filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GAIO Analysebericht – ${esc(url)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Inter', BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: ${C.bg};
    color: ${C.text};
    line-height: 1.6;
    padding: 40px 20px;
  }
  .container { max-width: 920px; margin: 0 auto; }

  /* Typography */
  h1 { font-size: 22px; font-weight: 700; color: ${C.text}; margin-bottom: 2px; }
  h2 {
    font-size: 16px; font-weight: 700; color: ${C.text};
    margin: 36px 0 14px;
    padding-bottom: 8px;
    border-bottom: 2px solid ${C.border};
  }
  h3 { font-size: 13px; font-weight: 600; color: ${C.text}; margin: 20px 0 8px; }
  h4 { font-size: 11px; color: ${C.textMuted}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
  .subtitle { color: ${C.textMuted}; font-size: 13px; margin-top: 2px; }

  /* Section divider */
  .section-divider {
    display: flex; align-items: center; gap: 12px;
    margin: 40px 0 0;
  }
  .section-divider::before, .section-divider::after {
    content: ""; flex: 1; height: 2px; background: ${C.border};
  }
  .section-divider span {
    font-size: 11px; font-weight: 700; color: ${C.textMuted};
    text-transform: uppercase; letter-spacing: 0.1em;
    white-space: nowrap;
  }

  /* Overall score */
  .overall {
    background: ${C.card}; border: 1px solid ${C.border}; border-radius: 10px;
    padding: 24px; text-align: center; margin: 20px 0;
  }
  .overall .val { font-size: 52px; font-weight: 800; }
  .overall .lbl { font-size: 13px; color: ${C.textMuted}; margin-top: 4px; }

  /* Score grid */
  .score-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 16px 0; }
  .score-card {
    background: ${C.card}; border: 1px solid ${C.border}; border-radius: 8px;
    padding: 14px 12px; text-align: center;
  }
  .score-card .label { font-size: 10px; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.05em; }
  .score-card .val { font-size: 26px; font-weight: 800; margin-top: 2px; }
  .score-card .meta { font-size: 10px; color: ${C.textMuted}; margin-top: 2px; }

  /* Generic data table (replaces bar charts) */
  .data-table {
    width: 100%; border-collapse: collapse; font-size: 13px; margin: 10px 0 16px;
    border: 1px solid ${C.border}; border-radius: 6px; overflow: hidden;
  }
  .data-table th {
    background: ${C.bg}; color: ${C.textMuted}; font-size: 10px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
    padding: 7px 10px; text-align: left; border-bottom: 1px solid ${C.border};
  }
  .data-table td { padding: 7px 10px; border-bottom: 1px solid ${C.border}; color: ${C.text}; }
  .data-table tr:last-child td { border-bottom: none; }
  .data-table tr:nth-child(even) td { background: ${C.bg}; }

  /* Detail grid */
  .detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0; }
  .detail-item { background: ${C.card}; border: 1px solid ${C.border}; border-radius: 6px; padding: 10px 12px; }
  .detail-item .label { font-size: 10px; color: ${C.textMuted}; text-transform: uppercase; letter-spacing: 0.04em; }
  .detail-item .val { font-size: 14px; font-weight: 700; color: ${C.text}; margin-top: 2px; }

  /* LLM questions */
  .question {
    background: ${C.card}; border: 1px solid ${C.border}; border-radius: 6px;
    padding: 12px 14px; margin: 6px 0;
  }
  .question .q-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .question .q { font-size: 13px; font-weight: 500; flex: 1; color: ${C.text}; }
  .question .stars { color: #f59e0b; font-size: 14px; flex-shrink: 0; }
  .question .gap { font-size: 11px; color: ${C.textMuted}; margin-top: 6px; }
  .question .src { display: inline-block; font-size: 11px; color: ${C.accent}; margin-top: 6px; word-break: break-all; text-decoration: none; }
  .question .src:hover { text-decoration: underline; }
  .question .src-missing { display: inline-block; font-size: 11px; color: ${C.textMuted}; font-style: italic; margin-top: 6px; }

  /* Recommendations */
  .rec {
    background: ${C.card}; border-left: 3px solid; border-radius: 6px;
    padding: 12px 14px; margin: 8px 0;
  }
  .rec .tier { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
  .rec .finding { font-size: 14px; font-weight: 600; color: ${C.text}; margin: 4px 0; }
  .rec .why { font-size: 12px; color: ${C.textSec}; }
  .rec .fix {
    font-size: 12px; color: ${C.text}; background: ${C.codeBg};
    padding: 8px 10px; border-radius: 4px; margin-top: 8px;
    white-space: pre-wrap; font-family: monospace;
  }

  /* Competitor table */
  .comp-table {
    width: 100%; border-collapse: collapse; font-size: 13px; margin: 14px 0;
    border: 1px solid ${C.border}; border-radius: 6px; overflow: hidden;
  }
  .comp-table th {
    background: ${C.bg}; color: ${C.textMuted}; font-size: 10px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.05em;
    padding: 8px 10px; text-align: left; border-bottom: 1px solid ${C.border};
  }
  .comp-table td { padding: 8px 10px; border-bottom: 1px solid ${C.border}; color: ${C.text}; }
  .comp-table tr:last-child td { border-bottom: none; }

  /* Competitor detail cards */
  .comp-card {
    background: ${C.card}; border: 1px solid ${C.border}; border-radius: 8px;
    padding: 16px; margin: 10px 0;
  }
  .comp-header { display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
  .findings {
    background: ${C.bg}; border: 1px solid ${C.border}; border-radius: 6px;
    padding: 12px; margin-top: 8px; font-size: 13px;
  }
  .finding-item { margin-bottom: 8px; color: ${C.text}; line-height: 1.5; }
  .finding-item:last-child { margin-bottom: 0; }
  .finding-label { font-weight: 600; color: ${C.textSec}; }

  /* Print layout hints */
  h2 { page-break-after: avoid; }
  h3 { page-break-after: avoid; }
</style>
</head>
<body>
<div class="container">
  <h1>GAIO Analysebericht</h1>
  <p class="subtitle">${esc(url)} · ${crawledCount} Seiten · ${new Date().toLocaleDateString("de-DE")}</p>

  <div class="overall">
    <div class="val" style="color:${scoreColor(overallScore)}">${overallScore}<span style="font-size:24px;font-weight:400;color:${C.textMuted}">/100</span></div>
    <div class="lbl">GAIO Gesamtscore</div>
  </div>

  <h3 style="margin-bottom:8px;">Dimensionen im Überblick</h3>
  <table class="data-table">
    <thead><tr><th>Dimension</th><th>Score</th></tr></thead>
    <tbody>
      ${scoreDefs.map((s) => `<tr><td>${esc(s.name)}</td><td style="font-weight:700;color:${scoreColor(s.score)}">${s.score}/100</td></tr>`).join("")}
    </tbody>
  </table>

  ${bodyContent}

</div>
</body>
</html>`;
}
