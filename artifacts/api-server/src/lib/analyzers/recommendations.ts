import { anthropic } from "@workspace/integrations-anthropic-ai";
import { getPrompt, fillTemplate } from "../prompt-manager.js";
import { logger } from "../logger";
import { buildRecommendationInput } from "./recommendation-input.js";

const RECS_BUDGET_MS = 240_000;
const MIN_RETRY_REMAINING_MS = 60_000;

export interface Recommendation {
  tier: "critical" | "high_leverage" | "secondary";
  finding: string;
  whyItMatters: string;
  fixInstruction: string;
}

// ─── Rule-based recommendations ───────────────────────────────────────────────

function generateRuleBasedRecommendations(moduleResults: Record<string, unknown>): Recommendation[] {
  const recs: Recommendation[] = [];
  const techSeo = moduleResults.technicalSeo as Record<string, unknown> | null;
  if (!techSeo) return recs;

  const robotsAnalysis = techSeo.robotsTxtAnalysis as Record<string, unknown> | null;
  const sitemapAnalysis = techSeo.sitemapXmlAnalysis as Record<string, unknown> | null;
  const llmsAnalysis = techSeo.llmsTxtAnalysis as Record<string, unknown> | null;

  // ── KRITISCH ────────────────────────────────────────────────────────────────

  if (!techSeo.robotsTxt) {
    recs.push({
      tier: "critical",
      finding: "robots.txt fehlt vollständig",
      whyItMatters:
        "Ohne robots.txt können LLM-Crawler die Crawling-Regeln nicht lesen. Einige Crawler interpretieren das Fehlen als fehlende Autorisierung.",
      fixInstruction:
        "Erstellen Sie eine robots.txt im Root-Verzeichnis:\nUser-agent: *\nAllow: /\nSitemap: https://ihre-domain.de/sitemap.xml",
    });
  }

  if (robotsAnalysis) {
    const llmCrawlers = (robotsAnalysis.llmCrawlers as Array<{ name: string; status: string }>) ?? [];
    const siteBlockedAgents = (robotsAnalysis.siteBlockedAgents as string[]) ?? [];
    const wildcardBlocked = siteBlockedAgents.includes("*");
    const blockedCritical = llmCrawlers.filter(
      (c) => ["ClaudeBot", "GPTBot", "Google-Extended"].includes(c.name) && c.status === "disallowed",
    );

    if (wildcardBlocked) {
      recs.push({
        tier: "critical",
        finding: "robots.txt blockiert alle Crawler mit Disallow: /",
        whyItMatters:
          "Die gesamte Website ist für alle Crawler gesperrt — weder Suchmaschinen noch LLM-Crawler können Inhalte indexieren.",
        fixInstruction:
          'Ersetzen Sie "Disallow: /" durch "Allow: /" für User-agent: *, oder entfernen Sie die generelle Sperrung.',
      });
    } else if (blockedCritical.length > 0) {
      const names = blockedCritical.map((c) => c.name).join(", ");
      recs.push({
        tier: "critical",
        finding: `${names} ${blockedCritical.length === 1 ? "ist" : "sind"} durch robots.txt blockiert`,
        whyItMatters:
          "Diese Crawler werden von Claude, ChatGPT und Google AI genutzt. Eine Sperrung verhindert direkt die LLM-Sichtbarkeit.",
        fixInstruction: `Entfernen Sie die Disallow: / Regeln für ${names} oder setzen Sie explizit:\n${blockedCritical.map((c) => `User-agent: ${c.name}\nAllow: /`).join("\n\n")}`,
      });
    }
  }

  // ── HOHER HEBEL ─────────────────────────────────────────────────────────────

  if (!llmsAnalysis || !llmsAnalysis.present) {
    recs.push({
      tier: "high_leverage",
      finding: "llms.txt nicht vorhanden",
      whyItMatters:
        "llms.txt ist ein aufkommender Standard, mit dem Website-Betreiber strukturierte Informationen speziell für LLM-Crawler bereitstellen — ähnlich wie robots.txt, aber mit inhaltlichem Fokus für KI-Systeme.",
      fixInstruction:
        "Erstellen Sie /llms.txt im Root-Verzeichnis:\n# Firmenname\n> Kurzbeschreibung Ihres Unternehmens\n\n## Produkte\n- [Produktname](https://ihre-domain.de/produkt): Beschreibung\n\n## Kontakt\n- [Kontakt](https://ihre-domain.de/kontakt): Ansprechpartner",
    });
  }

  if (robotsAnalysis && techSeo.robotsTxt) {
    const llmCrawlers = (robotsAnalysis.llmCrawlers as Array<{ name: string; status: string }>) ?? [];
    const keyBots = ["GPTBot", "ClaudeBot", "PerplexityBot"];
    const allKeyBotsNotMentioned = keyBots.every(
      (name) => llmCrawlers.find((c) => c.name === name)?.status === "not_mentioned",
    );
    if (allKeyBotsNotMentioned) {
      recs.push({
        tier: "high_leverage",
        finding: "Wichtige LLM-Crawler nicht explizit in robots.txt adressiert",
        whyItMatters:
          "GPTBot, ClaudeBot und PerplexityBot sind die Crawler von ChatGPT, Claude und Perplexity. Ein explizites Allow signalisiert Bereitschaft zur KI-Indexierung.",
        fixInstruction:
          "Ergänzen Sie in der robots.txt:\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /",
      });
    }
  }

  const sitemapType = (sitemapAnalysis?.type as string) ?? (techSeo.sitemapXml ? "xml" : "none");
  const hasXmlSitemap = sitemapType === "xml" || sitemapType === "xml_index";

  if (sitemapType === "none") {
    recs.push({
      tier: "critical",
      finding: "Keine Sitemap gefunden (weder XML noch HTML)",
      whyItMatters:
        "Ohne Sitemap müssen Suchmaschinen und LLM-Crawler alle Seiten über interne Links entdecken — viele wichtige Seiten bleiben unentdeckt.",
      fixInstruction:
        "Erstellen Sie eine sitemap.xml im Root-Verzeichnis. Verwenden Sie ein CMS-Plugin (z.B. Yoast SEO für WordPress) oder generieren Sie die Sitemap automatisch aus Ihrer Routing-Konfiguration.",
    });
  } else if (sitemapType === "html") {
    recs.push({
      tier: "high_leverage",
      finding: "Nur eine HTML-Sitemap gefunden — keine maschinenlesbare XML-Sitemap vorhanden",
      whyItMatters:
        "HTML-Sitemaps sind für Menschen gedacht, nicht für Crawler. Suchmaschinen und LLM-Crawler können XML-Sitemaps direkt verarbeiten, um alle URLs effizient zu indexieren.",
      fixInstruction:
        "Erstellen Sie zusätzlich eine /sitemap.xml und referenzieren Sie diese in der robots.txt:\nSitemap: https://ihre-domain.de/sitemap.xml",
    });
  } else if (hasXmlSitemap && sitemapAnalysis && (sitemapAnalysis.totalUrls as number) < 5) {
    recs.push({
      tier: "high_leverage",
      finding: `Sitemap enthält nur ${sitemapAnalysis.totalUrls} URL(s)`,
      whyItMatters:
        "Eine sehr kleine Sitemap deutet darauf hin, dass wichtige Produkt- oder Serviceseiten fehlen.",
      fixInstruction:
        "Erweitern Sie die Sitemap um alle wichtigen Inhaltsseiten (Produkte, Leistungen, Blog-Kategorien). Prüfen Sie, ob Ihre Sitemap-Generierung korrekt konfiguriert ist.",
    });
  }

  if (hasXmlSitemap && sitemapAnalysis) {
    const coverage = sitemapAnalysis.crawledPageCoverage as number;
    if (coverage < 50 && (sitemapAnalysis.totalUrls as number) > 0) {
      recs.push({
        tier: "high_leverage",
        finding: `Nur ${coverage}% der gecrawlten Seiten sind in der Sitemap enthalten`,
        whyItMatters:
          "Wichtige Produkt- und Serviceseiten, die Crawler besucht haben, fehlen in der Sitemap — das reduziert die Indexierungstiefe.",
        fixInstruction:
          "Überprüfen Sie Ihre Sitemap-Generierung und stellen Sie sicher, dass alle öffentlich relevanten Seiten erfasst sind.",
      });
    }
  }

  // ── NACHGEORDNET ────────────────────────────────────────────────────────────

  if (hasXmlSitemap && sitemapAnalysis && !sitemapAnalysis.oldestLastmod) {
    recs.push({
      tier: "secondary",
      finding: "XML-Sitemap enthält keine <lastmod>-Daten",
      whyItMatters:
        "Ohne Lastmod-Daten können Crawler Seiten nicht nach Aktualität priorisieren — veraltete Inhalte werden möglicherweise überhäufig neu gecrawlt.",
      fixInstruction:
        "Ergänzen Sie <lastmod>-Einträge für jede URL, z.B. <lastmod>2025-01-15</lastmod>. Die meisten CMS-Plugins können das automatisch.",
    });
  }

  if (
    hasXmlSitemap &&
    robotsAnalysis &&
    (robotsAnalysis.sitemapUrls as string[]).length === 0
  ) {
    recs.push({
      tier: "secondary",
      finding: "Sitemap nicht in robots.txt referenziert",
      whyItMatters:
        "Crawler, die keine Sitemap-Direktive finden, müssen die Sitemap erraten — einige übersehen sie komplett.",
      fixInstruction:
        "Ergänzen Sie am Ende der robots.txt:\nSitemap: https://ihre-domain.de/sitemap.xml",
    });
  }

  if (llmsAnalysis && llmsAnalysis.present) {
    const linkedPageCount = (llmsAnalysis.linkedPageCount as number) ?? 0;
    const hasDescription = llmsAnalysis.hasDescription as boolean;
    if (!hasDescription || linkedPageCount < 3) {
      const issues: string[] = [];
      if (!hasDescription) issues.push("ohne ausreichende Beschreibung");
      if (linkedPageCount < 3) issues.push(`nur ${linkedPageCount} verlinkte Seite${linkedPageCount !== 1 ? "n" : ""}`);
      recs.push({
        tier: "secondary",
        finding: `llms.txt vorhanden, aber ${issues.join(" und ")}`,
        whyItMatters:
          "Eine vollständigere llms.txt mit Beschreibung und mehreren verlinkten Seiten verbessert die Qualität der KI-generierten Antworten über Ihr Unternehmen deutlich.",
        fixInstruction:
          "Ergänzen Sie eine > Beschreibung unter dem Titel und verlinken Sie alle wichtigen Produkt-, Service- und Kontaktseiten.",
      });
    }
  }

  return recs;
}

