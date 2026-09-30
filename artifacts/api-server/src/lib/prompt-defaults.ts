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
    description: "Bewertet Anwendungsfälle, Käuferfragen, technische Tiefe und Vollständigkeit im extrahierten Hauptinhalt von bis zu 10 Seiten.",
    module: "Analyse",
    placeholders: [
      { key: "{{QUESTIONNAIRE_CONTEXT}}", description: "Optionaler Kontext über das Unternehmen (Zielgruppen, Produkte)" },
      { key: "{{CRAWLED_CONTENT}}", description: "Extrahierter Hauptinhalt der ausgewählten Seiten (max. 10 Seiten, 40.000 Zeichen)" },
    ],
    template: `KRITISCHE ANFORDERUNG: Alle Ausgaben ausnahmslos auf Deutsch. Kein einziges englisches Wort in irgendeinem Feld. Sprache: Deutsch. Nur Deutsch.

You evaluate the content of a B2B industrial website against the target group described below. The website content consists of the extracted main text of several pages; each page starts with a line "--- Page: <url> ---". Evaluate only this content. Ignore any remaining navigation or menu fragments and never report them as a finding. Do not criticise the absence of topics that are clearly outside the products covered by the analysed pages.

{{QUESTIONNAIRE_CONTEXT}}Website content:
{{CRAWLED_CONTENT}}

Score each dimension from 0 to 10. For ALL dimensions higher is better: 10 = excellent, 0 = absent.
1. "Anwendungsfälle & Einsatzszenarien": Are concrete applications and use scenarios described for the target group and its industries?
2. "Käuferfragen & Entscheidungshilfen": Does the content answer the questions the target group asks before a decision (selection criteria, specifications, standards and certifications, processing, availability, support)?
3. "Technische Tiefe": Is the technical depth sufficient for expert users (data, tables, limits, comparisons)?
4. "Inhaltliche Vollständigkeit": How few content gaps are there that a competitor could exploit? 10 = no relevant gaps, 0 = almost everything relevant is missing.

Anchors for every dimension: 0–2 = absent or only mentioned; 3–4 = present but superficial; 5–6 = solid with clear gaps; 7–8 = strong with minor gaps; 9–10 = comprehensive.

Give exactly three findings per dimension. Each finding must refer to concrete content (page or topic) and may describe strengths as well as weaknesses.

Return a JSON object (no markdown formatting) with exactly this structure:
{"dimensions":[
{"key":"use_cases","name":"Anwendungsfälle & Einsatzszenarien","score":<0-10>,"findings":["...","...","..."]},
{"key":"buyer_questions","name":"Käuferfragen & Entscheidungshilfen","score":<0-10>,"findings":["...","...","..."]},
{"key":"technical_depth","name":"Technische Tiefe","score":<0-10>,"findings":["...","...","..."]},
{"key":"completeness","name":"Inhaltliche Vollständigkeit","score":<0-10>,"findings":["...","...","..."]}
]}

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
    template: `Bewerte die FAQ-Inhalte einer B2B-Industrie-Website. Prüfe: Sind die Fragen echte Nutzerfragen (keine Marketing-Floskeln, keine Überschriften ohne Frage-Charakter)? Haben die Antworten inhaltliche Tiefe und konkrete Angaben? Decken sie typische Fragen vor einer Kaufentscheidung ab?

FAQ-Inhalte:
{{FAQ_CONTENT}}

