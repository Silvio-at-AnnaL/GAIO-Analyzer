interface ExportSvgs {
  radarSvg?: string | null;
  donutSvg?: string | null;
  technicalBarSvg?: string | null;
  competitorBarSvg?: string | null;
}

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderLlmQuestion(q: LlmQ): string {
  const stars = "★".repeat(q.rating) + "☆".repeat(Math.max(0, 5 - q.rating));
  const sourceHtml = q.sourceUrl
    ? `<a class="src" href="${escapeHtml(q.sourceUrl)}" target="_blank" rel="noreferrer">↗ ${escapeHtml(q.sourceUrl)}</a>`
    : `<span class="src-missing">Keine passende Quellseite gefunden</span>`;
  return `<div class="question">
    <div class="q-head">
      <div class="q">${escapeHtml(q.question)}</div>
      <div class="stars">${stars}</div>
    </div>
    ${q.gap ? `<div class="gap">${escapeHtml(q.gap)}</div>` : ""}
    ${sourceHtml}
  </div>`;
}

function renderLlmPart(part: LlmPart | undefined): string {
  if (!part || part.questions.length === 0) return "";
  return `<div class="llm-part">
    <h3>${escapeHtml(part.label)}</h3>
    <div class="part-meta">Gewichtung: ${Math.round(part.weight * 100)}% · Ø ${part.avgRating.toFixed(2)} / 5 · Score ${part.score}/100</div>
    ${part.questions.map(renderLlmQuestion).join("")}
  </div>`;
}

