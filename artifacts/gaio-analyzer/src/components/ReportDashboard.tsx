import { useGetAnalysisReport, getGetAnalysisReportQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Star, AlertTriangle, AlertCircle, Info } from "lucide-react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ScoreDonut } from "./charts/ScoreDonut";
import { generateHtmlReport } from "@/lib/report-export";

interface Props {
  analysisId: string;
}

export function ReportDashboard({ analysisId }: Props) {
  const { data: report } = useGetAnalysisReport(analysisId, {
    query: {
      enabled: !!analysisId,
      queryKey: getGetAnalysisReportQueryKey(analysisId),
    },
  });

  if (!report) {
    return <div className="text-center py-12 text-muted-foreground">Lade Bericht...</div>;
  }

  const technicalSeo = report.technicalSeo as Record<string, unknown> | null;
  const schemaOrg = report.schemaOrg as Record<string, unknown> | null;
  const headingStructure = report.headingStructure as Record<string, unknown> | null;
  const contentRelevance = report.contentRelevance as Record<string, unknown> | null;
  const faqQuality = report.faqQuality as Record<string, unknown> | null;
  const llmDiscoverability = report.llmDiscoverability as Record<string, unknown> | null;
  const competitorComparison = report.competitorComparison as { competitors: Array<{ name: string; url: string; technicalScore: number; schemaScore: number; contentScore: number; compositeScore: number }> } | null;
  const recommendations = report.recommendations as Array<{ tier: string; finding: string; whyItMatters: string; fixInstruction: string }>;

  const radarData = [
    { subject: "Techn. SEO", value: (technicalSeo?.score as number) ?? 0, fullMark: 100 },
    { subject: "Schema.org", value: (schemaOrg?.score as number) ?? 0, fullMark: 100 },
    { subject: "Headings", value: (headingStructure?.score as number) ?? 0, fullMark: 100 },
    { subject: "Inhalt", value: (contentRelevance?.score as number) ?? 0, fullMark: 100 },
    { subject: "FAQ", value: (faqQuality?.score as number) ?? 0, fullMark: 100 },
    { subject: "LLM", value: (llmDiscoverability?.score as number) ?? 0, fullMark: 100 },
  ];

  const technicalBarData = technicalSeo
    ? [
        { name: "Antwortzeit", value: Math.min(100, Math.max(0, 100 - ((technicalSeo.responseTime as number) / 30))) },
        { name: "Meta-Titel", value: technicalSeo.metaTitles ? Math.round(((technicalSeo.metaTitles as Record<string, number>).present / Math.max(1, report.crawledPages.length)) * 100) : 0 },
        { name: "Meta-Beschr.", value: technicalSeo.metaDescriptions ? Math.round(((technicalSeo.metaDescriptions as Record<string, number>).present / Math.max(1, report.crawledPages.length)) * 100) : 0 },
        { name: "Alt-Texte", value: (technicalSeo.imageAltCoverage as number) ?? 0 },
        { name: "HTTPS", value: (technicalSeo.httpsEnforced as boolean) ? 100 : 0 },
        { name: "Viewport", value: (technicalSeo.mobileViewport as boolean) ? 100 : 0 },
      ]
    : [];

  const handleExport = () => {
    const htmlContent = generateHtmlReport(report);
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gaio-report-${report.id.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const criticalRecs = recommendations.filter((r) => r.tier === "critical");
  const highRecs = recommendations.filter((r) => r.tier === "high_leverage");
  const secondaryRecs = recommendations.filter((r) => r.tier === "secondary");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono tracking-tight">Analysebericht</h1>
          <p className="text-sm text-muted-foreground font-mono">
            {report.url || "HTML-Upload"} | {report.crawledPages.length} Seiten analysiert
          </p>
        </div>
        <Button size="sm" onClick={handleExport} data-testid="button-export">
          <Download className="w-4 h-4 mr-1" />
          Bericht herunterladen
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">GAIO Score</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-4">
            <ScoreDonut score={report.overallScore ?? 0} />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-mono text-muted-foreground">Dimensionen im Ueberblick</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(217 25% 20%)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(215 20% 65%)", fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "hsl(215 20% 65%)", fontSize: 9 }} />
                <Radar name="Score" dataKey="value" stroke="hsl(217 91% 60%)" fill="hsl(217 91% 60%)" fillOpacity={0.25} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {radarData.map((dim) => (
          <Card key={dim.subject}>
            <CardContent className="py-3 px-4 text-center">
              <p className="text-xs text-muted-foreground font-mono">{dim.subject}</p>
              <p className={`text-2xl font-bold font-mono ${
                dim.value >= 71 ? "text-green-500" : dim.value >= 41 ? "text-yellow-500" : "text-red-500"
              }`}>
                {dim.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
          <TabsTrigger value="llm" data-testid="tab-llm">LLM-Auffindbarkeit</TabsTrigger>
          <TabsTrigger value="competitors" data-testid="tab-competitors">Wettbewerb</TabsTrigger>
          <TabsTrigger value="recommendations" data-testid="tab-recommendations">Empfehlungen</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="space-y-4">
          {technicalBarData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-mono">Technische SEO-Metriken</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={technicalBarData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 25% 15%)" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(215 20% 65%)", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fill: "hsl(215 20% 65%)", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(222 25% 8%)", border: "1px solid hsl(217 25% 15%)", borderRadius: "4px" }}
                      labelStyle={{ color: "hsl(210 40% 98%)" }}
                    />
                    <Bar dataKey="value" fill="hsl(217 91% 60%)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {technicalSeo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-mono">Technische Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Antwortzeit</p>
                    <p className="font-mono font-bold">{technicalSeo.responseTime as number}ms</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">TTFB</p>
                    <p className="font-mono font-bold">{technicalSeo.ttfb as number}ms</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">robots.txt</p>
                    <p className="font-mono font-bold">{(technicalSeo.robotsTxt as boolean) ? "Ja" : "Nein"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">sitemap.xml</p>
                    <p className="font-mono font-bold">{(technicalSeo.sitemapXml as boolean) ? "Ja" : "Nein"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Canonical Tags</p>
                    <p className="font-mono font-bold">{(technicalSeo.canonicalTags as Record<string, unknown>)?.count as number}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">HTTPS</p>
                    <p className="font-mono font-bold">{(technicalSeo.httpsEnforced as boolean) ? "Ja" : "Nein"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Mobile Viewport</p>
                    <p className="font-mono font-bold">{(technicalSeo.mobileViewport as boolean) ? "Ja" : "Nein"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Bild Alt-Text</p>
                    <p className="font-mono font-bold">{technicalSeo.imageAltCoverage as number}%</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {schemaOrg && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-mono">Schema.org / Strukturierte Daten</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Erkannte Typen:</p>
                  <div className="flex flex-wrap gap-1">
                    {((schemaOrg.detectedTypes as string[]) || []).map((t) => (
                      <Badge key={t} variant="secondary" className="font-mono text-xs">{t}</Badge>
                    ))}
                    {((schemaOrg.detectedTypes as string[]) || []).length === 0 && (
                      <span className="text-sm text-muted-foreground">Keine strukturierten Daten gefunden</span>
                    )}
                  </div>
                </div>
                {((schemaOrg.missingHighValue as string[]) || []).length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Fehlende wichtige Typen:</p>
                    <div className="flex flex-wrap gap-1">
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
              <CardHeader>
                <CardTitle className="text-sm font-mono">Inhaltliche Relevanz</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {((contentRelevance.dimensions as Array<{ name: string; score: number; findings: string[] }>) || []).map((dim) => (
                  <div key={dim.name} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{dim.name}</span>
                      <span className={`font-mono text-sm font-bold ${
                        dim.score >= 7 ? "text-green-500" : dim.score >= 4 ? "text-yellow-500" : "text-red-500"
                      }`}>
                        {dim.score}/10
                      </span>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {dim.findings.map((f, i) => (
                        <li key={i}>- {f}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="llm" className="space-y-4">
          {llmDiscoverability && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-mono">
                  LLM-Auffindbarkeits-Simulation (Score: {(llmDiscoverability.score as number)}/100)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {((llmDiscoverability.questions as Array<{ question: string; rating: number; gap: string }>) || []).map((q, i) => (
                  <div key={i} className="p-3 rounded bg-muted/30 space-y-2">
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-sm font-medium flex-1">{q.question}</p>
                      <div className="flex shrink-0">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`w-4 h-4 ${
                              star <= q.rating ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/30"
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                    {q.gap && (
                      <p className="text-xs text-muted-foreground">{q.gap}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="competitors" className="space-y-4">
          {competitorComparison && competitorComparison.competitors.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-mono">Wettbewerbsvergleich</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ResponsiveContainer width="100%" height={Math.max(200, competitorComparison.competitors.length * 50 + 60)}>
                  <BarChart
                    data={[
                      { name: report.url ? new URL(report.url).hostname : "Ihre Seite", compositeScore: report.overallScore ?? 0 },
                      ...competitorComparison.competitors.map((c) => ({ name: c.name, compositeScore: c.compositeScore })),
                    ]}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(217 25% 15%)" />
                    <XAxis type="number" domain={[0, 100]} tick={{ fill: "hsl(215 20% 65%)", fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fill: "hsl(215 20% 65%)", fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(222 25% 8%)", border: "1px solid hsl(217 25% 15%)", borderRadius: "4px" }}
                    />
                    <Bar dataKey="compositeScore" fill="hsl(142 71% 45%)" radius={[0, 4, 4, 0]} name="Composite Score" />
                  </BarChart>
                </ResponsiveContainer>
                <p className="text-xs text-muted-foreground">
                  Wettbewerber-Scores sind Schaetzungen basierend auf einer Einzelseiten-Stichprobe.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                {report.mode === "html"
                  ? "Wettbewerbsvergleich ist im HTML-Modus nicht verfuegbar."
                  : "Keine Wettbewerber-URLs im Fragebogen angegeben."}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="recommendations" className="space-y-4">
          {criticalRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold font-mono flex items-center gap-2 text-red-500">
                <AlertCircle className="w-4 h-4" /> KRITISCH ({criticalRecs.length})
              </h3>
              {criticalRecs.map((rec, i) => (
                <RecommendationCard key={i} rec={rec} />
              ))}
            </div>
          )}

          {highRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold font-mono flex items-center gap-2 text-orange-500">
                <AlertTriangle className="w-4 h-4" /> HOHER HEBEL ({highRecs.length})
              </h3>
              {highRecs.map((rec, i) => (
                <RecommendationCard key={i} rec={rec} />
              ))}
            </div>
          )}

          {secondaryRecs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-bold font-mono flex items-center gap-2 text-yellow-500">
                <Info className="w-4 h-4" /> SEKUNDAER ({secondaryRecs.length})
              </h3>
              {secondaryRecs.map((rec, i) => (
                <RecommendationCard key={i} rec={rec} />
              ))}
            </div>
          )}

          {recommendations.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                Keine Empfehlungen generiert.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {report.errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono text-destructive">Hinweise und Fehler</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1">
              {report.errors.map((err, i) => (
                <li key={i}>- {err}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
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
        <div className="bg-muted/30 rounded p-2">
          <p className="text-xs font-mono whitespace-pre-wrap">{rec.fixInstruction}</p>
        </div>
      </CardContent>
    </Card>
  );
}
