import { useEffect, useState } from "react";
import { useGetAnalysisReport, getGetAnalysisReportQueryKey } from "@workspace/api-client-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScoreDonut } from "@/components/charts/ScoreDonut";
import { generateHtmlReport } from "@/lib/report-export";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import {
  Loader2, CheckCircle2, XCircle, Download, Star, AlertCircle, AlertTriangle,
  Info, Clock, ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";

const MODULE_NAMES = [
  "Crawling Website",
  "Technisches SEO",
  "Schema.org / Strukturierte Daten",
  "Heading-Struktur",
  "Inhaltliche Relevanz (KI-Analyse)",
  "FAQ-Qualitaet",
  "LLM-Auffindbarkeit",
  "Wettbewerbsvergleich",
  "Empfehlungen generieren",
];

function ProgressView({ analysisId, onComplete }: { analysisId: string; onComplete: () => void }) {
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [currentModuleName, setCurrentModuleName] = useState<string | null>(null);

  const { data: report } = useGetAnalysisReport(analysisId, {
    query: {
      enabled: !!analysisId,
      queryKey: getGetAnalysisReportQueryKey(analysisId),
      refetchInterval: 2000,
    },
  });

  useEffect(() => {
    if (report?.currentModule && report.currentModule !== currentModuleName) {
      if (currentModuleName && !completedModules.includes(currentModuleName)) {
        setCompletedModules((prev) => [...prev, currentModuleName!]);
      }
      setCurrentModuleName(report.currentModule);
    }
    if (report?.status === "completed") {
      setTimeout(() => onComplete(), 400);
    }
  }, [report, currentModuleName, completedModules, onComplete]);

  const progress = report?.progress ?? 0;
  const isFailed = report?.status === "failed";

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isFailed ? "Analyse fehlgeschlagen" : "Analyse läuft…"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {report?.url ? `Crawle ${report.url}` : "Verarbeite Daten…"}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{report?.currentModule || "Initialisierung…"}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <div className="space-y-1">
        {MODULE_NAMES.map((name) => {
          const isCompleted = completedModules.includes(name);
          const isCurrent = name === currentModuleName;
          const isError = isFailed && isCurrent;
          const isPending = !isCompleted && !isCurrent;

          return (
            <div
              key={name}
              className="flex items-center gap-3 py-2 px-3 rounded-md text-sm transition-colors"
              style={{
                background: isCurrent ? "hsl(var(--muted))" : "transparent",
                color: isPending ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                opacity: isPending ? 0.4 : 1,
              }}
            >
              {isError ? (
                <XCircle className="w-4 h-4 text-destructive shrink-0" />
              ) : isCompleted ? (
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
              ) : isCurrent ? (
                <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
              ) : (
                <Clock className="w-4 h-4 shrink-0 text-muted-foreground/40" />
              )}
              <span className="text-xs">{name}</span>
            </div>
          );
        })}
      </div>

      {report?.errors && report.errors.length > 0 && (
        <div className="p-3 rounded-md bg-muted/50 space-y-1">
          <p className="text-xs text-muted-foreground">Hinweise:</p>
          {report.errors.map((e, i) => (
            <p key={i} className="text-xs text-muted-foreground">– {e}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationCard({ rec }: { rec: { finding: string; whyItMatters: string; fixInstruction: string } }) {
  return (
    <Card>
      <CardContent className="py-3 px-4 space-y-2">
        <p className="text-sm font-medium">{rec.finding}</p>
        <p className="text-xs text-muted-foreground">{rec.whyItMatters}</p>
        <div className="bg-muted/40 rounded p-2">
          <p className="text-xs font-mono whitespace-pre-wrap">{rec.fixInstruction}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function scoreBadgeColor(score: number): string {
  if (score >= 76) return "hsl(142 71% 45%)";
  if (score >= 61) return "hsl(43 96% 50%)";
  if (score >= 41) return "hsl(35 92% 55%)";
  return "hsl(0 84% 60%)";
}

function scoreLabel(score: number): string {
  if (score >= 76) return "Stark";
  if (score >= 61) return "Solide";
  if (score >= 41) return "Ausbaufähig";
  return "Kritisch";
}

function Delta({ main, comp }: { main: number; comp: number }) {
  const delta = main - comp;
  const color = delta > 0 ? "hsl(142 71% 45%)" : delta < 0 ? "hsl(0 84% 60%)" : "hsl(var(--muted-foreground))";
  const label = delta > 0 ? "Ihr Vorteil" : delta < 0 ? "Aufholbedarf" : "Gleichstand";
  return (
    <span className="text-xs font-semibold" style={{ color }}>
      {delta > 0 ? "+" : ""}{delta}
      <span className="ml-1 opacity-75">{label}</span>
    </span>
  );
}

interface CompetitorCardProps {
  competitor: {
    name: string;
    url: string;
    technicalScore: number;
    schemaScore: number;
    contentScore: number;
    headingScore: number;
    faqScore: number;
    compositeScore: number;
    crawledPagesCount: number;
    findings?: { betterThanYou: string; yourAdvantage: string; recommendation: string } | null;
  };
  mainScores: {
    technicalScore: number;
    schemaScore: number;
    contentScore: number;
    headingScore: number;
    faqScore: number;
  };
}

function CompetitorCard({ competitor, mainScores }: CompetitorCardProps) {
  const metrics = [
    { label: "Technical SEO", main: mainScores.technicalScore, comp: competitor.technicalScore },
    { label: "Schema.org", main: mainScores.schemaScore, comp: competitor.schemaScore },
    { label: "Inhaltliche Relevanz", main: mainScores.contentScore, comp: competitor.contentScore },
    { label: "Heading-Struktur", main: mainScores.headingScore, comp: competitor.headingScore },
    { label: "FAQ-Qualität", main: mainScores.faqScore, comp: competitor.faqScore },
  ];

  const badgeColor = scoreBadgeColor(competitor.compositeScore);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={`https://www.google.com/s2/favicons?domain=${competitor.url}&sz=32`}
              alt=""
              className="w-5 h-5 rounded shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="font-bold text-base truncate">{competitor.name}</span>
          </div>
          <div
            className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide"
            style={{ background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40` }}
          >
            {competitor.compositeScore} · {scoreLabel(competitor.compositeScore)}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Metrics table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Metrik</th>
                <th className="text-right pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ihre Seite</th>
                <th className="text-right pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Wettbewerber</th>
                <th className="text-right pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground pr-2">Delta / Bewertung</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.label} className="border-b border-border/50 last:border-0">
                  <td className="py-2 text-sm text-foreground/80">{m.label}</td>
                  <td className="py-2 text-right font-mono font-semibold text-sm"
                    style={{ color: scoreBadgeColor(m.main) }}>
                    {m.main}
                  </td>
                  <td className="py-2 text-right font-mono font-semibold text-sm"
                    style={{ color: scoreBadgeColor(m.comp) }}>
                    {m.comp}
                  </td>
                  <td className="py-2 text-right pr-2">
                    <Delta main={m.main} comp={m.comp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* LLM note */}
        <p className="text-xs text-muted-foreground italic">
          LLM-Sichtbarkeit wird nur für die Hauptdomain vollständig analysiert
        </p>

        {/* Findings */}
        {competitor.findings && (
          <div className="space-y-2 pt-1">
            {[
              { emoji: "⚠️", label: "Was macht dieser Wettbewerber besser?", text: competitor.findings.betterThanYou, color: "hsl(0 84% 60% / 0.08)", border: "hsl(0 84% 60% / 0.25)" },
              { emoji: "✅", label: "Ihr klarer Vorteil", text: competitor.findings.yourAdvantage, color: "hsl(142 71% 45% / 0.08)", border: "hsl(142 71% 45% / 0.25)" },
              { emoji: "💡", label: "Konkrete Empfehlung", text: competitor.findings.recommendation, color: "hsl(217 91% 60% / 0.08)", border: "hsl(217 91% 60% / 0.25)" },
            ].map((f) => (
              <div
                key={f.label}
                className="rounded-lg px-3 py-2.5 space-y-0.5"
                style={{ background: f.color, border: `1px solid ${f.border}` }}
              >
                <p className="text-xs font-semibold text-muted-foreground">{f.emoji} {f.label}</p>
                <p className="text-sm leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        )}

        {/* Data quality note */}
        <p className="text-xs text-muted-foreground">
          Score-Basis:{" "}
          {competitor.crawledPagesCount > 1
            ? `${competitor.crawledPagesCount} gecrawlte Seiten`
            : "Einzelseiten-Stichprobe (Startseite)"}
          {" · "}
          <a
            href={competitor.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            {competitor.url} <ExternalLink className="w-3 h-3" />
          </a>
        </p>
      </CardContent>
    </Card>
  );
}

function CrawledPagesPanel({ pages }: { pages: string[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors text-left"
      >
        <span>Gecrawlte Seiten ({pages.length} Seiten)</span>
        {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {isOpen && (
        <div className="border-t border-border max-h-72 overflow-y-auto">
          {pages.map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 text-xs hover:bg-muted/20 transition-colors break-all"
              style={{
                fontFamily: "ui-monospace, monospace",
                background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.2)",
                color: "hsl(var(--primary))",
              }}
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              {url}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportView({ analysisId }: { analysisId: string }) {
  const { setCrawledPages, setSelectedPages } = useAppStore();

  const { data: report } = useGetAnalysisReport(analysisId, {
    query: {
      enabled: !!analysisId,
      queryKey: getGetAnalysisReportQueryKey(analysisId),
    },
  });

  // Sync crawled pages back to app store when report loads
  useEffect(() => {
    if (report?.crawledPages && report.crawledPages.length > 0) {
      const pages = report.crawledPages.filter((p) => p !== "uploaded-page");
      if (pages.length > 0) {
        setCrawledPages(pages);
        setSelectedPages(pages);
      }
    }
  }, [report?.crawledPages]);

  if (!report) return <div className="text-muted-foreground text-sm">Lade Bericht…</div>;

  const technicalSeo = report.technicalSeo as Record<string, unknown> | null;
  const schemaOrg = report.schemaOrg as Record<string, unknown> | null;
  const headingStructure = report.headingStructure as Record<string, unknown> | null;
  const contentRelevance = report.contentRelevance as Record<string, unknown> | null;
  const faqQuality = report.faqQuality as Record<string, unknown> | null;
  const llmDiscoverability = report.llmDiscoverability as Record<string, unknown> | null;
  const competitorComparison = report.competitorComparison as {
    competitors: Array<{
      name: string;
      url: string;
      technicalScore: number;
      schemaScore: number;
      contentScore: number;
      headingScore: number;
      faqScore: number;
      compositeScore: number;
      crawledPagesCount: number;
      findings?: { betterThanYou: string; yourAdvantage: string; recommendation: string } | null;
    }>;
  } | null;
  const recommendations = report.recommendations as Array<{ tier: string; finding: string; whyItMatters: string; fixInstruction: string }>;

  const radarData = [
    { subject: "Techn. SEO", value: (technicalSeo?.score as number) ?? 0 },
    { subject: "Schema.org", value: (schemaOrg?.score as number) ?? 0 },
    { subject: "Headings", value: (headingStructure?.score as number) ?? 0 },
    { subject: "Inhalt", value: (contentRelevance?.score as number) ?? 0 },
    { subject: "FAQ", value: (faqQuality?.score as number) ?? 0 },
    { subject: "LLM", value: (llmDiscoverability?.score as number) ?? 0 },
  ];

  const mainScores = {
    technicalScore: (technicalSeo?.score as number) ?? 0,
    schemaScore: (schemaOrg?.score as number) ?? 0,
    contentScore: (contentRelevance?.score as number) ?? 0,
    headingScore: (headingStructure?.score as number) ?? 0,
    faqScore: (faqQuality?.score as number) ?? 0,
  };

  const technicalBarData = technicalSeo ? [
    { name: "Meta-Titel", value: Math.round(((technicalSeo.metaTitles as Record<string, number>)?.present / Math.max(1, report.crawledPages.length)) * 100) },
    { name: "Meta-Beschr.", value: Math.round(((technicalSeo.metaDescriptions as Record<string, number>)?.present / Math.max(1, report.crawledPages.length)) * 100) },
    { name: "Alt-Texte", value: (technicalSeo.imageAltCoverage as number) ?? 0 },
    { name: "HTTPS", value: (technicalSeo.httpsEnforced as boolean) ? 100 : 0 },
    { name: "Viewport", value: (technicalSeo.mobileViewport as boolean) ? 100 : 0 },
  ] : [];

  const criticalRecs = recommendations.filter((r) => r.tier === "critical");
  const highRecs = recommendations.filter((r) => r.tier === "high_leverage");
  const secondaryRecs = recommendations.filter((r) => r.tier === "secondary");
  const llmQuestions = (llmDiscoverability?.questions as Array<{ question: string; rating: number; gap: string }>) || [];

  const myDomain = report.url ? (() => { try { return new URL(report.url!).hostname; } catch { return "Ihre Seite"; } })() : "Ihre Seite";

  const competitorChartData = competitorComparison ? [
    { name: myDomain, compositeScore: report.overallScore ?? 0, isMain: true },
    ...competitorComparison.competitors.map((c) => ({ name: c.name, compositeScore: c.compositeScore, isMain: false })),
  ].sort((a, b) => b.compositeScore - a.compositeScore) : [];

  const handleExport = () => {
    const htmlContent = generateHtmlReport(report as Record<string, unknown>);
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gaio-report-${report.id.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Ergebnisse</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {report.url || "HTML-Upload"} · {report.crawledPages.length} Seiten
          </p>
        </div>
        <Button size="sm" onClick={handleExport} data-testid="button-export">
          <Download className="w-4 h-4 mr-1.5" />
          Analyse herunterladen
        </Button>
      </div>

      {/* Prompt to re-run */}
      <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/20">
        Basisdaten ändern oder neue Analyse starten? → Wechseln Sie zu <strong>Domainanalyse</strong> oder <strong>HTML-Analyse</strong>.
      </p>

      {/* Score overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">GAIO Score</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-2">
            <ScoreDonut score={report.overallScore ?? 0} />
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dimensionen</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }} />
                <Radar dataKey="value" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.2} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Dimension scores */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {radarData.map((d) => (
          <Card key={d.subject}>
            <CardContent className="py-3 px-3 text-center">
              <p className="text-xs text-muted-foreground leading-tight">{d.subject}</p>
              <p className="text-xl font-bold mt-0.5" style={{ color: scoreBadgeColor(d.value) }}>
                {d.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="llm">LLM-Auffindbarkeit</TabsTrigger>
          <TabsTrigger value="competitors">Wettbewerb</TabsTrigger>
          <TabsTrigger value="recommendations">Empfehlungen</TabsTrigger>
        </TabsList>

        {/* Details Tab */}
        <TabsContent value="details" className="space-y-4 pt-4">
          {technicalBarData.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technische SEO-Metriken</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={technicalBarData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))" }} />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Gecrawlte Seiten collapsible panel */}
          {report.crawledPages.filter((p) => p !== "uploaded-page").length > 0 && (
            <CrawledPagesPanel pages={report.crawledPages.filter((p) => p !== "uploaded-page")} />
          )}

          {technicalSeo && (
            <Card>
              <CardHeader><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technische Details</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: "Antwortzeit", val: `${technicalSeo.responseTime}ms` },
                    { label: "TTFB", val: `${technicalSeo.ttfb}ms` },
                    { label: "robots.txt", val: (technicalSeo.robotsTxt as boolean) ? "✓" : "✗" },
                    { label: "sitemap.xml", val: (technicalSeo.sitemapXml as boolean) ? "✓" : "✗" },
                    { label: "HTTPS", val: (technicalSeo.httpsEnforced as boolean) ? "✓" : "✗" },
                    { label: "Viewport", val: (technicalSeo.mobileViewport as boolean) ? "✓" : "✗" },
                    { label: "Alt-Text", val: `${technicalSeo.imageAltCoverage}%` },
                    { label: "Canonical Tags", val: String((technicalSeo.canonicalTags as Record<string, unknown>)?.count ?? 0) },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-sm font-bold font-mono">{val}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {schemaOrg && (
            <Card>
              <CardHeader><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Schema.org / Strukturierte Daten</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Erkannte Typen:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {((schemaOrg.detectedTypes as string[]) || []).length > 0
                      ? ((schemaOrg.detectedTypes as string[]) || []).map((t) => (
                          <Badge key={t} variant="secondary" className="font-mono text-xs">{t}</Badge>
                        ))
                      : <span className="text-sm text-muted-foreground">Keine strukturierten Daten gefunden</span>
                    }
                  </div>
                </div>
                {((schemaOrg.missingHighValue as string[]) || []).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Fehlende wichtige Typen:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {((schemaOrg.missingHighValue as string[]) || []).map((t) => (
                        <Badge key={t} variant="destructive" className="font-mono text-xs">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {contentRelevance && (
            <Card>
              <CardHeader><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Inhaltliche Relevanz</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {((contentRelevance.dimensions as Array<{ name: string; score: number; findings: string[] }>) || []).map((dim) => (
                  <div key={dim.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{dim.name}</span>
                      <span className="font-mono text-sm font-bold" style={{ color: dim.score >= 7 ? "hsl(142 71% 45%)" : dim.score >= 4 ? "hsl(43 96% 50%)" : "hsl(0 84% 60%)" }}>
                        {dim.score}/10
                      </span>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {dim.findings.map((f, i) => <li key={i}>– {f}</li>)}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* LLM Tab */}
        <TabsContent value="llm" className="space-y-4 pt-4">
          {llmQuestions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  LLM-Auffindbarkeits-Simulation (Score: {(llmDiscoverability?.score as number) ?? 0}/100)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {llmQuestions.map((q, i) => (
                  <div key={i} className="p-3 rounded-lg bg-muted/30 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm font-medium flex-1">{q.question}</p>
                      <div className="flex shrink-0">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star key={star} className={`w-3.5 h-3.5 ${star <= q.rating ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/20"}`} />
                        ))}
                      </div>
                    </div>
                    {q.gap && <p className="text-xs text-muted-foreground">{q.gap}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">Keine LLM-Daten verfügbar.</CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Competitors Tab */}
        <TabsContent value="competitors" className="space-y-4 pt-4">
          {competitorComparison && competitorComparison.competitors.length > 0 ? (
            <>
              {/* Summary chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Gesamt-Score Übersicht
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(160, competitorChartData.length * 44 + 60)}>
                    <BarChart data={competitorChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={140} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))" }} formatter={(v) => [`${v}`, "Score"]} />
                      <Bar dataKey="compositeScore" radius={[0, 4, 4, 0]}>
                        {competitorChartData.map((entry, i) => (
                          <Cell key={i} fill={entry.isMain ? "hsl(var(--primary))" : "hsl(var(--chart-3))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-xs text-muted-foreground mt-2">Ihre Seite ist blau hervorgehoben.</p>
                </CardContent>
              </Card>

              {/* Competitor detail cards */}
              {competitorComparison.competitors.map((c) => (
                <CompetitorCard key={c.url} competitor={c} mainScores={mainScores} />
              ))}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                {report.mode === "html" ? "Wettbewerbsvergleich nicht verfügbar im HTML-Modus." : "Keine Wettbewerber-URLs angegeben."}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations" className="space-y-5 pt-4">
          {criticalRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold flex items-center gap-2 text-red-500 uppercase tracking-wider">
                <AlertCircle className="w-3.5 h-3.5" /> Kritisch ({criticalRecs.length})
              </h3>
              {criticalRecs.map((rec, i) => <RecommendationCard key={i} rec={rec} />)}
            </div>
          )}
          {highRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold flex items-center gap-2 text-orange-500 uppercase tracking-wider">
                <AlertTriangle className="w-3.5 h-3.5" /> Hoher Hebel ({highRecs.length})
              </h3>
              {highRecs.map((rec, i) => <RecommendationCard key={i} rec={rec} />)}
            </div>
          )}
          {secondaryRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold flex items-center gap-2 text-yellow-500 uppercase tracking-wider">
                <Info className="w-3.5 h-3.5" /> Sekundär ({secondaryRecs.length})
              </h3>
              {secondaryRecs.map((rec, i) => <RecommendationCard key={i} rec={rec} />)}
            </div>
          )}
          {recommendations.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">Keine Empfehlungen generiert.</CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {report.errors.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-xs font-semibold text-destructive uppercase tracking-wider">Hinweise &amp; Fehler</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {report.errors.map((e, i) => <li key={i}>– {e}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function ErgebnisseView() {
  const { analysisId, analysisStatus, setAnalysisStatus } = useAppStore();

  if (!analysisId || analysisStatus === "idle") {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <BarChart3Placeholder />
        </div>
        <div>
          <p className="text-base font-medium text-muted-foreground">Noch keine Analyse durchgeführt.</p>
          <p className="text-sm text-muted-foreground mt-1">Starten Sie unter <strong>Domainanalyse</strong> oder <strong>HTML-Analyse</strong>.</p>
        </div>
      </div>
    );
  }

  if (analysisStatus === "running") {
    return (
      <ProgressView
        analysisId={analysisId}
        onComplete={() => setAnalysisStatus("completed")}
      />
    );
  }

  return <ReportView analysisId={analysisId} />;
}

function BarChart3Placeholder() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
