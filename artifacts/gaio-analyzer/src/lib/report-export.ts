export function generateHtmlReport(report: Record<string, unknown>): string {
  const technicalSeo = report.technicalSeo as Record<string, unknown> | null;
  const schemaOrg = report.schemaOrg as Record<string, unknown> | null;
  const contentRelevance = report.contentRelevance as Record<string, unknown> | null;
  const faqQuality = report.faqQuality as Record<string, unknown> | null;
  const llmDiscoverability = report.llmDiscoverability as Record<string, unknown> | null;
  const recommendations = (report.recommendations || []) as Array<{
    tier: string;
    finding: string;
    whyItMatters: string;
    fixInstruction: string;
  }>;
  const llmQuestions = (llmDiscoverability?.questions || []) as Array<{
    question: string;
    rating: number;
    gap: string;
  }>;

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

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GAIO Analysebericht - ${report.url || "HTML-Upload"}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: #0f1117; color: #e2e8f0; line-height: 1.6; padding: 40px 20px; }
  .container { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 700; font-family: monospace; margin-bottom: 4px; }
  h2 { font-size: 18px; font-weight: 600; font-family: monospace; margin: 32px 0 16px; border-bottom: 1px solid #1e293b; padding-bottom: 8px; }
  h3 { font-size: 14px; font-weight: 600; font-family: monospace; margin: 16px 0 8px; }
  .subtitle { color: #94a3b8; font-size: 13px; font-family: monospace; }
  .score-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
  .score-card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 6px; padding: 16px; text-align: center; }
  .score-card .label { font-size: 11px; color: #94a3b8; font-family: monospace; text-transform: uppercase; }
  .score-card .value { font-size: 28px; font-weight: 700; font-family: monospace; }
  .overall { background: #1a1f2e; border: 2px solid #2d3748; border-radius: 8px; padding: 24px; text-align: center; margin: 20px 0; }
  .overall .value { font-size: 48px; font-weight: 700; font-family: monospace; }
  .overall .label { font-size: 14px; color: #94a3b8; font-family: monospace; }
  .rec { background: #1a1f2e; border-left: 3px solid; border-radius: 4px; padding: 12px 16px; margin: 8px 0; }
  .rec .tier { font-size: 10px; font-weight: 700; font-family: monospace; text-transform: uppercase; letter-spacing: 1px; }
  .rec .finding { font-size: 14px; font-weight: 500; margin: 4px 0; }
  .rec .why { font-size: 12px; color: #94a3b8; }
  .rec .fix { font-size: 12px; font-family: monospace; background: #0f1117; padding: 8px; border-radius: 4px; margin-top: 8px; white-space: pre-wrap; }
  .question { background: #1a1f2e; border-radius: 4px; padding: 12px; margin: 6px 0; }
  .question .q { font-size: 13px; font-weight: 500; }
  .question .stars { color: #f59e0b; font-size: 14px; }
  .question .gap { font-size: 11px; color: #94a3b8; margin-top: 4px; }
  .detail-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .detail-item { padding: 8px 0; }
  .detail-item .label { font-size: 11px; color: #94a3b8; }
  .detail-item .val { font-size: 14px; font-weight: 600; font-family: monospace; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; margin: 2px; }
  .badge-green { background: #166534; color: #86efac; }
  .badge-red { background: #7f1d1d; color: #fca5a5; }
  .badge-blue { background: #1e3a5f; color: #93c5fd; }
  @media print { body { background: white; color: #1a1a1a; } .score-card, .overall, .rec, .question { background: #f8f9fa; border-color: #dee2e6; } }
</style>
</head>
<body>
<div class="container">
  <h1>GAIO Analysebericht</h1>
  <p class="subtitle">${report.url || "HTML-Upload"} | ${(report.crawledPages as string[]).length} Seiten | ${new Date().toLocaleDateString("de-DE")}</p>

  <div class="overall">
    <div class="value" style="color: ${scoreColor(overallScore)}">${overallScore}</div>
    <div class="label">GAIO Gesamtscore</div>
  </div>

  <div class="score-grid">
    ${scores.map((s) => `<div class="score-card"><div class="label">${s.name}</div><div class="value" style="color: ${scoreColor(s.score)}">${s.score}</div></div>`).join("")}
  </div>

  ${technicalSeo ? `
  <h2>Technisches SEO</h2>
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

  ${llmQuestions.length > 0 ? `
  <h2>LLM-Auffindbarkeits-Simulation</h2>
  ${llmQuestions.map((q) => `
  <div class="question">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="q">${q.question}</div>
      <div class="stars">${"*".repeat(q.rating)}${"_".repeat(5 - q.rating)}</div>
    </div>
    ${q.gap ? `<div class="gap">${q.gap}</div>` : ""}
  </div>`).join("")}` : ""}

  ${recommendations.length > 0 ? `
  <h2>Empfehlungen</h2>
  ${recommendations.map((r) => `
  <div class="rec" style="border-color: ${tierColor(r.tier)}">
    <div class="tier" style="color: ${tierColor(r.tier)}">${tierLabel(r.tier)}</div>
    <div class="finding">${r.finding}</div>
    <div class="why">${r.whyItMatters}</div>
    <div class="fix">${r.fixInstruction}</div>
  </div>`).join("")}` : ""}

</div>
</body>
</html>`;
}