export function generateHtmlReport(report: Record<string, unknown>, svgs: ExportSvgs = {}): string {
  const technicalSeo = report.technicalSeo as Record<string, unknown> | null;
  const schemaOrg = report.schemaOrg as Record<string, unknown> | null;
  const contentRelevance = report.contentRelevance as Record<string, unknown> | null;
  const faqQuality = report.faqQuality as Record<string, unknown> | null;
  const llmDiscoverability = report.llmDiscoverability as Record<string, unknown> | null;
  const competitorComparison = report.competitorComparison as {
    competitors: Array<{ name: string; compositeScore: number }>;
  } | null;
  const recommendations = (report.recommendations || []) as Array<{
    tier: string;
    finding: string;
    whyItMatters: string;
    fixInstruction: string;
  }>;

  const llmQuestions = (llmDiscoverability?.questions || []) as LlmQ[];
  const llmPartA = llmDiscoverability?.partA as LlmPart | undefined;
  const llmPartB = llmDiscoverability?.partB as LlmPart | undefined;
  const llmAvgRating = (llmDiscoverability?.avgRating as number | undefined) ?? 0;

  const scoreColor = (s: number) => {
    if (s >= 71) return "#22c55e";
    if (s >= 41) return "#f59e0b";
    return "#ef4444";
  };

  const overallScore = (report.overallScore as number) ?? 0;

  const scores = [
    { name: "Technisches SEO", score: (technicalSeo?.score as number) ?? 0 },
    { name: "Schema.org", score: (schemaOrg?.score as number) ?? 0 },
    { name: "Heading-Struktur", score: ((report.headingStructure as Record<string, unknown>)?.score as number) ?? 0 },
    { name: "Inhaltliche Relevanz", score: (contentRelevance?.score as number) ?? 0 },
    { name: "FAQ-Qualitaet", score: (faqQuality?.score as number) ?? 0 },
    { name: "LLM-Auffindbarkeit", score: (llmDiscoverability?.score as number) ?? 0 },
  ];

  const tierLabel = (tier: string) => {
    switch (tier) {
      case "critical": return "KRITISCH";
      case "high_leverage": return "HOHER HEBEL";
      case "secondary": return "SEKUNDAER";
      default: return tier;
    }
  };

  const tierColor = (tier: string) => {
    switch (tier) {
      case "critical": return "#ef4444";
      case "high_leverage": return "#f59e0b";
      case "secondary": return "#eab308";
      default: return "#9ca3af";
    }
  };

  const llmSection = llmQuestions.length > 0 ? `
  <h2>LLM-Auffindbarkeits-Simulation</h2>
  <div class="llm-summary">
    <div class="llm-card"><div class="lbl">Auffindbarkeit (Teil A · 70%)</div><div class="val" style="color: ${scoreColor(llmPartA?.score ?? 0)}">${llmPartA?.score ?? 0}<span class="sm">/100</span></div><div class="meta">Ø ${(llmPartA?.avgRating ?? 0).toFixed(2)} / 5</div></div>
    <div class="llm-card"><div class="lbl">Informationstiefe (Teil B · 30%)</div><div class="val" style="color: ${scoreColor(llmPartB?.score ?? 0)}">${llmPartB?.score ?? 0}<span class="sm">/100</span></div><div class="meta">Ø ${(llmPartB?.avgRating ?? 0).toFixed(2)} / 5</div></div>
    <div class="llm-card"><div class="lbl">Gesamt (gewichtet)</div><div class="val" style="color: ${scoreColor((llmDiscoverability?.score as number) ?? 0)}">${(llmDiscoverability?.score as number) ?? 0}<span class="sm">/100</span></div><div class="meta">Ø ${llmAvgRating.toFixed(2)} / 5</div></div>
  </div>
  ${(llmPartA || llmPartB)
    ? `${renderLlmPart(llmPartA)}${renderLlmPart(llmPartB)}`
    : llmQuestions.map(renderLlmQuestion).join("")}
  ` : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GAIO Analysebericht - ${escapeHtml(String(report.url ?? "HTML-Upload"))}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #0f1117; color: #e2e8f0; line-height: 1.6; padding: 40px 20px; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 700; font-family: monospace; margin-bottom: 4px; }
  h2 { font-size: 18px; font-weight: 600; font-family: monospace; margin: 32px 0 16px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }
  h3 { font-size: 14px; font-weight: 600; font-family: monospace; margin: 20px 0 8px; color: #f8fafc; }
  .subtitle { color: #94a3b8; font-size: 13px; font-family: monospace; }
  .score-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
  .score-card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 6px; padding: 16px; text-align: center; }
  .score-card .label { font-size: 11px; color: #94a3b8; font-family: monospace; text-transform: uppercase; }
  .score-card .value { font-size: 28px; font-weight: 700; font-family: monospace; }
  .overall { background: #1a1f2e; border: 2px solid #2d3748; border-radius: 8px; padding: 24px; text-align: center; margin: 20px 0; }
  .overall .value { font-size: 48px; font-weight: 700; font-family: monospace; }
  .overall .label { font-size: 14px; color: #94a3b8; font-family: monospace; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
  .chart-box { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 6px; padding: 16px; }
  .chart-box h4 { font-size: 11px; color: #94a3b8; font-family: monospace; text-transform: uppercase; margin-bottom: 8px; }
  .chart-box svg { display: block; margin: 0 auto; max-width: 100%; height: auto; max-height: 280px; }
  .rec { background: #1a1f2e; border-left: 3px solid; border-radius: 4px; padding: 12px 16px; margin: 8px 0; page-break-inside: avoid; }
  .rec .tier { font-size: 10px; font-weight: 700; font-family: monospace; text-transform: uppercase; letter-spacing: 1px; }
  .rec .finding { font-size: 14px; font-weight: 500; margin: 4px 0; }
  .rec .why { font-size: 12px; color: #94a3b8; }
  .rec .fix { font-size: 12px; font-family: monospace; background: #0f1117; padding: 8px; border-radius: 4px; margin-top: 8px; white-space: pre-wrap; }
  .llm-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
  .llm-card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 6px; padding: 14px; text-align: center; }
  .llm-card .lbl { font-size: 10px; color: #94a3b8; font-family: monospace; text-transform: uppercase; }
  .llm-card .val { font-size: 24px; font-weight: 700; font-family: monospace; margin-top: 4px; }
  .llm-card .val .sm { font-size: 12px; color: #94a3b8; }
  .llm-card .meta { font-size: 10px; color: #94a3b8; margin-top: 4px; }
  .llm-part { margin: 20px 0; page-break-inside: avoid; }
  .llm-part .part-meta { font-size: 11px; color: #94a3b8; font-family: monospace; margin-bottom: 8px; }
  .question { background: #1a1f2e; border-radius: 4px; padding: 12px; margin: 6px 0; page-break-inside: avoid; }
  .question .q-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .question .q { font-size: 13px; font-weight: 500; flex: 1; }
  .question .stars { color: #f59e0b; font-size: 14px; font-family: monospace; flex-shrink: 0; }
  .question .gap { font-size: 11px; color: #94a3b8; margin-top: 6px; }
  .question .src { display: inline-block; font-size: 11px; color: #60a5fa; margin-top: 6px; word-break: break-all; text-decoration: none; }
  .question .src:hover { text-decoration: underline; }
  .question .src-missing { display: inline-block; font-size: 11px; color: #64748b; font-style: italic; margin-top: 6px; }
  .detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .detail-item { padding: 8px 0; }
  .detail-item .label { font-size: 11px; color: #94a3b8; }
  .detail-item .val { font-size: 14px; font-weight: 600; font-family: monospace; }
  h2, h3 { page-break-after: avoid; }
  @media print {
    body { background: white; color: #1a1a1a; padding: 20px; }
    .score-card, .overall, .rec, .question, .llm-card, .chart-box { background: #f8f9fa; border-color: #dee2e6; }
    .question .gap, .llm-card .lbl, .llm-card .meta, .llm-part .part-meta, .subtitle, .score-card .label, .overall .label, .rec .why, .detail-item .label, .chart-box h4 { color: #475569; }
    h2 { border-color: #cbd5e1; }
    .rec .fix { background: #e2e8f0; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>GAIO Analysebericht</h1>
  <p class="subtitle">${escapeHtml(String(report.url ?? "HTML-Upload"))} | ${(report.crawledPages as string[]).length} Seiten | ${new Date().toLocaleDateString("de-DE")}</p>

  <div class="overall">
    <div class="value" style="color: ${scoreColor(overallScore)}">${overallScore}</div>
    <div class="label">GAIO Gesamtscore</div>
  </div>

  ${svgs.donutSvg || svgs.radarSvg ? `
  <div class="charts">
    ${svgs.donutSvg ? `<div class="chart-box"><h4>Score-Übersicht</h4>${svgs.donutSvg}</div>` : ""}
    ${svgs.radarSvg ? `<div class="chart-box"><h4>Radar (alle Module)</h4>${svgs.radarSvg}</div>` : ""}
  </div>` : ""}

  <div class="score-grid">
    ${scores.map((s) => `<div class="score-card"><div class="label">${s.name}</div><div class="value" style="color: ${scoreColor(s.score)}">${s.score}</div></div>`).join("")}
  </div>

  ${technicalSeo ? `
  <h2>Technisches SEO</h2>
  ${svgs.technicalBarSvg ? `<div class="chart-box"><h4>Abdeckung</h4>${svgs.technicalBarSvg}</div>` : ""}
  <div class="detail-grid">
    <div class="detail-item"><div class="label">Antwortzeit</div><div class="val">${technicalSeo.responseTime}ms</div></div>
    <div class="detail-item"><div class="label">TTFB</div><div class="val">${technicalSeo.ttfb}ms</div></div>
    <div class="detail-item"><div class="label">robots.txt</div><div class="val">${(technicalSeo.robotsTxt as boolean) ? "Ja" : "Nein"}</div></div>
    <div class="detail-item"><div class="label">sitemap.xml</div><div class="val">${(technicalSeo.sitemapXml as boolean) ? "Ja" : "Nein"}</div></div>
    <div class="detail-item"><div class="label">HTTPS</div><div class="val">${(technicalSeo.httpsEnforced as boolean) ? "Ja" : "Nein"}</div></div>
    <div class="detail-item"><div class="label">Viewport</div><div class="val">${(technicalSeo.mobileViewport as boolean) ? "Ja" : "Nein"}</div></div>
    <div class="detail-item"><div class="label">Alt-Texte</div><div class="val">${technicalSeo.imageAltCoverage}%</div></div>
    <div class="detail-item"><div class="label">Canonical Tags</div><div class="val">${(technicalSeo.canonicalTags as Record<string, unknown>)?.count}</div></div>
  </div>` : ""}

  ${llmSection}

  ${competitorComparison && competitorComparison.competitors.length > 0 ? `
  <h2>Wettbewerbsvergleich</h2>
  ${svgs.competitorBarSvg ? `<div class="chart-box"><h4>Composite Score</h4>${svgs.competitorBarSvg}</div>` : ""}
  ` : ""}

  ${recommendations.length > 0 ? `
  <h2>Empfehlungen</h2>
  ${recommendations.map((r) => `
  <div class="rec" style="border-color: ${tierColor(r.tier)}">
    <div class="tier" style="color: ${tierColor(r.tier)}">${tierLabel(r.tier)}</div>
    <div class="finding">${escapeHtml(r.finding)}</div>
    <div class="why">${escapeHtml(r.whyItMatters)}</div>
    <div class="fix">${escapeHtml(r.fixInstruction)}</div>
  </div>`).join("")}` : ""}

</div>
</body>
</html>`;
}
