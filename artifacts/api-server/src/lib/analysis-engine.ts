import { crawlSite, fetchPage, type CrawlResult, type CrawledPage } from "./crawler";
import { analyzeTechnicalSeo } from "./analyzers/technical-seo";
import { analyzeSchemaOrg } from "./analyzers/schema-org";
import { analyzeHeadings } from "./analyzers/headings";
import { analyzeContentRelevance } from "./analyzers/content-relevance";
import { analyzeFaq } from "./analyzers/faq";
import { analyzeLlmDiscoverability } from "./analyzers/llm-discoverability";
import { analyzeCompetitors } from "./analyzers/competitors";
import { generateRecommendations } from "./analyzers/recommendations";
import { logger } from "./logger";

export interface AnalysisState {
  id: string;
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
  recommendations: unknown[];
  errors: string[];
  crawledPages: string[];
  hreflangVariants: Array<{ lang: string; url: string }>;
}

interface AnalysisEntry {
  state: AnalysisState;
  startedAt: string;
}

const analysisStore = new Map<string, AnalysisEntry>();

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
  socialMedia?: string | null;
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
): Promise<void> {
  const state: AnalysisState = {
    id,
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
    recommendations: [],
    errors: [],
    crawledPages: [],
    hreflangVariants: [],
  };

  const startedAt = new Date().toISOString();
  const save = () => analysisStore.set(id, { state: { ...state }, startedAt });
  save();

  const questionnaireContext = buildQuestionnaireContext(questionnaire);
  const brandTerms = extractBrandTerms(questionnaire);
  const competitorUrls = extractCompetitorUrls(questionnaire);

  let crawlResult: CrawlResult;
  let pages: CrawledPage[];

  try {
    if (mode === "url" && url) {
      state.currentModule = "Crawling Website";
      state.progress = 5;
      save();

      if (explicitUrls && explicitUrls.length > 0) {
        // Use pre-selected pages, fetch them individually without re-crawling
        const fetchedPages = await Promise.allSettled(
          explicitUrls.map((pageUrl) => fetchPage(pageUrl)),
        );
        pages = fetchedPages
          .filter((r): r is PromiseFulfilledResult<CrawledPage> => r.status === "fulfilled" && r.value !== null)
          .map((r) => r.value);
        crawlResult = {
          pages,
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
        };
      } else {
        crawlResult = await crawlSite(url, 16);
        pages = crawlResult.pages;
      }
      state.crawledPages = pages.map((p) => p.url);
      state.hreflangVariants = crawlResult.hreflangVariants ?? [];

      if (pages.length === 0) {
        state.status = "failed";
        state.errors.push("Could not crawl any pages from the provided URL");
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
      };
      state.crawledPages = ["uploaded-page"];
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
      state.technicalSeo = analyzeTechnicalSeo(crawlResult, url || "uploaded-page");
    } catch (err) {
      logger.error({ err }, "Technical SEO analysis failed");
      state.errors.push("Technical SEO analysis failed");
    }

    // Module 2: Schema.org
    try {
      state.currentModule = "Schema.org / Strukturierte Daten";
      state.progress = 25;
      save();
      state.schemaOrg = analyzeSchemaOrg(pages);
    } catch (err) {
      logger.error({ err }, "Schema.org analysis failed");
      state.errors.push("Schema.org analysis failed");
    }

    // Module 3: Heading Structure
    try {
      state.currentModule = "Heading-Struktur";
      state.progress = 35;
      save();
      state.headingStructure = analyzeHeadings(pages, brandTerms);
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
      state.currentModule = "FAQ-Qualitaet";
      state.progress = 60;
      save();
      state.faqQuality = await analyzeFaq(pages);
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
        state.competitorComparison = await analyzeCompetitors(competitorUrls, mainSiteScores);
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

    logger.info({ id, overallScore: state.overallScore }, "Analysis completed");
  } catch (err) {
    logger.error({ err, id }, "Analysis failed");
    state.status = "failed";
    state.errors.push("Analysis failed unexpectedly");
    save();
  }
}
