import { crawlSite, fetchPage, type CrawlFailure, type CrawlReliability, type CrawlResult, type CrawledPage } from "./crawler";
import { analyzeTechnicalSeo } from "./analyzers/technical-seo";
import { analyzeSchemaOrg, type SchemaScoreParams } from "./analyzers/schema-org";
import { analyzeHeadings, type HeadingScoreParams } from "./analyzers/headings";
import { analyzeContentRelevance } from "./analyzers/content-relevance";
import { analyzeFaq } from "./analyzers/faq";
import { analyzeLlmDiscoverability } from "./analyzers/llm-discoverability";
import { analyzeCompetitors } from "./analyzers/competitors";
import { generateRecommendations } from "./analyzers/recommendations";
import { logger } from "./logger";
import {
  createAnalysisLog,
  updateAnalysisLogComplete,
  updateAnalysisLogFailed,
} from "./admin-db.js";
import { getScoreParams } from "./score-config.js";
import { runWithAnalysisContext } from "./log-context.js";

export interface AnalysisState {
  id: string;
  logId: number | null;
  status: "pending" | "running" | "completed" | "failed";
  url: string | null;
  mode: "url" | "html";
  overallScore: number | null;
  currentModule: string | null;
  progress: number;
  technicalSeo: unknown | null;
  schemaOrg: unknown | null;
  headingStructure: unknown | null;
  contentRelevance: unknown | null;
  faqQuality: unknown | null;
  llmDiscoverability: unknown | null;
  competitorComparison: unknown | null;
  competitorInput: CompetitorInput;
  recommendations: unknown[];
  errors: string[];
  crawledPages: string[];
  hreflangVariants: Array<{ lang: string; url: string }>;
  crawlReliability: CrawlReliability;
}

export interface CompetitorInput {
  provided: number;
  analysed: number;
  duplicatesRemoved: number;
  ownDomainRemoved: number;
  droppedByLimit: string[];
}

interface AnalysisEntry {
  state: AnalysisState;
  startedAt: string;
}

const analysisStore = new Map<string, AnalysisEntry>();
// Module 7 is bounded to five competitors with 45s crawls and 30s findings;
// 15 minutes leaves headroom for the 90s main crawl and the other modules.
const ANALYSIS_MAX_MS = 15 * 60 * 1000;
const ANALYSIS_TIMEOUT_ERROR = "Analyse abgebrochen: Zeitlimit überschritten (15 Min.)";
const watchdogExpiredAnalyses = new Set<string>();

const analysisWatchdog = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of analysisStore.entries()) {
    if (
      entry.state.status !== "running" ||
      now - Date.parse(entry.startedAt) <= ANALYSIS_MAX_MS
    ) {
      continue;
    }

    watchdogExpiredAnalyses.add(id);
    const state: AnalysisState = {
      ...entry.state,
      status: "failed",
      currentModule: null,
      errors: entry.state.errors.includes(ANALYSIS_TIMEOUT_ERROR)
        ? entry.state.errors
        : [...entry.state.errors, ANALYSIS_TIMEOUT_ERROR],
    };
    analysisStore.set(id, { ...entry, state });
    logger.warn({ id }, "Analysis stopped by global watchdog");
  }
}, 30_000);
analysisWatchdog.unref?.();

export function getAnalysis(id: string): AnalysisState | undefined {
  return analysisStore.get(id)?.state;
}