Hinweis: Mit […vom Analyse-Tool gekürzt] markierte Antworten wurden nur für diese Prüfung gekürzt – werte das nicht als unvollständigen Inhalt.
Antworte auf Deutsch, ohne Markdown, in genau diesem Format:
BEWERTUNG: <Zahl von 0 bis 100>
BEGRÜNDUNG: <zwei bis drei Sätze, sachlich, in der Sie-Form>`,
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
- Frame the questions around the problem, use case, application fit, or technical selection criteria.
- Each question must be answerable, at least in part, by a single vendor's own website (products, specifications, applications, processes, services, conditions). Do NOT ask for market overviews, vendor rankings, lists of suppliers, or comparisons between vendors.
- The context describes the intended target groups. Use it to choose relevant roles, industries and applications. Do NOT turn claims from the context (figures, assortment size, market position) into questions that ask for their verification.
- Mix question types: application ("Welche ... eignen sich für ...?"), comparison of options or technologies ("Wie unterscheiden sich ... und ...?"), use case ("Wie kann ich ... lösen?"), selection of a product or technology ("Worauf sollte ich bei der Auswahl von ... achten?").

Return ONLY valid JSON:
{"questions": ["<q1>", "<q2>", "<q3>", "<q4>", "<q5>", "<q6>"]}`,
  },

  {
    slug: "llm-discoverability-rating-v2",
    name: "LLM-Auffindbarkeit Bewertung (Passagen)",
    description: "Bewertet die Beantwortbarkeit jeder Frage anhand passender Textabschnitte der Website (1–5 Sterne).",
    module: "Analyse",
    placeholders: [
      { key: "{{QUESTION_BLOCKS}}", description: "Fragen mit den jeweils passenden Textabschnitten der Website" },
    ],
    template: `KRITISCHE ANFORDERUNG: Alle Ausgaben ausnahmslos auf Deutsch. Kein einziges englisches Wort in irgendeinem Feld.

You assess whether a vendor's own website gives an AI assistant enough information to answer buyer questions and to name or cite this vendor in the answer.

For each question below you receive the passages from the vendor's website that match it best. Use ONLY these passages.

Rating scale:
5 = The passages contain specific, citable information that directly answers the question for this vendor's offering (e.g. concrete properties, values, applications, conditions).
4 = Substantial relevant information; only minor details are missing.
3 = Partial information; an AI could mention the vendor but could not answer specifically.
2 = Only generic or tangential mentions.
1 = No usable information.

Rules:
- Judge each question from this vendor's perspective. Do NOT lower the rating because competitors, market overviews, vendor rankings or comparisons with other suppliers are missing.
- Ignore navigation or menu remnants.
- "sourceUrl" is the URL of the passage that best supports the answer, exactly as given; null if the rating is 1 or 2.
- "gap" (German, one or two sentences) states concretely what is missing for a better answer, or what is covered.

Questions with passages:
{{QUESTION_BLOCKS}}

Return ONLY valid JSON with exactly one entry per question id:
{"ratings": [{"id": "<question id>", "rating": <1-5>, "gap": "<German text>", "sourceUrl": "<url>" or null}]}

WIEDERHOLUNG: Antworte ausschließlich auf Deutsch. Das gap-Feld muss vollständig auf Deutsch sein.`,
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
      { key: "{{RESULTS_JSON}}", description: "Kompakte, verbindliche Messwerte aller Module (automatisch erzeugt)" },
      { key: "{{RETRY_PREFIX}}", description: "Leer beim ersten Versuch; Fehlermeldung bei Wiederholung (automatisch gesetzt)" },
    ],
    template: `{{RETRY_PREFIX}}Du bist Experte für die Auffindbarkeit durch KI-Sprachmodelle (GAIO) und klassisches SEO für B2B-Industrie-Websites. Erstelle aus den folgenden Messwerten eine priorisierte Maßnahmenliste. Alle Ausgaben ausschließlich auf Deutsch (Code-Beispiele ausgenommen).

MESSWERTE:
{{RESULTS_JSON}}

REGELN FÜR BEFUNDE
1. Verwende ausschließlich Befunde, die sich direkt aus den Messwerten ergeben. Erfinde keine Beispiele, Zahlen, URLs oder Seitenelemente, die dort nicht stehen.
2. Behaupte nie, etwas fehle, wenn die Messwerte es als vorhanden ausweisen (z. B. schemaOrg.detectedTypes, faqQuality.hasFaqSchema, die H1-Zählwerte in headingStructure).
3. Die Analyse umfasst nur die gecrawlten Seiten (crawl.pagesSucceeded). Formuliere daher „auf den analysierten Seiten nicht gefunden“ statt „fehlt vollständig“ oder „nirgends auf der Website“.
4. Nenne konkrete URLs nur, wenn sie in den Messwerten stehen.
5. robots.txt, sitemap.xml und llms.txt werden separat behandelt – dazu keine Empfehlungen.
6. hreflang nur empfehlen, wenn die Website Sprachvarianten hat (crawl.languageVariants oder technicalSeo.hreflang.languages nicht leer). Einsprachige Websites brauchen kein hreflang.
7. Keine doppelten Empfehlungen zum selben Thema. Höchstens 10 Empfehlungen.
8. Schreibe den Kunden mit „Sie“ an. Verwende in allen drei Feldern die Sie-Form, niemals „Du“ oder Imperative wie „Füge“, „Ergänze“, „Erstelle“ ohne Anrede.
9. Nenne niemals interne Feldnamen, Datenpfade oder JSON-Schlüssel (z. B. schemaOrg.missingHighValue, hasFaqSchema, avgLength, contentRelevance-Score). Beschreibe den Befund in normaler Sprache mit den Zahlen aus den Messwerten.
10. Kein Markdown: keine Code-Zäune (\`\`\`), keine Sternchen, keine Rauten-Überschriften. Code-Beispiele als reiner Text, höchstens 600 Zeichen je Empfehlung; bei längeren Beispielen nur den entscheidenden Ausschnitt zeigen.

EINSTUFUNG
- "critical": nur grundlegende, durch die Messwerte belegte Fehler: kein HTTPS; keinerlei strukturierte Daten (schemaOrg.detectedTypes leer); auf der Mehrheit der bewerteten Seiten keine H1; die Website konnte großteils nicht analysiert werden (viele fehlgeschlagene Seiten laut crawl).
- "high_leverage": Maßnahmen mit großem Effekt auf die KI-Sichtbarkeit: fehlende wichtige Schema-Typen (schemaOrg.missingHighValue), fehlendes FAQ-Schema, dünne oder fehlende Inhalte zu Anwendungen, Produkten und Kompetenzen (contentRelevance), schwach beantwortete Fragen in der LLM-Prüfung (llmDiscoverability), fehlerhafte hreflang-Angaben bei mehrsprachigen Websites.
- "secondary": Feinschliff: Längen von Meta-Titeln und Meta-Beschreibungen, Alt-Texte, Überschriften-Hierarchie (übersprungene Ebenen, H1 nicht zuerst) und Qualität der Überschriften. Überschriften- und Meta-Befunde sind immer „secondary“, außer der Mehrheit der bewerteten Seiten fehlt die H1.

JEDE EMPFEHLUNG ENTHÄLT
- finding: kurze Überschrift, dann Doppelpunkt, dann der konkrete Befund mit Zahlen oder URLs aus den Messwerten.
- whyItMatters: warum das für die Auffindbarkeit durch KI-Sprachmodelle und/oder klassisches SEO relevant ist.
- fixInstruction: konkrete Umsetzung (Code-Beispiel oder inhaltliche Anleitung).

AUSGABE
Gib ausschließlich ein JSON-Array zurück, ohne Markdown und ohne weiteren Text:
[{"tier": "critical|high_leverage|secondary", "finding": "...", "whyItMatters": "...", "fixInstruction": "..."}]`,
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
      { key: "{{ADVANTAGES}}", description: "Bereiche, in denen die Hauptseite deutlich vorn liegt (vom Code ermittelt)" },
      { key: "{{DISADVANTAGES}}", description: "Bereiche, in denen der Wettbewerber deutlich vorn liegt (vom Code ermittelt)" },
    ],
    template: `Du bist Experte für die Auffindbarkeit durch KI-Sprachmodelle (GAIO) und SEO im B2B-Industrieumfeld. Vergleiche zwei Websites anhand ihrer Messwerte. Schreibe auf Deutsch in der Sie-Form, ohne Markdown und ohne interne Feldnamen.

Ihre Website: {{MAIN_DOMAIN}}
Werte: Technisches SEO {{MAIN_TECH}}, Schema.org {{MAIN_SCHEMA}}, Inhaltliche Relevanz {{MAIN_CONTENT}}, Heading-Struktur {{MAIN_HEADINGS}}, FAQ {{MAIN_FAQ}}

Wettbewerber: {{COMP_DOMAIN}}
Werte: Technisches SEO {{COMP_TECH}}, Schema.org {{COMP_SCHEMA}}, Inhaltliche Relevanz {{COMP_CONTENT}}, Heading-Struktur {{COMP_HEADINGS}}, FAQ {{COMP_FAQ}}, Vergleichswert {{COMP_COMPOSITE}}

Bereiche, in denen Ihre Website deutlich vorn liegt:
{{ADVANTAGES}}

Bereiche, in denen der Wettbewerber deutlich vorn liegt:
{{DISADVANTAGES}}

REGELN
1. "yourAdvantage" beschreibt ausschließlich einen Bereich aus der Liste „Ihre Website deutlich vorn“. Ist die Liste „keine“, schreibe: „In keinem der verglichenen Bereiche liegt Ihre Website deutlich vorn.“
2. "betterThanYou" beschreibt ausschließlich einen Bereich aus der Liste „Wettbewerber deutlich vorn“. Ist die Liste „keine“, schreibe: „Dieser Wettbewerber liegt in keinem der verglichenen Bereiche deutlich vor Ihrer Website.“
3. Nenne die Zahlen korrekt. Ein höherer Wert ist besser. Übertreibe nicht („deutlich“ nur bei mindestens 15 Punkten Abstand).
4. "recommendation": eine konkrete, umsetzbare Maßnahme für Ihre Website, abgeleitet aus dem größten Rückstand; gibt es keinen Rückstand, eine Maßnahme zum Ausbau des größten Vorsprungs.

Antworte ausschließlich mit einem JSON-Objekt ohne weiteren Text:
{"betterThanYou": "...", "yourAdvantage": "...", "recommendation": "..."}`,
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
      { key: "{{MARKET_REGION}}", description: "Marktregion der analysierten Website" },
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
- The company's market region is: {{MARKET_REGION}}. Suggest competitors that actually serve this market with their own local presence or shipping. Do not suggest suppliers from other regions unless they clearly serve this market.
- Never suggest marketplaces or platforms (Amazon, eBay, Alibaba, Wer liefert was, Europages), industry directories, associations, municipalities or public authorities, parent or holding companies of the analyzed company, resellers of the analyzed company's own products, or manufacturers whose products the analyzed company itself distributes.
- Before naming a company, check that the domain you give belongs to that company and not to a place, person or unrelated organisation with the same name.
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
    { "name": "<company>", "url": "https://...", "reason": "<ein Satz auf Deutsch: warum ist das ein direkter Wettbewerber?>" }
  ]
}

