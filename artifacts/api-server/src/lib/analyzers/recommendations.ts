import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../logger";

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

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateRecommendations(
  moduleResults: Record<string, unknown>,
): Promise<Recommendation[]> {
  const ruleBasedRecs = generateRuleBasedRecommendations(moduleResults);

  let aiRecs: Recommendation[] = [];
  try {
    const resultsStr = JSON.stringify(moduleResults, null, 2).slice(0, 12000);

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `IMPORTANT: You must respond entirely in German. Every word of every recommendation — the title, the problem description, the why_it_matters explanation, and the fix instruction — must be in German. Do not use any English words, phrases, or sentences anywhere in your response. This is a strict requirement.

Based on these website analysis findings, generate a prioritized action list grouped into three tiers:

- "critical": must be fixed immediately (broken fundamentals: missing canonical, no HTTPS, 0 structured data, H1 absent)
- "high_leverage": changes likely to produce major visibility gains (missing FAQPage schema, thin content, no use-case descriptions, hreflang errors, missing Organization schema)
- "secondary": improvements for after critical + high-leverage are resolved (meta description length, image alt gaps, heading hierarchy inconsistencies)

Each recommendation must include:
- What exactly is wrong (specific page/element if possible)
- Why it matters for LLM discoverability and/or classic SEO
- Concrete fix instruction (code snippet or content guidance)

Note: robots.txt, sitemap.xml, and llms.txt recommendations are already handled separately — focus on content quality, structured data, and on-page SEO issues.

Analysis findings:
${resultsStr}

Return a JSON array (no markdown) of objects:
[{"tier": "critical|high_leverage|secondary", "finding": "...", "whyItMatters": "...", "fixInstruction": "..."}]`,
        },
      ],
    });

    const block = message.content[0];
    if (block.type === "text") {
      const match = block.text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed: Recommendation[] = JSON.parse(match[0]);
        if (Array.isArray(parsed)) aiRecs = parsed;
      }
    }
  } catch (err) {
    logger.warn({ err }, "AI recommendation generation failed");
  }

  return [...ruleBasedRecs, ...aiRecs];
}
