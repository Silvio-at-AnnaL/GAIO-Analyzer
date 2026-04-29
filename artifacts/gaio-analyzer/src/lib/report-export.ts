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

  const myScore  = (report.overallScore as number) ?? 0;
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
        <td colspan="5" style="color:${C.textMuted};font-size:11px;text-align:center">—</td>
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