// ─── Language guard ───────────────────────────────────────────────────────────

const ENGLISH_WORDS = [
  "the", "is", "are", "this", "that", "with", "your", "should",
  "and", "of", "to", "missing", "ensure", "improve",
] as const;

export function isEnglishRecommendation(rec: Pick<Recommendation, "finding" | "whyItMatters">): boolean {
  const text = `${rec.finding} ${rec.whyItMatters}`.toLowerCase();
  const matched = new Set(
    ENGLISH_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(text)),
  );
  return matched.size >= 3;
}

function firstEnglishRecommendation(recs: Recommendation[]): Recommendation | undefined {
  return recs.find(isEnglishRecommendation);
}

// ─── Plausibility guard ───────────────────────────────────────────────────────

const SCHEMA_TOTAL_ABSENCE_RULE = {
  id: "schema_total_absence",
  subject: /(strukturierte\w*[\s-]+daten|schema\.org|schema-markup|json-ld)/,
  absence: /(vollständig|gänzlich|komplett|keinerlei|auf keiner|überhaupt kein|kein\w*\s+(strukturierte|schema))/,
} as const;
const H1_ABSENCE_RULE = {
  id: "h1_absence",
  pattern: /(kein\w*\s+(eindeutige\w*\s+)?h1\b|\bh1\b[\w\s-]{0,20}(fehlt|fehlen|fehlend))/,
} as const;
const FAQ_SCHEMA_ABSENCE_RULE = {
  id: "faq_schema_absence",
  pattern: /(kein\w*\s+faq\w*[\s-]?schema|faq\w*[\s-]?schema[\w\s-]{0,20}(fehlt|fehlen|fehlend|nicht vorhanden|nicht implementiert))/,
  qualification: /(obwohl|zwar|vorhanden ist)/,
} as const;
const HREFLANG_PRESENT_RULE = {
  id: "hreflang_present",
  pattern: /(kein\w*\s+hreflang|hreflang[\w\s-]{0,30}(fehlt|fehlen|fehlend|abwesend|nicht vorhanden))/,
} as const;
const HREFLANG_MONOLINGUAL_RULE = {
  id: "hreflang_monolingual",
} as const;

