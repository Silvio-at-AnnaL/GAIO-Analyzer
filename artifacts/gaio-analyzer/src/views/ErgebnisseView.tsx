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
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  Loader2, CheckCircle2, XCircle, Download, Star, AlertCircle, AlertTriangle, Info, Clock
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
        <h1 className="text-xl font-bold font-mono tracking-tight">
          {isFailed ? "Analyse fehlgeschlagen" : "Analyse läuft…"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {report?.url ? `Crawle ${report.url}` : "Verarbeite Daten…"}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground font-mono">
          <span>{report?.currentModule || "Initialisierung…"}</span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <div className="space-y-1.5">
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
              <span className="font-mono text-xs">{name}</span>
            </div>
          );
        })}
      </div>

      {report?.errors && report.errors.length > 0 && (
        <div className="p-3 rounded-md bg-muted/50 space-y-1">
          <p className="text-xs font-mono text-muted-foreground">Hinweise:</p>
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

function ReportView({ analysisId }: { analysisId: string }) {
  const { data: report } = useGetAnalysisReport(analysisId, {
    query: {
      enabled: !!analysisId,
      queryKey: getGetAnalysisReportQueryKey(analysisId),
    },
  });

  if (!report) return <div className="text-muted-foreground text-sm">Lade Bericht…</div>;

  const technicalSeo = report.technicalSeo as Record<string, unknown> | null;
  const schemaOrg = report.schemaOrg as Record<string, unknown> | null;
  const headingStructure = report.headingStructure as Record<string, unknown> | null;
  const contentRelevance = report.contentRelevance as Record<string, unknown> | null;
  const faqQuality = report.faqQuality as Record<string, unknown> | null;
  const llmDiscoverability = report.llmDiscoverability as Record<string, unknown> | null;
  const competitorComparison = report.competitorComparison as { competitors: Array<{ name: string; url: string; compositeScore: number }> } | null;
  const recommendations = report.recommendations as Array<{ tier: string; finding: string; whyItMatters: string; fixInstruction: string }>;

  const radarData = [
    { subject: "Techn. SEO", value: (technicalSeo?.score as number) ?? 0 },
    { subject: "Schema.org", value: (schemaOrg?.score as number) ?? 0 },
    { subject: "Headings", value: (headingStructure?.score as number) ?? 0 },
    { subject: "Inhalt", value: (contentRelevance?.score as number) ?? 0 },
    { subject: "FAQ", value: (faqQuality?.score as number) ?? 0 },
    { subject: "LLM", value: (llmDiscoverability?.score as number) ?? 0 },
  ];

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
          <h1 className="text-xl font-bold font-mono tracking-tight">Ergebnisse</h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
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
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wide">GAIO Score</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-2">
            <ScoreDonut score={report.overallScore ?? 0} />
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-mono text-muted-foreground uppercase tracking-wide">Dimensionen</CardTitle>
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
              <p className="text-xs text-muted-foreground font-mono leading-tight">{d.subject}</p>
              <p className={`text-xl font-bold font-mono mt-0.5 ${d.value >= 71 ? "text-green-500" : d.value >= 41 ? "text-yellow-500" : "text-red-500"}`}>
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
              <CardHeader><CardTitle className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Technische SEO-Metriken</CardTitle></CardHeader>
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

          {technicalSeo && (
            <Card>
              <CardHeader><CardTitle className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Technische Details</CardTitle></CardHeader>
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
              <CardHeader><CardTitle className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Schema.org / Strukturierte Daten</CardTitle></CardHeader>
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
              <CardHeader><CardTitle className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Inhaltliche Relevanz</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {((contentRelevance.dimensions as Array<{ name: string; score: number; findings: string[] }>) || []).map((dim) => (
                  <div key={dim.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{dim.name}</span>
                      <span className={`font-mono text-sm font-bold ${dim.score >= 7 ? "text-green-500" : dim.score >= 4 ? "text-yellow-500" : "text-red-500"}`}>
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
                <CardTitle className="text-xs font-mono uppercase tracking-wide text-muted-foreground">
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
            <Card>
              <CardHeader><CardTitle className="text-xs font-mono uppercase tracking-wide text-muted-foreground">Wettbewerbsvergleich</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(180, (competitorComparison.competitors.length + 1) * 45 + 60)}>
                  <BarChart
                    data={[
                      { name: report.url ? (() => { try { return new URL(report.url!).hostname; } catch { return "Ihre Seite"; } })() : "Ihre Seite", compositeScore: report.overallScore ?? 0 },
                      ...competitorComparison.competitors.map((c) => ({ name: c.name, compositeScore: c.compositeScore })),
                    ]}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={140} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                    <Bar dataKey="compositeScore" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} name="Score" />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-muted-foreground mt-2">Wettbewerber-Scores basieren auf einer Einzelseiten-Stichprobe.</p>
              </CardContent>
            </Card>
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
              <h3 className="text-xs font-bold font-mono flex items-center gap-2 text-red-500 uppercase tracking-wider">
                <AlertCircle className="w-3.5 h-3.5" /> Kritisch ({criticalRecs.length})
              </h3>
              {criticalRecs.map((rec, i) => <RecommendationCard key={i} rec={rec} />)}
            </div>
          )}
          {highRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold font-mono flex items-center gap-2 text-orange-500 uppercase tracking-wider">
                <AlertTriangle className="w-3.5 h-3.5" /> Hoher Hebel ({highRecs.length})
              </h3>
              {highRecs.map((rec, i) => <RecommendationCard key={i} rec={rec} />)}
            </div>
          )}
          {secondaryRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold font-mono flex items-center gap-2 text-yellow-500 uppercase tracking-wider">
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
          <CardHeader><CardTitle className="text-xs font-mono text-destructive uppercase tracking-wide">Hinweise & Fehler</CardTitle></CardHeader>
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
