export interface PromptDefault {
  slug: string;
  name: string;
  description: string;
  module: string;
  template: string;
  placeholders: Array<{ key: string; description: string }>;
}

export const PROMPT_DEFAULTS: PromptDefault[] = [
  {
    slug: "content-relevance",
    name: "Inhaltliche Relevanz",
    description: "Analysiert Use Cases, Käuferfragen, technische Tiefe und inhaltliche Lücken der gecrawlten Seiten.",
    module: "Analyse",
    placeholders: [
      { key: "{{QUESTIONNAIRE_CONTEXT}}", description: "Optionaler Kontext über das Unternehmen (Zielgruppen, Produkte)" },
      { key: "{{CRAWLED_CONTENT}}", description: "Gecrawlter Seitentext (max. 12.000 Zeichen)" },
    ],
    template: `KRITISCHE ANFORDERUNG: Alle Ausgaben ausnahmslos auf Deutsch. Kein einziges englisches Wort in irgendeinem Feld. Sprache: Deutsch. Nur Deutsch.

Given this B2B industrial website content, evaluate:
(1) Does it describe specific use cases and application scenarios?
(2) Does it answer likely buyer questions (ROI, specs, integrations, certifications, support)?
(3) Is technical depth sufficient for expert-level users?
(4) Are there content gaps a competitor could exploit?

{{QUESTIONNAIRE_CONTEXT}}Website content:
{{CRAWLED_CONTENT}}

Return a JSON object (no markdown formatting) with this structure:
{
  "dimensions": [
    {"name": "Use Cases & Applications", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]},
    {"name": "Buyer Questions", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]},
    {"name": "Technical Depth", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]},
    {"name": "Content Gaps", "score": <0-10>, "findings": ["finding1", "finding2", "finding3"]}
  ]
}

WIEDERHOLUNG: Antworte ausschließlich auf Deutsch. Alle findings-Texte müssen vollständig auf Deutsch sein. Englische Ausgaben sind nicht akzeptabel.`,
  },

  {
    slug: "faq-quality",
    name: "FAQ-Qualität",
    description: "Bewertet Anzahl, Qualität und Struktur der FAQ-Inhalte.",
    module: "Analyse",
    placeholders: [
      { key: "{{FAQ_CONTENT}}", description: "Extrahierter FAQ-Text der Website" },
    ],
    template: `Evaluate this FAQ content from a B2B industrial website. Are the questions framed as real user questions? Do answers have sufficient depth? Give a 2-3 sentence assessment.

{{FAQ_CONTENT}}`,
  },

  {
    slug: "llm-discoverability-a",
    name: "LLM-Auffindbarkeit Teil A",
    description: "Problem-/Kategoriefragen ohne Markennamen (70% Gewichtung). Simuliert einen B2B-Käufer in der frühen Recherchephase.",
    module: "Analyse",
    placeholders: [
      { key: "{{QUESTIONNAIRE_CONTEXT}}", description: "Optionaler Kontext über Branche und Produkte" },
      { key: "{{COMBINED_CONTENT}}", description: "Zusammengefasster Webseitentext (max. 4.000 Zeichen)" },
    ],
    template: `You are simulating a B2B buyer in early research mode who does NOT yet know any specific vendor.
Based on the website content below, infer the product category, industry, and key use cases.

{{QUESTIONNAIRE_CONTEXT}}
Website content sample:
{{COMBINED_CONTENT}}

Generate exactly 6 realistic German-language questions a buyer would ask an AI assistant when researching this category.
Hard rules:
- Do NOT mention any specific company name, brand, or domain.
- Frame the questions around the problem, use case, comparison criteria, or selection guidance.
- Mix question types: capability ("Welche Anbieter bieten ...?"), comparison ("Wie unterscheiden sich ...?"), use-case ("Wie kann ich ... lösen?"), selection ("Worauf sollte ich bei ... achten?").

Return ONLY valid JSON:
{"questions": ["<q1>", "<q2>", "<q3>", "<q4>", "<q5>", "<q6>"]}`,
  },

  {
    slug: "llm-discoverability-b",
    name: "LLM-Auffindbarkeit Teil B",
    description: "Marken-Verifikationsfragen mit Firmennamen (30% Gewichtung). Simuliert einen Käufer, der das Unternehmen bereits kennt.",
    module: "Analyse",
    placeholders: [
      { key: "{{COMPANY_NAME}}", description: "Unternehmensname" },
      { key: "{{DOMAIN}}", description: "Domain der Website" },
      { key: "{{COMBINED_CONTENT}}", description: "Zusammengefasster Webseitentext (max. 4.000 Zeichen)" },
    ],
    template: `You are simulating a B2B buyer who already knows the company "{{COMPANY_NAME}}" (domain: {{DOMAIN}})
and wants to verify specific information before contacting them.

Website content sample:
{{COMBINED_CONTENT}}

Generate exactly 4 realistic German-language questions that explicitly mention "{{COMPANY_NAME}}".
Mix categories like: certifications, product specs, delivery times, support, comparisons, use-case fit.

Examples of the right framing:
- "Welche Zertifizierungen hat {{COMPANY_NAME}} für [specific industry]?"
- "Welche Lieferzeiten bietet {{COMPANY_NAME}} für [product]?"

Return ONLY valid JSON:
{"questions": ["<q1>", "<q2>", "<q3>", "<q4>"]}`,
  },

  {
    slug: "llm-discoverability-rating",
    name: "LLM-Auffindbarkeit Bewertung",
    description: "Bewertet die Beantwortbarkeit jeder Frage anhand der gecrawlten Seiten (1–5 Sterne) und identifiziert die beste Quellseite.",
    module: "Analyse",
    placeholders: [
      { key: "{{PAGES_DOC}}", description: "Gecrawlte Seiten als nummeriertes Dokument" },
      { key: "{{URL_LIST}}", description: "JSON-Array aller verfügbaren URLs" },
      { key: "{{QUESTIONS}}", description: "JSON-Array der zu bewertenden Fragen" },
    ],
    template: `KRITISCHE ANFORDERUNG: Alle Ausgaben ausnahmslos auf Deutsch. Kein einziges englisches Wort in irgendeinem Feld. Sprache: Deutsch. Nur Deutsch.

Using ONLY the crawled website pages below as your knowledge source,
rate how completely you could answer each question (1=cannot answer at all, 5=fully and specifically answerable).

For each question, also identify the SINGLE best-matching page URL that supports the answer.
If no page covers the question adequately (rating 1 or 2), set "sourceUrl" to null.
The sourceUrl MUST be one of the exact URLs listed in the pages, or null.

Crawled pages:
{{PAGES_DOC}}

Available URLs (must pick exactly one of these or null):
{{URL_LIST}}

Questions to rate:
{{QUESTIONS}}

Return ONLY valid JSON:
{"ratings": [
  {"question": "<q>", "rating": <1-5>, "gap": "<kurze deutsche Erklärung was fehlt oder warum die Bewertung so ist>", "sourceUrl": <"url" or null>}
]}

WIEDERHOLUNG: Antworte ausschließlich auf Deutsch. Das gap-Feld muss vollständig auf Deutsch sein. Englische Ausgaben sind nicht akzeptabel.`,
  },

  {
    slug: "recommendations",
    name: "Empfehlungen generieren",
    description: "Erstellt priorisierte Handlungsempfehlungen in drei Stufen: Kritisch, Hoher Hebel, Nachgeordnet.",
    module: "Analyse",
    placeholders: [
      { key: "{{RESULTS_JSON}}", description: "JSON der Analyseergebnisse aller Module" },
      { key: "{{RETRY_PREFIX}}", description: "Leer beim ersten Versuch; Fehlermeldung bei Wiederholung (automatisch gesetzt)" },
    ],
    template: `KRITISCHE ANFORDERUNG: Alle Ausgaben ausnahmslos auf Deutsch. Kein einziges englisches Wort in irgendeinem Feld. Sprache: Deutsch. Nur Deutsch.

{{RETRY_PREFIX}}Based on these website analysis findings, generate a prioritized action list grouped into three tiers:

- "critical": must be fixed immediately (broken fundamentals: missing canonical, no HTTPS, 0 structured data, H1 absent)
- "high_leverage": changes likely to produce major visibility gains (missing FAQPage schema, thin content, no use-case descriptions, hreflang errors, missing Organization schema)
- "secondary": improvements for after critical + high-leverage are resolved (meta description length, image alt gaps, heading hierarchy inconsistencies)

Each recommendation must include:
- What exactly is wrong (specific page/element if possible)
- Why it matters for LLM discoverability and/or classic SEO
- Concrete fix instruction (code snippet or content guidance)

Note: robots.txt, sitemap.xml, and llms.txt recommendations are already handled separately — focus on content quality, structured data, and on-page SEO issues.

Analysis findings:
{{RESULTS_JSON}}

Return a JSON array (no markdown) of objects:
[{"tier": "critical|high_leverage|secondary", "finding": "...", "whyItMatters": "...", "fixInstruction": "..."}]

WIEDERHOLUNG: Antworte ausschließlich auf Deutsch. Alle Felder — title, finding, why_it_matters, fix — müssen vollständig auf Deutsch sein. Englische Ausgaben sind nicht akzeptabel.`,
  },

  {
    slug: "competitor-analysis",
    name: "Wettbewerbsanalyse",
    description: "Analysiert Stärken und Schwächen der Wettbewerber-Websites im Vergleich zur Hauptseite.",
    module: "Analyse",
    placeholders: [
      { key: "{{MAIN_DOMAIN}}", description: "Domain der Hauptseite" },
      { key: "{{MAIN_TECH}}", description: "Technisches SEO Score der Hauptseite" },
      { key: "{{MAIN_SCHEMA}}", description: "Schema.org Score der Hauptseite" },
      { key: "{{MAIN_CONTENT}}", description: "Content Score der Hauptseite" },
      { key: "{{MAIN_HEADINGS}}", description: "Heading Score der Hauptseite" },
      { key: "{{MAIN_FAQ}}", description: "FAQ Score der Hauptseite" },
      { key: "{{COMP_DOMAIN}}", description: "Domain des Wettbewerbers" },
      { key: "{{COMP_TECH}}", description: "Technisches SEO Score des Wettbewerbers" },
      { key: "{{COMP_SCHEMA}}", description: "Schema.org Score des Wettbewerbers" },
      { key: "{{COMP_CONTENT}}", description: "Content Score des Wettbewerbers" },
      { key: "{{COMP_HEADINGS}}", description: "Heading Score des Wettbewerbers" },
      { key: "{{COMP_FAQ}}", description: "FAQ Score des Wettbewerbers" },
      { key: "{{COMP_COMPOSITE}}", description: "Gesamt-Score des Wettbewerbers" },
    ],
    template: `KRITISCHE ANFORDERUNG: Alle Ausgaben ausnahmslos auf Deutsch. Kein einziges englisches Wort in irgendeinem Feld. Sprache: Deutsch. Nur Deutsch.

You are an SEO and LLM-discoverability expert. Compare two B2B industrial websites based on their analysis scores.

Main site: {{MAIN_DOMAIN}}
Scores: Technical SEO={{MAIN_TECH}}, Schema.org={{MAIN_SCHEMA}}, Content={{MAIN_CONTENT}}, Headings={{MAIN_HEADINGS}}, FAQ={{MAIN_FAQ}}

Competitor: {{COMP_DOMAIN}}
Scores: Technical SEO={{COMP_TECH}}, Schema.org={{COMP_SCHEMA}}, Content={{COMP_CONTENT}}, Headings={{COMP_HEADINGS}}, FAQ={{COMP_FAQ}}, Composite={{COMP_COMPOSITE}}

Respond with a JSON object (no markdown) with exactly these three fields:
- "betterThanYou": One concrete thing this competitor does better (auf Deutsch, 1-2 Sätze)
- "yourAdvantage": One area where the main site clearly outperforms this competitor (auf Deutsch, 1-2 Sätze)
- "recommendation": One specific, actionable improvement the main site should make based on this comparison (auf Deutsch, 1-2 Sätze)

WIEDERHOLUNG: Antworte ausschließlich auf Deutsch. Alle drei Felder müssen vollständig auf Deutsch sein. Englische Ausgaben sind nicht akzeptabel.`,
  },

  {
    slug: "prefill-analysis",
    name: "KI-Vorausfüllung (Basisdaten)",
    description: "Ermittelt automatisch Zielgruppen, Wettbewerber und Produkt-Summary aus der gecrawlten Website.",
    module: "Basisdaten",
    placeholders: [
      { key: "{{CRAWLED_CONTENT}}", description: "Gecrawlter Webseitentext" },
      { key: "{{COMPANY_NAME}}", description: "Unternehmensname" },
      { key: "{{WEBSITE_URL}}", description: "Website-URL" },
    ],
    template: `You are a B2B market analyst.

A company has submitted its website for analysis. I have crawled the following pages from their website and extracted the text content:

{{CRAWLED_CONTENT}}

Company name: {{COMPANY_NAME}}
Website: {{WEBSITE_URL}}

Based EXCLUSIVELY on the actual website content above (not on general assumptions), perform the following analysis:

TASK 1 — TARGET AUDIENCES
Identify the primary B2B buyer personas for this company based on the products, services and use cases described on the website. Include:
- Which industries are explicitly or implicitly addressed?
- Which job titles or roles are likely decision makers or users?
- What buying criteria or problems does the company solve?
Write 3-5 concise sentences in German. Be specific to what you actually read on the website — no generic B2B personas.

TASK 2 — COMPETITORS
Based on the specific products and services you found on this website, identify 5-8 direct competitors — companies that sell similar or identical products to the same target industries.

Rules for competitor selection:
- Must be direct product competitors, not adjacent or complementary companies
- Must be real companies with real websites you are confident exist
- Prefer companies of similar size and market focus where possible
- Do NOT list distributors, partners or customers of the analyzed company
- If you are uncertain about a URL, omit that competitor rather than guessing

Return ONLY valid JSON, no other text:
{
  "content_summary": "<2-3 sentences in German summarizing what products/services the company actually offers, based on the crawled pages>",
  "personas": "<German prose text, 3-5 sentences>",
  "competitors": [
    { "name": "<company>", "url": "https://..." }
  ]
}

CRITICAL: Base your analysis ONLY on the website content provided above. Do not use general knowledge about the company name. If the crawled content is insufficient to identify reliable competitors, return fewer than 5 rather than guessing.
All text fields must be in German. The personas field must be plain prose — no bullet points, no numbering, no markdown.`,
  },

  {
    slug: "angebot-creator",
    name: "Angebots-Creator",
    description: "Generiert ein strukturiertes KI-Optimierungsangebot auf Basis der Analyseergebnisse.",
    module: "Angebot",
    placeholders: [
      { key: "{{COMPANY_NAME}}", description: "Unternehmensname" },
      { key: "{{DOMAIN}}", description: "Domain der analysierten Website" },
      { key: "{{EXPORT_DATE}}", description: "Datum der Analyse" },
      { key: "{{GAIO_SCORE}}", description: "GAIO-Gesamtscore" },
      { key: "{{TECH_SEO}}", description: "Technisches SEO Score" },
      { key: "{{SCHEMA_ORG}}", description: "Schema.org Score" },
      { key: "{{HEADINGS}}", description: "Heading-Struktur Score" },
      { key: "{{CONTENT}}", description: "Inhaltliche Relevanz Score" },
      { key: "{{FAQ_SCORE}}", description: "FAQ-Qualität Score" },
      { key: "{{LLM}}", description: "LLM-Auffindbarkeit Score" },
      { key: "{{MASSNAHMEN_KRITISCH}}", description: "Kritische Maßnahmen (automatisch befüllt)" },
      { key: "{{MASSNAHMEN_HOHER_HEBEL}}", description: "Maßnahmen mit hohem Hebel (automatisch befüllt)" },
      { key: "{{MASSNAHMEN_NACHGEORDNET}}", description: "Nachgeordnete Maßnahmen (automatisch befüllt)" },
    ],
    template: `Du bist ein erfahrener SEO- und KI-Optimierungsberater einer deutschen Agentur. Erstelle ein vollständiges, professionelles Angebot zur KI- und SEO-Optimierung.

KUNDENDATEN:
Unternehmen: {{COMPANY_NAME}}
Domain: {{DOMAIN}}
Analysedatum: {{EXPORT_DATE}}

ANALYSEERGEBNISSE:
GAIO Gesamtscore: {{GAIO_SCORE}}/100
Technisches SEO: {{TECH_SEO}}/100
Schema.org: {{SCHEMA_ORG}}/100
Heading-Struktur: {{HEADINGS}}/100
Inhaltliche Relevanz: {{CONTENT}}/100
FAQ-Qualität: {{FAQ_SCORE}}/100
LLM-Auffindbarkeit: {{LLM}}/100

IDENTIFIZIERTE MASSNAHMEN:

KRITISCH:
{{MASSNAHMEN_KRITISCH}}

HOHER HEBEL:
{{MASSNAHMEN_HOHER_HEBEL}}

NACHGEORDNET:
{{MASSNAHMEN_NACHGEORDNET}}

PFLICHTSTRUKTUR — halte dich exakt an diese Reihenfolge und lass keinen Abschnitt aus:

ABSCHNITT 1: <h2>1. Ausgangslage und Bewertung</h2>
- Einleitungsabsatz (2–3 Sätze) mit Gesamteinschätzung
- Score-Liste als <ul> mit allen 7 Werten inkl. kurzer Einordnung je Score
- Abschlussfazit (2–3 Sätze) mit realistischer Score-Prognose nach Umsetzung
- Abschließen mit: <hr><br>

ABSCHNITT 2: <h2>2. Leistungsübersicht</h2>
Einleitungssatz zur Struktur, dann:

<h3>Stufe 1 — Kritische Maßnahmen</h3>
- Einen einleitenden Satz
- Jede Maßnahme als <li> mit <strong>Titel</strong>, Kurzbeschreibung und kursivem Aufwand
  Beispiel: <strong>Titel:</strong> Beschreibung. <em>Aufwand: X Stunden</em>
- PFLICHT am Ende der Stufe 1:
  <p><strong>Gesamtaufwand Stufe 1: ca. X Stunden</strong></p>

<h3>Stufe 2 — Hoher Hebel</h3>
- Einen einleitenden Satz
- Gleiche Liststruktur wie Stufe 1
- PFLICHT am Ende der Stufe 2:
  <p><strong>Gesamtaufwand Stufe 2: ca. X Stunden</strong></p>

<h3>Stufe 3 — Nachgeordnete Maßnahmen</h3>
- Einen einleitenden Satz
- Gleiche Liststruktur
- PFLICHT am Ende der Stufe 3:
  <p><strong>Gesamtaufwand Stufe 3: ca. X Stunden</strong></p>
- Dann direkt darunter:
  <p><strong>Gesamtaufwand aller Stufen: ca. X Stunden</strong></p>
- Abschließen mit: <hr><br>

ABSCHNITT 3: <h2>3. Leistungspakete</h2>
Einen einleitenden Satz, dann drei Pakete:

<h3>[ ] Paket S — [kurzer Name]</h3>
- <strong>Zielgruppe:</strong> 1 Satz
- <strong>Gesamtaufwand:</strong> ca. X Stunden
- <ul> mit enthaltenen Leistungen (Stufe 1)
- <strong>Erwarteter Effekt:</strong> 1–2 Sätze
- Abschließen mit: <hr><br>

<h3>[ ] Paket M — [kurzer Name]</h3>
- <strong>Zielgruppe:</strong> 1 Satz
- <strong>Gesamtaufwand:</strong> ca. X Stunden (inklusive Paket S)
- <ul> mit enthaltenen Leistungen (Stufen 1+2)
- <strong>Erwarteter Effekt:</strong> 2–3 Sätze inkl. realistischer Score-Prognose
- Abschließen mit: <hr><br>

<h3>[ ] Paket L — [kurzer Name]</h3>
- <strong>Zielgruppe:</strong> 1 Satz
- <strong>Gesamtaufwand:</strong> ca. X Stunden (inklusive Pakete S und M)
- <ul> mit enthaltenen Leistungen (Stufen 1+2+3) plus Qualitätssicherung und Abschluss-Audit
- <strong>Erwarteter Effekt:</strong> 2–3 Sätze inkl. maximaler Score-Prognose
- Abschließen mit: <hr><br>

ABSCHNITT 4: <h2>4. Unser Leistungsumfang</h2>
- Einleitungssatz
- <ul> mit 6–8 Bulletpoints zu Kompetenzen (CMS-Umsetzung, JSON-LD, redaktionelle Texte, llms.txt, Qualitätssicherung, GAIO-Folgeaudit etc.)
- Abschlussparagraph mit Qualitätssicherungshinweis

ABSCHNITT 5: <h2>5. Nächste Schritte</h2>
- 2–3 Sätze zur Beauftragung
- Kontaktzeile:
  <p><strong>Ansprechpartner:</strong> Silvio Haase · CMO &amp; Head of Business Development<br>
  <strong>E-Mail:</strong> Silvio.Haase@IndustryStock.com<br>
  <strong>Unternehmen:</strong> Deutscher Medien Verlag GmbH / IndustryStock.com</p>
- Gültigkeitshinweis (30 Tage)

---

ABSOLUTE REGELN — diese gelten ohne Ausnahme:

1. Schreibe ALLE 5 Abschnitte vollständig zu Ende. Brich unter keinen Umständen ab.
2. Jede Stufe MUSS mit einer Gesamtaufwand-Zeile enden. Ohne Ausnahme.
3. Alle Pakete müssen vollständig ausformuliert sein.
4. Verwende NUR diese HTML-Tags: <h1> <h2> <h3> <p> <strong> <em> <ul> <li> <hr> <br>
5. Keine Tabellen, keine Divs, keine Style-Attribute.
6. Beginne direkt mit <h1>. Keine Präambel.
7. Keine Markdown-Fences.
8. Alle Sonderzeichen als HTML-Entities.
9. Nach jedem <hr> ein <br> einfügen.
10. Ausschließlich Deutsch. Kein einziges englisches Wort.
11. Das Angebot endet mit Abschnitt 5. Der letzte Satz muss ein vollständiger Satz sein.`,
  },
];

export const PROMPT_DEFAULTS_MAP = new Map<string, PromptDefault>(
  PROMPT_DEFAULTS.map((p) => [p.slug, p]),
);