const SCHEMA_TYPE_NAMES = [
  "product", "webpage", "website", "article", "newsarticle", "organization",
  "localbusiness", "faqpage", "breadcrumblist", "offer", "review",
  "aggregaterating", "howto", "event", "person", "service", "imageobject",
  "videoobject",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recommendationHeadline(rec: Recommendation): string {
  const colonIndex = rec.finding.indexOf(":");
  const sentenceIndex = rec.finding.indexOf(". ");
  const end = [colonIndex, sentenceIndex]
    .filter((index) => index >= 0)
    .reduce((earliest, index) => Math.min(earliest, index), rec.finding.length);
  return rec.finding.slice(0, end).slice(0, 160).toLowerCase();
}

export function filterImplausibleRecommendations(
  recs: Recommendation[],
  moduleResults: Record<string, unknown>,
): { kept: Recommendation[]; dropped: Array<{ rule: string; finding: string }> } {
  const schemaOrg = asRecord(moduleResults.schemaOrg);
  const detectedTypes = Array.isArray(schemaOrg?.detectedTypes) ? schemaOrg.detectedTypes : [];
  const headingStructure = asRecord(moduleResults.headingStructure);
  const headingPages = Array.isArray(headingStructure?.pages) ? headingStructure.pages : [];
  const scoredHeadingPages = headingPages
    .map(asRecord)
    .filter((page): page is Record<string, unknown> => page !== null && page.excludedAsLegal !== true);
  const faqQuality = asRecord(moduleResults.faqQuality);
  const technicalSeo = asRecord(moduleResults.technicalSeo);
  const hreflang = asRecord(technicalSeo?.hreflang);
  const hreflangLanguages = Array.isArray(hreflang?.languages) ? hreflang.languages : [];
  const languageVariants = Array.isArray(moduleResults.languageVariants) ? moduleResults.languageVariants : [];
  const dropped: Array<{ rule: string; finding: string }> = [];
  const kept: Recommendation[] = [];

  for (const rec of recs) {
    const headline = recommendationHeadline(rec);
    const finding = rec.finding.toLowerCase();
    let rule: string | undefined;

    if (
      detectedTypes.length > 0
      && SCHEMA_TOTAL_ABSENCE_RULE.subject.test(headline)
      && SCHEMA_TOTAL_ABSENCE_RULE.absence.test(headline)
      && !SCHEMA_TYPE_NAMES.some((type) => new RegExp(`\\b${type}\\b`, "i").test(headline))
    ) {
      rule = SCHEMA_TOTAL_ABSENCE_RULE.id;
    } else if (
      headingPages.length > 0
      && !scoredHeadingPages.some((page) => page.h1Count === 0)
      && H1_ABSENCE_RULE.pattern.test(headline)
    ) {
      rule = H1_ABSENCE_RULE.id;
    } else if (
      faqQuality?.hasFaqSchema === true
      && FAQ_SCHEMA_ABSENCE_RULE.pattern.test(headline)
      && !FAQ_SCHEMA_ABSENCE_RULE.qualification.test(finding)
    ) {
      rule = FAQ_SCHEMA_ABSENCE_RULE.id;
    } else if (
      hreflang?.present === true
      && HREFLANG_PRESENT_RULE.pattern.test(headline)
    ) {
      rule = HREFLANG_PRESENT_RULE.id;
    } else if (
      hreflangLanguages.length === 0
      && languageVariants.length === 0
      && headline.includes("hreflang")
    ) {
      rule = HREFLANG_MONOLINGUAL_RULE.id;
    }

    if (rule) {
      const droppedFinding = rec.finding.slice(0, 160);
      dropped.push({ rule, finding: droppedFinding });
      logger.warn(
        { rule, finding: droppedFinding },
        "implausible AI recommendation dropped",
      );
    } else {
      kept.push(rec);
    }
  }

  return { kept, dropped };
}

function parseRecommendations(text: string): Recommendation[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed: Recommendation[] = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

async function buildRecommendationsPrompt(resultsStr: string, retryPrefix = ""): Promise<string> {
  return fillTemplate(await getPrompt("recommendations"), {
    RESULTS_JSON: resultsStr,
    RETRY_PREFIX: retryPrefix,
  });
}

export async function generateRecommendations(
  moduleResults: Record<string, unknown>,
): Promise<Recommendation[]> {
  const startedAt = Date.now();
  const deadline = startedAt + RECS_BUDGET_MS;
  const ruleBasedRecs = generateRuleBasedRecommendations(moduleResults);

  let aiRecs: Recommendation[] = [];
  try {
    const input = buildRecommendationInput(moduleResults);
    logger.info(
      {
        inputChars: input.size,
        languageVariantsChars: input.languageVariantsChars,
        trimLevel: input.trimLevel,
        modules: input.modules,
      },
      "recommendations input built",
    );

    const callApi = async (content: string) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("time budget exhausted");
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("time budget exhausted"));
          }, remaining);
        });
        const request = anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          messages: [{ role: "user", content }],
        }, { timeout: remaining, signal: controller.signal });
        const msg = await Promise.race([request, timeout]);
        const block = msg.content[0];
        return block.type === "text" ? block.text : "";
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const firstText = await callApi(await buildRecommendationsPrompt(input.text));
    const firstParsed = parseRecommendations(firstText);

    if (firstParsed && firstParsed.length > 0) {
      const offending = firstEnglishRecommendation(firstParsed);
      if (offending) {
        const remaining = deadline - Date.now();
        if (remaining >= MIN_RETRY_REMAINING_MS) {
          logger.warn(
            { finding: offending.finding.slice(0, 120) },
            "English detected in recommendations — retrying",
          );
          const retryText = await callApi(
            await buildRecommendationsPrompt(
              input.text,
              "FEHLER: Deine letzte Antwort enthielt englische Texte. " +
              "Wiederhole die Ausgabe vollständig auf Deutsch.\n\n",
            ),
          );
          const retryParsed = parseRecommendations(retryText);
          if (retryParsed && retryParsed.length > 0) aiRecs = retryParsed;
          else aiRecs = firstParsed;
        } else {
          aiRecs = firstParsed;
        }
      } else {
        aiRecs = firstParsed;
      }
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn({ err }, `AI recommendations skipped: ${reason}`);
  } finally {
    logger.info(
      { durationMs: Date.now() - startedAt },
      "recommendations generation finished",
    );
  }

  const { kept } = filterImplausibleRecommendations(aiRecs, moduleResults);
  return [...ruleBasedRecs, ...kept];
}