export function listAnalyses(): Array<{
  id: string;
  status: string;
  url: string | null;
  mode: string;
  overallScore: number | null;
  progress: number;
  crawledPagesCount: number;
  startedAt: string;
}> {
  return Array.from(analysisStore.entries())
    .map(([, entry]) => ({
      id: entry.state.id,
      status: entry.state.status,
      url: entry.state.url,
      mode: entry.state.mode,
      overallScore: entry.state.overallScore,
      progress: entry.state.progress,
      crawledPagesCount: entry.state.crawledPages.length,
      startedAt: entry.startedAt,
    }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

interface QuestionnaireInput {
  companyPitch?: string | null;
  companyName?: string | null;
  brandName?: string | null;
  brandVariants?: string | null;
  subBrands?: string | null;
  slogans?: string | null;
  buyerPersonas?: string | null;
  geographicFocus?: string | null;
  contentLanguages?: string | null;
  competitors?: string | null;
  differentiators?: string | null;
  influencers?: string | null;
  microsites?: string | null;
  directories?: string | null;
  reviewPlatforms?: string | null;
  seoTools?: string | null;
  dataSources?: string | null;
  restrictions?: string | null;
  strategicPriority?: string | null;
  kpis?: string | null;
  weightingPreferences?: string | null;
  plannedCampaigns?: string | null;
}

function buildQuestionnaireContext(q?: QuestionnaireInput | null): string {
  if (!q) return "";
  const parts: string[] = [];
  if (q.companyPitch) parts.push(`Company: ${q.companyPitch}`);
  if (q.companyName) parts.push(`Name: ${q.companyName}`);
  if (q.brandName) parts.push(`Brand: ${q.brandName}`);
  if (q.buyerPersonas) parts.push(`Personas: ${q.buyerPersonas}`);
  if (q.geographicFocus) parts.push(`Geography: ${q.geographicFocus}`);
  if (q.differentiators) parts.push(`Differentiators: ${q.differentiators}`);
  return parts.join("\n");
}

function extractCompetitorUrls(q?: QuestionnaireInput | null): string[] {
  if (!q?.competitors) return [];
  const urls: string[] = [];
  const lines = q.competitors.split(/[\n,;]+/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes(".") || trimmed.startsWith("http")) {
      const urlMatch = trimmed.match(/https?:\/\/[^\s]+/);
      if (urlMatch) {
        urls.push(urlMatch[0]);
      } else if (trimmed.includes(".")) {
        urls.push(`https://${trimmed}`);
      }
    }
  }
  return urls;
}

function competitorKey(input: string): string {
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function normalizeCompetitorUrls(
  urls: string[],
  analysedUrl: string | null,
): { urls: string[]; competitorInput: CompetitorInput } {
  const ownKey = analysedUrl ? competitorKey(analysedUrl) : "";
  const seenKeys = new Set<string>();
  const uniqueUrls: string[] = [];
  let duplicatesRemoved = 0;
  let ownDomainRemoved = 0;

  for (const url of urls) {
    const key = competitorKey(url);
    if (!key) continue;
    if (ownKey && key === ownKey) {
      ownDomainRemoved++;
      continue;
    }
    if (seenKeys.has(key)) {
      duplicatesRemoved++;
      continue;
    }
    seenKeys.add(key);
    uniqueUrls.push(url);
  }

  const urlsToAnalyse = uniqueUrls.slice(0, 5);
  return {
    urls: urlsToAnalyse,
    competitorInput: {
      provided: urls.length,
      analysed: urlsToAnalyse.length,
      duplicatesRemoved,
      ownDomainRemoved,
      droppedByLimit: uniqueUrls.slice(5),
    },
  };
}

function extractBrandTerms(q?: QuestionnaireInput | null): string[] {
  const terms: string[] = [];
  if (q?.brandName) terms.push(q.brandName);
  if (q?.companyName) terms.push(q.companyName);
  if (q?.brandVariants) {
    terms.push(...q.brandVariants.split(/[,;]+/).map((s) => s.trim()).filter(Boolean));
  }
  return terms;
}

export async function runAnalysis(
  id: string,
  mode: "url" | "html",
  url: string | null,
  html: string | null,
  questionnaire?: QuestionnaireInput | null,
  explicitUrls?: string[] | null,
  userSession?: string | null,
): Promise<void> {
  return runWithAnalysisContext(id, async () => {
  const domain = url || "html-upload";
  const companyName = questionnaire?.companyName ?? questionnaire?.brandName ?? null;

  let logId: number | null = null;
  try {
    logId = await createAnalysisLog({ uuid: id, domain, companyName, mode, userSession });
  } catch (err) {
    logger.error({ err }, "Failed to create analysis log entry");
  }

  const state: AnalysisState = {
    id,
    logId,
    status: "running",
    url,
    mode,
    overallScore: null,
    currentModule: null,
    progress: 0,
    technicalSeo: null,
    schemaOrg: null,
    headingStructure: null,
    contentRelevance: null,
    faqQuality: null,
    llmDiscoverability: null,
    competitorComparison: null,
    competitorInput: {
      provided: 0,
      analysed: 0,
      duplicatesRemoved: 0,
      ownDomainRemoved: 0,
      droppedByLimit: [],
    },
    recommendations: [],
    errors: [],
    crawledPages: [],
    hreflangVariants: [],
    crawlReliability: { attempted: 0, succeeded: 0, failed: 0, failures: [] },
  };

  const startedAt = new Date().toISOString();
  const save = () => {
    if (watchdogExpiredAnalyses.has(id)) {
      state.status = "failed";
      state.currentModule = null;
      if (!state.errors.includes(ANALYSIS_TIMEOUT_ERROR)) {
        state.errors.push(ANALYSIS_TIMEOUT_ERROR);
      }
    }
    analysisStore.set(id, { state: { ...state }, startedAt });
  };
  save();

  const questionnaireContext = buildQuestionnaireContext(questionnaire);
  const brandTerms = extractBrandTerms(questionnaire);
  const normalizedCompetitors = normalizeCompetitorUrls(extractCompetitorUrls(questionnaire), url);
  const competitorUrls = normalizedCompetitors.urls;
  state.competitorInput = normalizedCompetitors.competitorInput;
  logger.info(state.competitorInput, "competitor input normalized");
  save();

  let crawlResult: CrawlResult;
  let pages: CrawledPage[];

  try {
    if (mode === "url" && url) {
      state.currentModule = "Crawling Website";
      state.progress = 5;
      save();

      if (explicitUrls && explicitUrls.length > 0) {
        // Use pre-selected pages, fetch them individually without re-crawling
        const BATCH_DEADLINE_MS = Math.min(explicitUrls.length * 20_000, 180_000);
        const results: Array<CrawledPage | null> = new Array(explicitUrls.length).fill(null);
        const completed = new Array<boolean>(explicitUrls.length).fill(false);
        let settled = 0;
        let batchOpen = true;
        let deadlineTimer: ReturnType<typeof setTimeout>;

        const deadline = new Promise<void>((resolve) => {
          deadlineTimer = setTimeout(resolve, BATCH_DEADLINE_MS);
        });
        const all = Promise.allSettled(
          explicitUrls.map(async (pageUrl, index) => {
            const page = await fetchPage(pageUrl);
            results[index] = page;
            completed[index] = true;
            settled++;
            if (batchOpen) {
              state.progress = 5 + Math.round((settled / explicitUrls.length) * 15);
              state.currentModule = "Crawling Website";
              save();
            }
          }),
        );

        await Promise.race([all, deadline]);
        batchOpen = false;
        clearTimeout(deadlineTimer!);

        pages = results.filter(
          (page): page is CrawledPage => page !== null && page.statusCode < 400,
        );
        crawlResult = {
          pages,
          timedOut: false,
          robotsTxt: null,
          sitemapXml: null,
          llmsTxt: null,
          htmlSitemapHtml: null,
          htmlSitemapUrl: null,
          sitemapType: "none",
          robotsTxtExists: false,
          sitemapXmlExists: false,
          llmsTxtExists: false,
          hreflangVariants: [],
          reliability: {
            attempted: explicitUrls.length,
            succeeded: pages.length,
            failed: explicitUrls.length - pages.length,
            failures: results.flatMap<CrawlFailure>((page, index) => {
              if (!completed[index]) {
                return [{ url: explicitUrls[index], reason: "timeout" as const }];
              }
              if (page === null) {
                return [{ url: explicitUrls[index], reason: "unknown" as const }];
              }
              if (page.statusCode >= 400) {
                return [{
                  url: explicitUrls[index],
                  reason: "http_error" as const,
                  statusCode: page.statusCode,
                }];
              }
              return [];
            }).slice(0, 25),
          },
        };
      } else {
        crawlResult = await crawlSite(url, 16, {
          deadlineMs: 90_000,
          onProgress: (done, total) => {
            state.progress = 5 + Math.round((done / Math.max(1, total)) * 15);
            state.currentModule = "Crawling Website";
            save();
          },
        });
        pages = crawlResult.pages;
      }
      state.crawledPages = pages.map((p) => p.url);
      state.hreflangVariants = crawlResult.hreflangVariants ?? [];
      state.crawlReliability = crawlResult.reliability;

      if (pages.length === 0) {
        state.status = "failed";
        const crawlError = crawlResult.homepageFailReason === "bot_protection"
          ? "Crawl nicht möglich: Die Website blockiert automatisierte Zugriffe durch einen Bot-Schutz (z. B. Cloudflare). Für eine Analyse muss der Zugriff für den GAIO-Analyzer freigegeben werden."
          : crawlResult.homepageFailReason === "parked_domain"
            ? "Crawl nicht möglich: Unter dieser Domain ist nur eine Park- bzw. Verkaufsseite erreichbar."
            : crawlResult.timedOut
          ? "Crawl abgebrochen: Die Website antwortet zu langsam für eine automatisierte Analyse (Zeitlimit überschritten)."
          : (explicitUrls && explicitUrls.length > 0
              ? "Crawl fehlgeschlagen: keine Seite konnte innerhalb des Zeitlimits geladen werden"
              : "Crawl fehlgeschlagen: Die Website konnte nicht abgerufen werden (nicht erreichbar oder blockiert automatisierte Zugriffe).");
        state.errors.push(crawlError);
        if (logId !== null) {
          try {
            await updateAnalysisLogFailed(logId, crawlError);
          } catch (dbErr) {
            logger.error({ dbErr }, "Failed to update analysis_log for failed crawl");
          }
        }
        // HTML report (success AND failure) is generated by the frontend and uploaded via
        // /api/admin/analysis-log/auto-export. The backend only records the failed status here.
        save();
        return;
      }
    } else if (mode === "html" && html) {
      pages = [
        {
          url: "uploaded-page",
          html,
          statusCode: 200,
          responseTime: 0,
          ttfb: 0,
        },
      ];
      crawlResult = {
        pages,
        timedOut: false,
        robotsTxt: null,
        sitemapXml: null,
        llmsTxt: null,
        htmlSitemapHtml: null,
        htmlSitemapUrl: null,
        sitemapType: "none",
        robotsTxtExists: false,
        sitemapXmlExists: false,
        llmsTxtExists: false,
        hreflangVariants: [],
        reliability: { attempted: 1, succeeded: 1, failed: 0, failures: [] },
      };
      state.crawledPages = ["uploaded-page"];
      state.crawlReliability = crawlResult.reliability;
    } else {
      state.status = "failed";
      state.errors.push("Invalid input: provide URL or HTML");
      save();
      return;
    }

    // Module 1: Technical SEO
    try {
      state.currentModule = "Technisches SEO";
      state.progress = 10;
      save();
      await new Promise((r) => setTimeout(r, 1000));
      state.technicalSeo = analyzeTechnicalSeo(crawlResult, url || "uploaded-page");
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      logger.error({ err }, "Technical SEO analysis failed");
      state.errors.push("Technical SEO analysis failed");
    }

    // Module 2: Schema.org
    try {
      state.currentModule = "Schema.org / Strukturierte Daten";
      state.progress = 25;
      save();
      await new Promise((r) => setTimeout(r, 600));
      const schemaParams = await getScoreParams("schema-org");
      state.schemaOrg = analyzeSchemaOrg(pages, schemaParams as unknown as SchemaScoreParams);
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      logger.error({ err }, "Schema.org analysis failed");
      state.errors.push("Schema.org analysis failed");
    }

    // Module 3: Heading Structure
    try {
      state.currentModule = "Heading-Struktur";
      state.progress = 35;
      save();
      await new Promise((r) => setTimeout(r, 1000));
      const headingParams = await getScoreParams("headings");
      state.headingStructure = analyzeHeadings(pages, brandTerms, headingParams as unknown as HeadingScoreParams);
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      logger.error({ err }, "Heading analysis failed");
      state.errors.push("Heading analysis failed");
    }

    // Module 4: Content Relevance (LLM)
    try {
      state.currentModule = "Inhaltliche Relevanz (KI-Analyse)";
      state.progress = 45;
      save();
      state.contentRelevance = await analyzeContentRelevance(pages, questionnaireContext);
    } catch (err) {
      logger.error({ err }, "Content relevance analysis failed");
      state.errors.push("Content relevance analysis failed");
    }

    // Module 5: FAQ Quality
    try {
      state.currentModule = "FAQ-Qualität";
      state.progress = 60;
      save();
      await new Promise((r) => setTimeout(r, 600));
      state.faqQuality = await analyzeFaq(pages);
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      logger.error({ err }, "FAQ analysis failed");
      state.errors.push("FAQ analysis failed");
    }

    // Module 6: LLM Discoverability
    try {
      state.currentModule = "LLM-Auffindbarkeit";
      state.progress = 75;
      save();
      state.llmDiscoverability = await analyzeLlmDiscoverability(pages, questionnaireContext, {
        companyName: questionnaire?.companyName ?? questionnaire?.brandName ?? null,
        url,
      });
    } catch (err) {
      logger.error({ err }, "LLM discoverability analysis failed");
      state.errors.push("LLM discoverability analysis failed");
    }

    // Module 7: Competitor Comparison
    if (competitorUrls.length > 0 && mode === "url") {
      try {
        state.currentModule = "Wettbewerbsvergleich";
        state.progress = 85;
        save();
        const mainSiteScores = {
          technicalScore: (state.technicalSeo as { score: number } | null)?.score ?? 0,
          schemaScore: (state.schemaOrg as { score: number } | null)?.score ?? 0,
          contentScore: (state.contentRelevance as { score: number } | null)?.score ?? 0,
          headingScore: (state.headingStructure as { score: number } | null)?.score ?? 0,
          faqScore: (state.faqQuality as { score: number } | null)?.score ?? 0,
          overallScore: 0,
        };
        state.competitorComparison = await analyzeCompetitors(
          competitorUrls,
          mainSiteScores,
          questionnaireContext,
        );
      } catch (err) {
        logger.error({ err }, "Competitor analysis failed");
        state.errors.push("Competitor analysis failed");
      }
    } else if (mode === "html") {
      state.errors.push("Wettbewerbsvergleich nicht verfuegbar im HTML-Modus");
    }

    // Generate recommendations
    try {
      state.currentModule = "Empfehlungen generieren";
      state.progress = 92;
      save();

      const moduleResults = {
        crawlReliability: state.crawlReliability,
        languageVariants: state.hreflangVariants,
        technicalSeo: state.technicalSeo,
        schemaOrg: state.schemaOrg,
        headingStructure: state.headingStructure,
        contentRelevance: state.contentRelevance,
        faqQuality: state.faqQuality,
        llmDiscoverability: state.llmDiscoverability,
      };

      state.recommendations = await generateRecommendations(moduleResults);
    } catch (err) {
      logger.error({ err }, "Recommendation generation failed");
      state.errors.push("Recommendation generation failed");
    }

    // Calculate overall score
    const scores: { value: number; weight: number }[] = [];
    const ts = state.technicalSeo as { score: number } | null;
    const so = state.schemaOrg as { score: number } | null;
    const hs = state.headingStructure as { score: number } | null;
    const cr = state.contentRelevance as { score: number } | null;
    const fq = state.faqQuality as { score: number } | null;
    const ld = state.llmDiscoverability as { score: number } | null;

    if (ts) scores.push({ value: ts.score, weight: 0.15 });
    if (so) scores.push({ value: so.score, weight: 0.20 });
    if (hs) scores.push({ value: hs.score, weight: 0.10 });
    if (cr) scores.push({ value: cr.score, weight: 0.20 });
    if (fq) scores.push({ value: fq.score, weight: 0.15 });
    if (ld) scores.push({ value: ld.score, weight: 0.20 });

    if (scores.length > 0) {
      const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
      state.overallScore = Math.round(
        scores.reduce((sum, s) => sum + s.value * (s.weight / totalWeight), 0),
      );
    }

    state.status = "completed";
    state.progress = 100;
    state.currentModule = null;
    save();

    if (watchdogExpiredAnalyses.has(id)) return;

    if (logId !== null) {
      try {
        const scoresJson = JSON.stringify({
          technicalSeo: (state.technicalSeo as { score: number } | null)?.score ?? null,
          schemaOrg: (state.schemaOrg as { score: number } | null)?.score ?? null,
          headingStructure: (state.headingStructure as { score: number } | null)?.score ?? null,
          contentRelevance: (state.contentRelevance as { score: number } | null)?.score ?? null,
          faqQuality: (state.faqQuality as { score: number } | null)?.score ?? null,
          llmDiscoverability: (state.llmDiscoverability as { score: number } | null)?.score ?? null,
        });
        await updateAnalysisLogComplete(logId, state.overallScore ?? 0, scoresJson, state.crawledPages.length);
      } catch (err) {
        logger.error({ err }, "Failed to update analysis log on complete");
      }
    }

    logger.info({ id, overallScore: state.overallScore }, "Analysis completed");
  } catch (err) {
    logger.error({ err, id }, "Analysis failed");
    state.status = "failed";
    state.errors.push("Analysis failed unexpectedly");
    save();

    if (logId !== null) {
      try {
        await updateAnalysisLogFailed(logId, err instanceof Error ? err.message : String(err));
      } catch (dbErr) {
        logger.error({ dbErr }, "Failed to update analysis log on failure");
      }
    }
  }
  });
}
