export const SUPPORTED_LOCALES = ["de", "en"] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];

export interface LabelDef {
  group: string;
  de: string;
}

export const labelDefaults: Record<string, LabelDef> = {
  "welcome.eyebrow":           { group: "welcome", de: "KI-Sichtbarkeit & SEO-Analyse" },
  "welcome.headline_pre":      { group: "welcome", de: "Wie gut findet" },
  "welcome.headline_post":     { group: "welcome", de: "Ihre Website?" },
  "welcome.subline":           { group: "welcome", de: "Der GAIO Analyzer untersucht Ihre B2B-Website auf LLM-Auffindbarkeit und klassische SEO-Grundlagen — und zeigt, was geändert werden muss, damit KI-Systeme Ihr Unternehmen empfehlen." },
  "welcome.label_company":     { group: "welcome", de: "Unternehmensname" },
  "welcome.placeholder_company": { group: "welcome", de: "Muster GmbH" },
  "welcome.placeholder_url":   { group: "welcome", de: "z. B. domain.de oder www.domain.de" },
  "welcome.btn_start":         { group: "welcome", de: "Analyse starten →" },
  "welcome.prefill_prefix":    { group: "welcome", de: "Oder" },
  "welcome.prefill_link":      { group: "welcome", de: "mit KI vorausfüllen" },
  "welcome.prefill_suffix":    { group: "welcome", de: "— Zielgruppen & Wettbewerber werden automatisch ermittelt." },
  "welcome.tile1_title":       { group: "welcome", de: "LLM-Sichtbarkeit messen" },
  "welcome.tile1_desc":        { group: "welcome", de: "Wir simulieren, wie ChatGPT, Gemini und Claude Ihre Website wahrnehmen — und wo Informationen fehlen." },
  "welcome.tile2_title":       { group: "welcome", de: "Wettbewerb vergleichen" },
  "welcome.tile2_desc":        { group: "welcome", de: "Sehen Sie sofort, ob Konkurrenten in denselben KI-Antworten auftauchen — und warum." },
  "welcome.tile3_title":       { group: "welcome", de: "Priorisierte Maßnahmen" },
  "welcome.tile3_desc":        { group: "welcome", de: "Kritisch, hoher Hebel, nachgeordnet — klare Empfehlungen direkt aus der Analyse." },
  "welcome.preview_label":     { group: "welcome", de: "Beispiel-Ergebnis" },
  "welcome.preview_grade":     { group: "welcome", de: "Ausbaufähig" },
  "welcome.preview_desc":      { group: "welcome", de: "So sieht ein typisches Ergebnis aus. Technische Grundlagen stimmen oft — aber für KI-Systeme fehlen verwertbare Inhalte, strukturierte Daten und FAQ-Strukturen." },
  "welcome.demo_seo":          { group: "welcome", de: "Techn. SEO" },
  "welcome.demo_schema":       { group: "welcome", de: "Schema.org" },
  "welcome.demo_content":      { group: "welcome", de: "Inhalt" },
  "welcome.demo_llm":          { group: "welcome", de: "LLM" },

  "html.title":               { group: "html", de: "HTML-Analyse" },
  "html.subtitle":            { group: "html", de: "Einzelne HTML-Seite analysieren." },
  "html.info_single_page":    { group: "html", de: "Wenn Sie diesen Weg wählen, wird nur die einzelne Seite analysiert, die Sie hier bereitstellen. Crawler-abhängige Module werden übersprungen." },
  "html.tab_code":            { group: "html", de: "Code einfügen" },
  "html.tab_upload":          { group: "html", de: "Datei hochladen" },
  "html.placeholder_code":    { group: "html", de: "HTML-Code hier einfügen..." },
  "html.drop_title":          { group: "html", de: "Datei hierher ziehen" },
  "html.drop_subtitle":       { group: "html", de: "oder klicken zum Auswählen" },
  "html.btn_replace":         { group: "html", de: "Ersetzen" },
  "html.btn_start":           { group: "html", de: "Analyse starten" },
  "html.error_file_type":     { group: "html", de: "Nur .html und .htm Dateien werden akzeptiert." },
  "html.error_empty":         { group: "html", de: "Bitte HTML-Code einfügen oder eine Datei hochladen." },
  "html.error_start_failed":  { group: "html", de: "Analyse konnte nicht gestartet werden. Bitte erneut versuchen." },

  "nav.domain_analyse": { group: "nav", de: "Domainanalyse – Basisdaten" },
  "nav.html_analyse":   { group: "nav", de: "HTML-Analyse" },
  "nav.ergebnisse":     { group: "nav", de: "Ergebnisse" },
  "nav.faq":            { group: "nav", de: "FAQ / So funktioniert's" },
  "nav.kontakt":        { group: "nav", de: "Kontakt" },
  "nav.einstellungen":  { group: "nav", de: "Einstellungen" },
  "nav.vergleich":      { group: "nav", de: "Vergleich" },
  "nav.login":          { group: "nav", de: "Login" },
  "nav.server":         { group: "nav", de: "Server" },
  "nav.menu_open":      { group: "nav", de: "Menü öffnen" },
};