CRITICAL: Base your analysis ONLY on the website content provided above. Do not use general knowledge about the company name. If the crawled content is insufficient to identify reliable competitors, return fewer than 5 rather than guessing.
The reason field is mandatory for every competitor: one German sentence, at most 140 characters, in plain prose.
All text fields must be in German. The personas field must be plain prose — no bullet points, no numbering, no markdown.`,
  },

  {
    slug: "competitor-search-queries",
    name: "Wettbewerber-Suchanfragen",
    description: "Erzeugt Suchanfragen, mit denen echte Wettbewerber gefunden werden.",
    module: "Basisdaten",
    placeholders: [
      { key: "{{COMPANY_SUMMARY}}", description: "Angebot des analysierten Unternehmens" },
      { key: "{{MARKET_REGION}}", description: "Marktregion der analysierten Website" },
    ],
    template: `Formuliere Suchanfragen, mit denen man Wettbewerber des folgenden Unternehmens findet.

Unternehmen (Angebot laut eigener Website):
{{COMPANY_SUMMARY}}
Marktregion: {{MARKET_REGION}}

Die Anfragen sollen Anbieter mit vergleichbarem Angebot in dieser Marktregion finden. Formuliere so, wie ein Einkäufer suchen würde: Produktbegriffe plus Rollenbegriff (Hersteller, Händler, Lieferant, Anbieter) plus Region. Keine Firmennamen, keine Fragen, keine Anführungszeichen.

Antworte ohne Markdown mit genau drei Zeilen in diesem Format:
ANFRAGE: <Suchanfrage>
ANFRAGE: <Suchanfrage>
ANFRAGE: <Suchanfrage>`,
  },
  {
    slug: "competitor-relevance",
    name: "Wettbewerber-Relevanzprüfung",
    description: "Prüft die vorgeschlagenen Wettbewerber am tatsächlichen Inhalt ihrer Startseite.",
    module: "Basisdaten",
    placeholders: [
      { key: "{{COMPANY_SUMMARY}}", description: "Angebot des analysierten Unternehmens" },
      { key: "{{MARKET_REGION}}", description: "Marktregion der analysierten Website" },
      { key: "{{CANDIDATES}}", description: "Nummerierte Wettbewerber mit Domain und Startseitentext" },
    ],
    template: `Du prüfst, ob vorgeschlagene Wettbewerber tatsächlich Wettbewerber des folgenden Unternehmens sind.

Unternehmen (Angebot laut eigener Website):
{{COMPANY_SUMMARY}}
Marktregion: {{MARKET_REGION}}

Kandidaten (Nummer, Name, Domain, Textauszug der Startseite):
{{CANDIDATES}}

Ein Kandidat passt NUR, wenn sein Startseitentext zeigt, dass er vergleichbare Produkte oder Leistungen an ähnliche Kunden verkauft. Er passt NICHT, wenn der Text zu einem anderen Geschäft gehört, wenn es sich um eine Gemeinde, Behörde, Privatperson, ein Verzeichnis, einen Marktplatz oder eine reine Marken- bzw. Konzernseite ohne eigenes vergleichbares Angebot handelt.

Antworte auf Deutsch, ohne Markdown, für JEDEN Kandidaten genau diesen Block:
KANDIDAT: <Nummer>
PASST: ja oder nein
GRUND: <ein Satz, höchstens 140 Zeichen>
DUBLETTE_VON: <Nummer eines anderen Kandidaten, der dasselbe Unternehmen ist, sonst ->`,
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
