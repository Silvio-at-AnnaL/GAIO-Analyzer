import { useEffect, useState } from "react";
import { useGetAnalysisReport, getGetAnalysisReportQueryKey } from "@workspace/api-client-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScoreDonut } from "@/components/charts/ScoreDonut";
import { RadarDimensions } from "@/components/charts/RadarDimensions";
import { generateHtmlReport, buildFaqDocumentHtml, buildKontaktDocumentHtml, buildAnalyseparameterDocumentHtml, type InputParams } from "@/lib/report-export";
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";
import {
  Loader2, CheckCircle2, XCircle, FileText, Globe, Star, AlertCircle, AlertTriangle,
  Info, Clock, ChevronDown, ChevronUp, ExternalLink,
} from "lucide-react";

/**
 * Computes consistent PDF page and image dimensions from a pixel capture.
 * Page width is always 210mm; height scales proportionally.
 * Image is placed with 12mm margins, so content width = 186mm.
 */
function calcPdfDimensions(
  captureHeightPx: number,
  captureWidthPx = 1200,
): { pageW: number; pageH: number; imgX: number; imgY: number; imgW: number; imgH: number } {
  const pageW = 210;
  const margin = 12;
  const imgW = pageW - margin * 2; // 186mm
  const ratio = captureHeightPx / captureWidthPx;
  return { pageW, pageH: ratio * pageW, imgX: margin, imgY: margin, imgW, imgH: ratio * imgW };
}

const MODULE_NAMES = [
  "Crawling Website",
  "Technisches SEO",
  "Schema.org / Strukturierte Daten",
  "Heading-Struktur",
  "Inhaltliche Relevanz (KI-Analyse)",
  "FAQ-Qualität",
  "LLM-Auffindbarkeit",
  "Wettbewerbsvergleich",
  "Empfehlungen generieren",
];

function ProgressView({ analysisId, onComplete }: { analysisId: string; onComplete: () => void }) {
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [currentModuleName, setCurrentModuleName] = useState<string | null>(null);
  const { domainForm } = useAppStore();

  const { data: report } = useGetAnalysisReport(analysisId, {
    query: {
      enabled: !!analysisId,
      queryKey: getGetAnalysisReportQueryKey(analysisId),
      refetchInterval: 400,
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
      // Sweep: mark every step as completed so the UI never shows grey circles when done.
      setCompletedModules(MODULE_NAMES);
      setTimeout(() => onComplete(), 400);
    }
  }, [report, currentModuleName, completedModules, onComplete]);

  const progress = report?.progress ?? 0;
  const isFailed = report?.status === "failed";

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {isFailed
            ? "Analyse fehlgeschlagen"
            : `Analyse für ${domainForm.companyName?.trim() || domainForm.url || report?.url || "…"} läuft…`}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {report?.url ? `Crawle ${report.url}` : "Verarbeite Daten…"}
        </p>
        {!isFailed && (
          <div className="text-sm mt-4 mb-6 space-y-3" style={{ color: "hsl(var(--foreground))" }}>
            <p>
              Die von mir jetzt durchzuführende{" "}
              <i><b>Analyse</b></i> ist wirklich sehr umfangreich und{" "}
              <i><b>kann bis zu 10 Minuten dauern</b></i>.{" "}
              Insbesondere ganz am Ende — bei den „Empfehlungen generieren" — wird Ihre Geduld
              wahrscheinlich wirklich auf die Probe gestellt! Aber gerade da soll ich ja auch
              besonders genau sein, oder?
            </p>
            <p>Aber: Nicht verzweifeln — bisher habe ich noch jede Analyse zu Ende gebracht!</p>
            <p>
              Wie wäre es, wenn Sie sich in der Zwischenzeit einen Kaffee, Tee oder — je nach
              Tageszeit — ein anderes Getränk holen und mich kurz arbeiten lassen?
            </p>
            <p>
              <b>Wichtig:</b> Bitte schließen Sie diesen Tab oder dieses Fenster auf keinen Fall,
              da ich sonst ebenfalls gehe … und dann müssten wir noch einmal von vorne anfangen.
            </p>
          </div>
        )}
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

// ─── Change C1: Traffic light rating ─────────────────────────────────────────

type TrafficLightType = "responseTime" | "ttfb";

function getTrafficLight(value: number, type: TrafficLightType) {
  if (type === "responseTime") {
    if (value < 400) return { dot: "🟢", label: "Gut", className: "text-green-600 dark:text-green-400" };
    if (value <= 800) return { dot: "🟡", label: "Akzeptabel", className: "text-yellow-600 dark:text-yellow-400" };
    return { dot: "🔴", label: "Kritisch", className: "text-red-600 dark:text-red-400" };
  }
  // ttfb
  if (value < 200) return { dot: "🟢", label: "Gut", className: "text-green-600 dark:text-green-400" };
  if (value <= 500) return { dot: "🟡", label: "Akzeptabel", className: "text-yellow-600 dark:text-yellow-400" };
  return { dot: "🔴", label: "Kritisch", className: "text-red-600 dark:text-red-400" };
}

function TrafficLightValue({ value, type }: { value: number; type: TrafficLightType }) {
  const { dot, label, className } = getTrafficLight(value, type);
  return (
    <span className={`text-sm font-bold font-mono ${className}`}>
      {value} ms {dot} {label}
    </span>
  );
}

// ─── Change C2: Metric label with tooltip ─────────────────────────────────────

function MetricLabelWithTooltip({ label, tooltip }: { label: string; tooltip: string }) {
  const [show, setShow] = useState(false);
  return (
    <span className="inline-flex items-center gap-1 relative">
      <span className="text-xs text-muted-foreground">{label}</span>
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        aria-label={`Info: ${label}`}
      >
        <Info className="w-3 h-3" />
      </button>
      {show && (
        <div
          className="absolute bottom-full left-0 mb-2 z-50 w-72 rounded-md border border-border bg-popover shadow-lg p-3 text-xs text-popover-foreground leading-relaxed whitespace-normal"
          role="tooltip"
        >
          {tooltip}
        </div>
      )}
    </span>
  );
}

// ─── Change B3: Competitor crawled pages list ─────────────────────────────────

function CompetitorCrawledPages({ pages }: { pages: Array<{ url: string; title: string | null }> }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Analysierte Seiten</p>
      <div className="rounded-lg border border-border overflow-hidden">
        {pages.map((page, i) => {
          let displayPath = page.url;
          try { displayPath = new URL(page.url).pathname || page.url; } catch { /* keep url */ }
          return (
            <a
              key={page.url}
              href={page.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
              style={{ background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.15)" }}
            >
              <ExternalLink className="w-3 h-3 shrink-0 text-primary" />
              <span className="text-primary hover:underline truncate">
                {page.title || displayPath}
              </span>
            </a>
          );
        })}
      </div>
    </div>
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
    crawledPages?: Array<{ url: string; title: string | null }>;
    findings?: { betterThanYou: string; yourAdvantage: string; recommendation: string } | null;
    error?: string;
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
  if (competitor.error) {
    return (
      <Card className="border-border/50 opacity-75">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src={`https://www.google.com/s2/favicons?domain=${competitor.url}&sz=32`}
                alt=""
                className="w-5 h-5 rounded shrink-0 grayscale"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span className="font-bold text-base truncate text-muted-foreground">{competitor.name}</span>
            </div>
            <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold tracking-wide bg-muted text-muted-foreground border border-border">
              Nicht erreichbar
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Diese Domain konnte nicht gecrawlt werden (Timeout, Zugriffsblockierung oder ungültige URL).{" "}
            <a href={competitor.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
              {competitor.url} <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </CardContent>
      </Card>
    );
  }

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

        {/* B3: Crawled pages list */}
        {competitor.crawledPages && competitor.crawledPages.length > 0 && (
          <CompetitorCrawledPages pages={competitor.crawledPages} />
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

function CrawledPagesPanel({ pages, pdfMode = false }: { pages: string[]; pdfMode?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const expanded = isOpen || pdfMode;

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/30 transition-colors text-left"
      >
        <span>Gecrawlte Seiten ({pages.length} Seiten)</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="border-t border-border overflow-visible">
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

interface HreflangVariant { lang: string; url: string; }

const LANG_INFO: Record<string, { flag: string; name: string }> = {
  "x-default": { flag: "🌐", name: "Default" },
  de: { flag: "🇩🇪", name: "Deutsch" },
  en: { flag: "🇬🇧", name: "English" },
  fr: { flag: "🇫🇷", name: "Français" },
  es: { flag: "🇪🇸", name: "Español" },
  it: { flag: "🇮🇹", name: "Italiano" },
  pl: { flag: "🇵🇱", name: "Polski" },
  zh: { flag: "🇨🇳", name: "中文" },
  pt: { flag: "🇵🇹", name: "Português" },
  nl: { flag: "🇳🇱", name: "Nederlands" },
  ja: { flag: "🇯🇵", name: "日本語" },
  ko: { flag: "🇰🇷", name: "한국어" },
  ru: { flag: "🇷🇺", name: "Русский" },
  ar: { flag: "🇸🇦", name: "العربية" },
  tr: { flag: "🇹🇷", name: "Türkçe" },
  sv: { flag: "🇸🇪", name: "Svenska" },
  da: { flag: "🇩🇰", name: "Dansk" },
  fi: { flag: "🇫🇮", name: "Suomi" },
  nb: { flag: "🇳🇴", name: "Norsk" },
  no: { flag: "🇳🇴", name: "Norsk" },
  cs: { flag: "🇨🇿", name: "Čeština" },
  sk: { flag: "🇸🇰", name: "Slovenčina" },
  hu: { flag: "🇭🇺", name: "Magyar" },
  ro: { flag: "🇷🇴", name: "Română" },
  bg: { flag: "🇧🇬", name: "Български" },
  hr: { flag: "🇭🇷", name: "Hrvatski" },
  uk: { flag: "🇺🇦", name: "Українська" },
  el: { flag: "🇬🇷", name: "Ελληνικά" },
  he: { flag: "🇮🇱", name: "עברית" },
  th: { flag: "🇹🇭", name: "ไทย" },
  vi: { flag: "🇻🇳", name: "Tiếng Việt" },
  id: { flag: "🇮🇩", name: "Bahasa Indonesia" },
  ms: { flag: "🇲🇾", name: "Bahasa Melayu" },
};

function regionToFlag(regionCode: string): string {
  return regionCode
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 127397))
    .join("");
}

function getLangBadgeInfo(langTag: string): { flag: string; name: string } {
  if (langTag === "x-default") return { flag: "🌐", name: "Default" };

  const parts = langTag.split("-");
  const baseLang = parts[0].toLowerCase();
  const region = parts.length > 1 ? parts[parts.length - 1] : null;

  const baseName = LANG_INFO[baseLang]?.name ?? langTag;

  if (region && region.length === 2 && /^[A-Za-z]+$/.test(region)) {
    return { flag: regionToFlag(region), name: baseName };
  }

  return LANG_INFO[baseLang] ?? { flag: "🌐", name: langTag };
}

function HreflangVariantsPanel({ variants }: { variants: HreflangVariant[] }) {
  const uniqueLangs = Array.from(new Map(variants.map((v) => [v.lang, v])).keys());

  const sorted = [...uniqueLangs].sort((a, b) => {
    if (a === "x-default") return -1;
    if (b === "x-default") return 1;
    return a.localeCompare(b);
  });

  return (
    <div className="rounded-lg border border-border px-4 py-3 space-y-2.5">
      <p className="text-sm font-medium">Erkannte Sprachvarianten der Website</p>
      {uniqueLangs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine Sprachvarianten dieser Website gefunden.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {sorted.map((lang) => {
              const { flag, name } = getLangBadgeInfo(lang);
              return (
                <span
                  key={lang}
                  title={lang}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground select-none"
                >
                  <span style={{ fontSize: "1rem", lineHeight: 1 }}>{flag}</span>
                  {name}
                </span>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {uniqueLangs.length} Sprachvarianten erkannt — URLs gespeichert für spätere Mehrsprachenanalyse
          </p>
        </>
      )}
    </div>
  );
}

// ── Shared export filename helpers ────────────────────────────────────────────

/** Strip protocol/www, replace dots+slashes with underscores. */
function formatDomainForFilename(url: string | null | undefined): string {
  return (url ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .replace(/\./g, "_")
    .replace(/\//g, "_") || "report";
}

/** Fetch a URL and return it as a base64 data-URI string (empty string on failure). */
async function fetchAsBase64(url: string): Promise<string> {
  try {
    const res  = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return "";
  }
}

/** Build the timestamp portion `DD-MM-YYYY--HH-MM-SS` from local time. */
function buildExportTimestamp(d: Date = new Date()): string {
  const dd   = String(d.getDate()).padStart(2, "0");
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, "0");
  const min  = String(d.getMinutes()).padStart(2, "0");
  const ss   = String(d.getSeconds()).padStart(2, "0");
  return `${dd}-${mm}-${yyyy}--${hh}-${min}-${ss}`;
}

function ReportView({ analysisId }: { analysisId: string }) {
  const { setCrawledPages, setSelectedPages, domainForm } = useAppStore();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingHtml, setExportingHtml] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pdfMode, setPdfMode] = useState(false);

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
      crawledPages?: Array<{ url: string; title: string | null }>;
      findings?: { betterThanYou: string; yourAdvantage: string; recommendation: string } | null;
      error?: string;
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
  type LlmQ = { question: string; rating: number; gap: string; sourceUrl?: string | null };
  type LlmPart = { label: string; weight: number; avgRating: number; score: number; questions: LlmQ[] };
  const llmQuestions = (llmDiscoverability?.questions as LlmQ[]) || [];
  const llmPartA = (llmDiscoverability?.partA as LlmPart | undefined);
  const llmPartB = (llmDiscoverability?.partB as LlmPart | undefined);
  const llmAvgRating = (llmDiscoverability?.avgRating as number | undefined) ?? 0;

  const myDomain = report.url ? (() => { try { return new URL(report.url!).hostname; } catch { return "Ihre Seite"; } })() : "Ihre Seite";

  const competitorChartData = competitorComparison ? [
    { name: myDomain, compositeScore: report.overallScore ?? 0, isMain: true },
    ...competitorComparison.competitors.map((c) => ({ name: c.name, compositeScore: c.compositeScore, isMain: false })),
  ].sort((a, b) => b.compositeScore - a.compositeScore) : [];

  const captureSvg = (selector: string): string | null => {
    const el = document.querySelector(selector) as SVGElement | null;
    if (!el) return null;
    try {
      const clone = el.cloneNode(true) as SVGElement;
      // Inline computed styles so the export renders without external CSS.
      const allOriginals = el.querySelectorAll("*");
      const allClones = clone.querySelectorAll("*");
      allOriginals.forEach((orig, i) => {
        const cs = window.getComputedStyle(orig);
        const target = allClones[i] as SVGElement | undefined;
        if (!target) return;
        const styleProps = ["fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-family", "font-weight", "color"];
        let inline = "";
        styleProps.forEach((p) => {
          const v = cs.getPropertyValue(p);
          if (v) inline += `${p}:${v};`;
        });
        if (inline) target.setAttribute("style", inline);
      });
      if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      return new XMLSerializer().serializeToString(clone);
    } catch {
      return null;
    }
  };

  // ── PDF export via jsPDF + html2canvas ──────────────────────────────────────
  const handlePdfExport = async () => {
    setExportingPdf(true);
    setExportError(null);
    setPdfMode(true);
    // Wait for React to re-render charts without animations before capture.
    await new Promise((r) => setTimeout(r, 500));
    const PANEL_SELECTOR = '[role="tabpanel"]';
    let overlay: HTMLElement | null = null;

    // Saved state for guaranteed restore in finally.
    let savedPanels: HTMLElement[] = [];
    let savedPanelStyles: Array<{
      display: string; visibility: string; opacity: string;
      position: string; height: string; overflow: string;
      width: string; minHeight: string;
    }> = [];
    let savedSidebar: HTMLElement | null = null;
    let savedSidebarDisplay = "";
    let savedScrollY = 0;

    // Helper: clean up overlay if it was created.
    const removeOverlay = () => {
      if (overlay && overlay.parentNode) {
        document.body.removeChild(overlay);
        overlay = null;
      }
    };

    // Helper: restore panels & sidebar to original state.
    const restoreDom = () => {
      savedPanels.forEach((panel, i) => {
        panel.style.display    = savedPanelStyles[i].display;
        panel.style.visibility = savedPanelStyles[i].visibility;
        panel.style.opacity    = savedPanelStyles[i].opacity;
        panel.style.position   = savedPanelStyles[i].position;
        panel.style.height     = savedPanelStyles[i].height;
        panel.style.overflow   = savedPanelStyles[i].overflow;
        panel.style.width      = savedPanelStyles[i].width;
        panel.style.minHeight  = savedPanelStyles[i].minHeight;
      });
      if (savedSidebar) savedSidebar.style.display = savedSidebarDisplay;
      window.scrollTo(0, savedScrollY);
    };

    try {
      console.log("PDF export started");

      // Dynamic imports keep the bundle lean.
      const [{ toJpeg }, { default: jsPDF }] = await Promise.all([
        import("html-to-image"),
        import("jspdf"),
      ]);

      // Tab label map — keep in sync with TabsContent value props.
      const TAB_LABELS: Record<string, string> = {
        details: "Details",
        llm: "LLM-Auffindbarkeit",
        competitors: "Wettbewerb",
        recommendations: "Empfehlungen",
      };

      // Throw early with a visible message if no panels found.
      const panels = Array.from(document.querySelectorAll<HTMLElement>(PANEL_SELECTOR));
      console.log("Panels found:", panels.length, "selector:", PANEL_SELECTOR);
      if (!panels || panels.length === 0) {
        throw new Error(`Keine Tab-Panels gefunden. Selektor: ${PANEL_SELECTOR}`);
      }

      // ── Full-screen overlay so the user sees a clean loading screen ──────────
      overlay = document.createElement("div");
      overlay.id = "pdf-overlay";
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "background:rgba(255,255,255,0.92)",
        "z-index:99999",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "font-family:inherit",
        "font-size:1.1rem",
        "color:#333",
        "flex-direction:column",
        "gap:8px",
      ].join(";");
      overlay.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
        <span>PDF wird erstellt…</span>
      `;
      document.body.appendChild(overlay);

      // Save sidebar and scroll state into outer-scoped vars (used by restoreDom in finally).
      savedSidebar      = document.querySelector<HTMLElement>("aside");
      savedScrollY      = window.scrollY;
      savedSidebarDisplay = savedSidebar?.style.display ?? "";
      if (savedSidebar) savedSidebar.style.display = "none";

      // Save all panel styles, then force every panel visible for capture.
      savedPanels       = panels;
      savedPanelStyles  = panels.map((panel) => ({
        display:    panel.style.display,
        visibility: panel.style.visibility,
        opacity:    panel.style.opacity,
        position:   panel.style.position,
        height:     panel.style.height,
        overflow:   panel.style.overflow,
        width:      panel.style.width,
        minHeight:  panel.style.minHeight,
      }));
      panels.forEach((panel) => {
        panel.style.display    = "block";
        panel.style.visibility = "visible";
        panel.style.opacity    = "1";
        panel.style.position   = "relative";
        panel.style.height     = "auto";
        panel.style.overflow   = "visible";
      });

      // Full repaint before capture.
      await new Promise((r) => setTimeout(r, 300));

      // ── Capture the results header (donut + radar + score cards) ──────────────
      const CAPTURE_WIDTH_PX = 1200;
      const PDF_MM_W = 210;
      const MARGIN_MM = 12;                           // uniform margin on all four sides
      const CONTENT_MM_W = PDF_MM_W - MARGIN_MM * 2; // 186mm usable width

      // Shared image filter — excludes scripts, noscripts, and broken images.
      const imageFilter = (node: HTMLElement): boolean => {
        if (node.tagName === "SCRIPT" || node.tagName === "NOSCRIPT") return false;
        if (node.tagName === "IMG") {
          const img = node as HTMLImageElement;
          const isExternal =
            !!img.src &&
            !img.src.startsWith(window.location.origin) &&
            !img.src.startsWith("data:");
          if (isExternal || !img.complete || img.naturalWidth === 0) return false;
        }
        return true;
      };

      // Shared helper: zero-out broken/external images in an element before capture.
      const neutraliseImages = (el: HTMLElement) => {
        el.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
          const isExternal =
            !!img.src &&
            !img.src.startsWith(window.location.origin) &&
            !img.src.startsWith("data:");
          if (isExternal || !img.complete || img.naturalWidth === 0) {
            img.style.visibility = "hidden";
            img.style.width      = "0";
            img.style.height     = "0";
            img.style.minWidth   = "0";
            img.style.minHeight  = "0";
            img.style.padding    = "0";
            img.style.margin     = "0";
            img.style.border     = "none";
            img.style.overflow   = "hidden";
          }
        });
      };

      let headerImgData: string | null = null;
      let headerMmH = 0;

      // ── Build score data for the header iframe ────────────────────────────────
      const hdrScores = {
        gaio:      report.overallScore ?? 0,
        technSeo:  (technicalSeo?.score as number)      ?? 0,
        schema:    (schemaOrg?.score as number)          ?? 0,
        headings:  (headingStructure?.score as number)   ?? 0,
        inhalt:    (contentRelevance?.score as number)   ?? 0,
        faq:       (faqQuality?.score as number)         ?? 0,
        llm:       (llmDiscoverability?.score as number) ?? 0,
      };
      const hdrDomain     = report.url || "";
      const hdrPageCount  = (report.crawledPages as string[] | null)?.length ?? 0;
      const hdrDate       = new Date().toLocaleDateString("de-DE");

      // Pure-SVG helper functions (no Recharts, no DOM dependency) ─────────────
      const buildDonut = (score: number): string => {
        const cx = 130, cy = 130, r = 100;
        const trackLen = Math.PI * r;
        const color = score >= 71 ? '#22c55e' : score >= 41 ? '#f59e0b' : '#ef4444';
        const activeLen = (score / 100) * trackLen;
        const needleAngle = Math.PI * (score / 100 - 1);
        const needleLen = 85;
        const nx = (cx + needleLen * Math.cos(needleAngle)).toFixed(2);
        const ny = (cy + needleLen * Math.sin(needleAngle)).toFixed(2);
        const tickSvg = [0, 25, 50, 75, 100].map(v => {
          const a = Math.PI * (v / 100 - 1);
          const x1 = (cx + 107 * Math.cos(a)).toFixed(2);
          const y1 = (cy + 107 * Math.sin(a)).toFixed(2);
          const x2 = (cx + 99 * Math.cos(a)).toFixed(2);
          const y2 = (cy + 99 * Math.sin(a)).toFixed(2);
          const lx = (cx + 118 * Math.cos(a)).toFixed(2);
          const ly = (cy + 118 * Math.sin(a) + 4).toFixed(2);
          return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="rgba(255,255,255,0.5)" stroke-width="1.5"/>' +
                 '<text x="' + lx + '" y="' + ly + '" text-anchor="middle" font-size="9" fill="rgba(255,255,255,0.4)" font-family="DM Sans,sans-serif">' + v + '</text>';
        }).join('');
        return '<div style="background:#1e2235;border-radius:12px;padding:20px 24px 14px;display:inline-block">' +
          '<svg width="260" height="165" viewBox="0 0 260 165">' +
          '<defs>' +
          '<linearGradient id="pdR" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#ef4444" stop-opacity="0.7"/><stop offset="100%" stop-color="#ef4444" stop-opacity="0.2"/></linearGradient>' +
          '<linearGradient id="pdA" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#f59e0b" stop-opacity="0.5"/><stop offset="100%" stop-color="#f59e0b" stop-opacity="0.2"/></linearGradient>' +
          '<linearGradient id="pdG" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#22c55e" stop-opacity="0.2"/><stop offset="100%" stop-color="#22c55e" stop-opacity="0.7"/></linearGradient>' +
          '</defs>' +
          '<path d="M 30 130 A 100 100 0 0 1 230 130" fill="none" stroke="url(#pdR)" stroke-width="14" stroke-linecap="butt" stroke-dasharray="' + (trackLen * 0.4).toFixed(2) + ' ' + trackLen.toFixed(2) + '"/>' +
          '<path d="M 30 130 A 100 100 0 0 1 230 130" fill="none" stroke="url(#pdA)" stroke-width="14" stroke-linecap="butt" stroke-dasharray="' + (trackLen * 0.3).toFixed(2) + ' ' + trackLen.toFixed(2) + '" stroke-dashoffset="' + (-trackLen * 0.4).toFixed(2) + '"/>' +
          '<path d="M 30 130 A 100 100 0 0 1 230 130" fill="none" stroke="url(#pdG)" stroke-width="14" stroke-linecap="butt" stroke-dasharray="' + (trackLen * 0.3).toFixed(2) + ' ' + trackLen.toFixed(2) + '" stroke-dashoffset="' + (-trackLen * 0.7).toFixed(2) + '"/>' +
          '<path d="M 30 130 A 100 100 0 0 1 230 130" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="15" stroke-linecap="round"/>' +
          '<path d="M 30 130 A 100 100 0 0 1 230 130" fill="none" stroke="' + color + '" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + activeLen.toFixed(2) + ' ' + trackLen.toFixed(2) + '"/>' +
          tickSvg +
          '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx + '" y2="' + ny + '" stroke="white" stroke-width="2.5" stroke-linecap="round"/>' +
          '<polygon points="' + (cx - 6) + ',' + cy + ' ' + (cx + 6) + ',' + cy + ' ' + cx + ',' + (cy - 12) + '" fill="white" opacity="0.9"/>' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="#1e2235" stroke="white" stroke-width="2"/>' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="3" fill="white"/>' +
          '<text x="' + cx + '" y="112" text-anchor="middle" font-size="36" font-weight="800" fill="' + color + '" font-family="DM Sans,sans-serif">' + score + '</text>' +
          '<rect x="28" y="150" width="7" height="5" rx="1" fill="#ef4444" opacity="0.8"/>' +
          '<text x="39" y="156" font-size="8.5" fill="rgba(255,255,255,0.4)" font-family="DM Sans,sans-serif">Kritisch</text>' +
          '<rect x="90" y="150" width="7" height="5" rx="1" fill="#f59e0b" opacity="0.8"/>' +
          '<text x="101" y="156" font-size="8.5" fill="rgba(255,255,255,0.4)" font-family="DM Sans,sans-serif">Ausbauf\u00e4hig</text>' +
          '<rect x="165" y="150" width="7" height="5" rx="1" fill="#22c55e" opacity="0.8"/>' +
          '<text x="176" y="156" font-size="8.5" fill="rgba(255,255,255,0.4)" font-family="DM Sans,sans-serif">Stark</text>' +
          '</svg></div>';
      };

      const buildRadar = (s: typeof hdrScores): string => {
        const size = 260, cx = 130, cy = 130, maxR = 90;
        const axes = [
          { label: "Techn. SEO", val: s.technSeo },
          { label: "Schema.org", val: s.schema },
          { label: "Headings",   val: s.headings },
          { label: "Inhalt",     val: s.inhalt },
          { label: "FAQ",        val: s.faq },
          { label: "LLM",        val: s.llm },
        ];
        const n = axes.length;
        const pt = (i: number, r: number) => {
          const a = (i / n) * 2 * Math.PI - Math.PI / 2;
          return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
        };
        const polyPath = (r: number) =>
          Array.from({ length: n }, (_, i) => pt(i, r))
            .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(" ") + " Z";
        const gridLines = [25, 50, 75, 100]
          .map((lvl) => `<path d="${polyPath((lvl / 100) * maxR)}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`)
          .join("");
        const axisLines = axes
          .map((_, i) => {
            const end = pt(i, maxR);
            return `<line x1="${cx}" y1="${cy}" x2="${end.x.toFixed(1)}" y2="${end.y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
          })
          .join("");
        const dataPts = axes.map((ax, i) => pt(i, (ax.val / 100) * maxR));
        const dataPath = dataPts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + " Z";
        const labels = axes
          .map((ax, i) => {
            const p = pt(i, maxR + 20);
            const anchor = p.x < cx - 5 ? "end" : p.x > cx + 5 ? "start" : "middle";
            return `<text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="${anchor}"
              font-size="11" font-family="-apple-system,sans-serif" fill="#6b7280">${ax.label}</text>`;
          })
          .join("");
        return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
          ${gridLines}${axisLines}
          <path d="${dataPath}" fill="#3b82f6" fill-opacity="0.2" stroke="#3b82f6" stroke-width="2"/>
          ${labels}
        </svg>`;
      };

      const buildScoreTiles = (s: typeof hdrScores): string => {
        const color = (v: number) => v >= 76 ? "#65a30d" : v >= 61 ? "#ca8a04" : v >= 41 ? "#d97706" : "#dc2626";
        return ([
          ["Techn. SEO", s.technSeo],
          ["Schema.org", s.schema],
          ["Headings",   s.headings],
          ["Inhalt",     s.inhalt],
          ["FAQ",        s.faq],
          ["LLM",        s.llm],
        ] as [string, number][])
          .map(([label, val]) => `<div class="score-tile">
            <div class="label">${label}</div>
            <div class="val" style="color:${color(val)}">${val}</div>
          </div>`)
          .join("");
      };

      const buildHeaderIframeHtml = (): string => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system,'Segoe UI',sans-serif; background:#fff; width:1200px; padding:24px 32px; color:#1a1d23; }
.header-meta { font-size:12px; color:#787b86; margin-bottom:20px; }
.charts-row { display:flex; gap:24px; margin-bottom:20px; }
.chart-card { flex:1; border:1px solid #dde0e8; border-radius:12px; padding:20px; background:#fff; }
.chart-label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#787b86; margin-bottom:16px; }
.chart-center { display:flex; justify-content:center; align-items:center; }
.scores-row { display:flex; gap:12px; }
.score-tile { flex:1; border:1px solid #dde0e8; border-radius:10px; padding:12px 8px; text-align:center; background:#fff; }
.score-tile .label { font-size:11px; color:#787b86; margin-bottom:6px; }
.score-tile .val { font-size:22px; font-weight:800; }
</style></head><body>
<div class="header-meta">${hdrDomain} · ${hdrPageCount} Seiten · ${hdrDate}</div>
<div class="charts-row">
  <div class="chart-card"><div class="chart-label">GAIO SCORE</div><div class="chart-center">${buildDonut(hdrScores.gaio)}</div></div>
  <div class="chart-card"><div class="chart-label">DIMENSIONEN</div><div class="chart-center">${buildRadar(hdrScores)}</div></div>
</div>
<div class="scores-row">${buildScoreTiles(hdrScores)}</div>
</body></html>`;

      // ── Render header into an off-screen iframe and capture ───────────────────
      const headerIframe = document.createElement("iframe");
      headerIframe.style.cssText = "position:fixed;left:-9999px;top:0;width:1200px;height:600px;border:none;opacity:0;";
      document.body.appendChild(headerIframe);
      try {
        const hDoc = headerIframe.contentDocument!;
        hDoc.open();
        hDoc.write(buildHeaderIframeHtml());
        hDoc.close();

        await new Promise((r) => setTimeout(r, 800));

        const hBody = hDoc.body as HTMLBodyElement;
        const hH = Math.max(hBody.scrollHeight, hBody.offsetHeight) + 40;
        headerIframe.style.height = `${hH}px`;
        await new Promise((r) => setTimeout(r, 300));

        console.log("Header height:", hH);
        if (hH > 0) {
          headerImgData = await toJpeg(hBody, {
            quality: 0.92,
            backgroundColor: "#ffffff",
            pixelRatio: 1.5,
            skipFonts: true,
          });
          headerMmH = (hH / CAPTURE_WIDTH_PX) * CONTENT_MM_W;
          console.log("Header captured:", CAPTURE_WIDTH_PX, "x", hH, "→", CONTENT_MM_W.toFixed(1), "x", headerMmH.toFixed(1), "mm");
        }
      } catch (hErr) {
        console.warn("Header capture failed:", hErr);
      } finally {
        document.body.removeChild(headerIframe);
      }

      // ── Capture each panel directly (original elements, real styles) ──────────
      type PageData = {
        imgData: string | null;
        mmW: number;
        mmH: number;
        tabValue: string;
      };
      const pages: PageData[] = [];
      const currentDateString = new Date().toLocaleDateString("de-DE");

      for (const panel of panels) {
        const tabValue = panel.id?.replace(/^.*-content-/, "") ?? "tab";

        // FIX 1 — Force a synchronous layout reflow so scrollHeight is accurate.
        panel.style.width    = "1200px";
        panel.style.minHeight = "100px";
        void panel.offsetHeight; // triggers synchronous reflow
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        );

        // FIX 2 — Use offsetHeight as fallback if scrollHeight is still 0.
        const captureWidth  = 1200;
        const captureHeight = panel.scrollHeight > 0 ? panel.scrollHeight : panel.offsetHeight;

        console.log(`Panel "${tabValue}" innerHTML length: ${panel.innerHTML.length}, height: ${captureHeight}`);

        if (captureHeight === 0) {
          console.warn("Panel has zero height after reflow — skipping:", tabValue);
          pages.push({ imgData: null, mmW: 210, mmH: 80, tabValue });
          continue;
        }

        // FIX 4 — Give React time to finish any pending re-renders.
        await new Promise((r) => setTimeout(r, 400));

        // Neutralise all broken/external images before capture.
        neutraliseImages(panel);

        // CHANGE 4 — Inject footer div so it appears at the bottom of each captured page.
        const footerEl = document.createElement("div");
        footerEl.id = "pdf-footer-injected";
        footerEl.style.cssText =
          "width:100%;margin-top:32px;padding-top:12px;border-top:1px solid #dde0e8;" +
          "font-size:11px;color:#9ca3af;text-align:left;font-family:-apple-system,sans-serif;";
        footerEl.textContent =
          "IndustryStock.com/GAIO-Analyzer · Exportiert am " + currentDateString;
        panel.appendChild(footerEl);
        // FIX B — Add explicit bottom padding so footer is never clipped.
        panel.style.paddingBottom = "80px";
        void panel.offsetHeight;
        await new Promise((r) => setTimeout(r, 300));

        // FIX A — Measure AFTER footer + padding; add +120px buffer.
        const captureHeightPx = panel.scrollHeight + 120;

        // Individual try/catch — never abort the whole loop.
        let imgData: string | null = null;
        try {
          imgData = await toJpeg(panel, {
            quality: 0.92,
            backgroundColor: "#ffffff",
            pixelRatio: 1.5,
            width: captureWidth,
            height: captureHeightPx,
            skipFonts: true,
            filter: imageFilter,
          });
        } catch (imgErr) {
          console.warn("html-to-image failed for panel:", tabValue, imgErr);
          imgData = null;
        } finally {
          const injected = panel.querySelector("#pdf-footer-injected");
          if (injected) panel.removeChild(injected);
          // FIX B — Restore padding after capture.
          panel.style.paddingBottom = "";
        }

        const mmW = PDF_MM_W; // always 210mm — full page width
        // Use CONTENT_MM_W (186) for correct aspect ratio: image is placed at 186mm wide.
        const mmH = (captureHeightPx / captureWidth) * CONTENT_MM_W;

        console.log("Captured panel:", tabValue, "dimensions:", captureWidth, "x", captureHeightPx, "→", mmW.toFixed(1), "x", mmH.toFixed(1), "mm");

        if (!imgData || mmH <= 0 || !isFinite(mmH)) {
          pages.push({ imgData: null, mmW, mmH: 80, tabValue });
        } else {
          pages.push({ imgData, mmW, mmH, tabValue });
        }
      }

      // Restore DOM before building the PDF (also runs in finally for error safety).
      restoreDom();

      console.log("All panels captured:", pages.length);

      // ── Pre-fetch Kontakt images as base64 (for FAQ-less pages these are quick) ──
      const base = import.meta.env.BASE_URL;
      const [kontaktLogoB64, kontaktProfileB64] = await Promise.all([
        fetchAsBase64(base + "brand-logo.png"),
        fetchAsBase64(base + "kontakt-silvio.webp"),
      ]);

      // ── Capture FAQ page via iframe (full HTML document with stylesheet) ────────
      type FaqCapture = { imgData: string; captureHeightPx: number } | null;
      let faqCapture: FaqCapture = null;
      const faqIframe = document.createElement("iframe");
      try {
        faqIframe.style.cssText = [
          "position:fixed",
          "left:-9999px",
          "top:0",
          `width:${CAPTURE_WIDTH_PX}px`,
          "height:2000px",
          "border:none",
          "opacity:0",
        ].join(";");
        document.body.appendChild(faqIframe);

        // Write the self-contained HTML document into the iframe.
        const faqDoc = faqIframe.contentDocument!;
        faqDoc.open();
        faqDoc.write(buildFaqDocumentHtml());
        faqDoc.close();

        // Let the browser finish painting all content (tables need time).
        await new Promise((r) => setTimeout(r, 1000));

        const faqBody = faqDoc.body as HTMLBodyElement;
        const faqH = Math.max(faqBody.scrollHeight, faqBody.offsetHeight);
        console.log("FAQ iframe height:", faqH, "scrollHeight:", faqBody.scrollHeight, "offsetHeight:", faqBody.offsetHeight);
        if (faqH === 0) {
          console.warn("FAQ iframe body height is 0 — content may not have loaded");
        }

        if (faqH > 0) {
          // Resize iframe to content height + 60px breathing room, then wait for reflow.
          faqIframe.style.height = `${faqH + 60}px`;
          await new Promise((r) => setTimeout(r, 300));

          const faqJpeg = await toJpeg(faqBody, {
            quality: 0.92,
            backgroundColor: "#ffffff",
            pixelRatio: 1.5,
            width: CAPTURE_WIDTH_PX,
            height: faqH + 60,
            skipFonts: true,
          });
          faqCapture = { imgData: faqJpeg, captureHeightPx: faqH + 60 };
          console.log("FAQ page captured:", CAPTURE_WIDTH_PX, "x", faqH + 60, "px");
        }
      } catch (faqErr) {
        console.warn("FAQ page capture failed:", faqErr);
      } finally {
        if (faqIframe.parentNode) document.body.removeChild(faqIframe);
      }

      // ── Capture Analyseparameter page via iframe ──────────────────────────────
      const pdfInputParams: InputParams = {
        domainUrl: String(report.url ?? ""),
        companyName: domainForm.companyName.trim() || null,
        targetAudience: domainForm.personas.trim() || null,
        competitors: domainForm.competitors.filter((c) => c.trim()),
        socialMedia: Object.fromEntries(
          Object.entries(domainForm.social).filter(([, v]) => v.trim())
        ),
        analysisDate: new Date().toLocaleString("de-DE"),
        crawledPagesCount: (report.crawledPages as string[])?.length ?? 0,
      };

      type AnalyseparameterCapture = { imgData: string; captureHeightPx: number } | null;
      let analyseparameterCapture: AnalyseparameterCapture = null;
      const analyseparameterIframe = document.createElement("iframe");
      try {
        analyseparameterIframe.style.cssText = [
          "position:fixed",
          "left:-9999px",
          "top:0",
          `width:${CAPTURE_WIDTH_PX}px`,
          "height:2000px",
          "border:none",
          "opacity:0",
        ].join(";");
        document.body.appendChild(analyseparameterIframe);

        const apDoc = analyseparameterIframe.contentDocument!;
        apDoc.open();
        apDoc.write(buildAnalyseparameterDocumentHtml(pdfInputParams));
        apDoc.close();

        await new Promise((r) => setTimeout(r, 800));

        const apBody = apDoc.body as HTMLBodyElement;
        const apH = Math.max(apBody.scrollHeight, apBody.offsetHeight);
        console.log("Analyseparameter iframe height:", apH);

        if (apH > 0) {
          analyseparameterIframe.style.height = `${apH + 60}px`;
          await new Promise((r) => setTimeout(r, 300));

          const apJpeg = await toJpeg(apBody, {
            quality: 0.92,
            backgroundColor: "#ffffff",
            pixelRatio: 1.5,
            width: CAPTURE_WIDTH_PX,
            height: apH + 60,
            skipFonts: true,
          });
          analyseparameterCapture = { imgData: apJpeg, captureHeightPx: apH + 60 };
          console.log("Analyseparameter page captured:", apH + 60, "px");
        }
      } catch (apErr) {
        console.warn("Analyseparameter page capture failed:", apErr);
      } finally {
        if (analyseparameterIframe.parentNode) document.body.removeChild(analyseparameterIframe);
      }

      // ── Capture Kontakt page via iframe ───────────────────────────────────────
      type KontaktCapture = { imgData: string; captureHeightPx: number } | null;
      let kontaktCapture: KontaktCapture = null;
      const kontaktIframe = document.createElement("iframe");
      try {
        kontaktIframe.style.cssText = [
          "position:fixed",
          "left:-9999px",
          "top:0",
          `width:${CAPTURE_WIDTH_PX}px`,
          "height:2000px",
          "border:none",
          "opacity:0",
        ].join(";");
        document.body.appendChild(kontaktIframe);

        const kontaktDoc = kontaktIframe.contentDocument!;
        kontaktDoc.open();
        kontaktDoc.write(buildKontaktDocumentHtml(kontaktLogoB64, kontaktProfileB64));
        kontaktDoc.close();

        await new Promise((r) => setTimeout(r, 1200));

        const kontaktBody = kontaktDoc.body as HTMLBodyElement;
        const kontaktH = Math.max(kontaktBody.scrollHeight, kontaktBody.offsetHeight);
        console.log("Kontakt iframe height:", kontaktH);

        if (kontaktH > 0) {
          // Enforce 1200px width explicitly before capture.
          kontaktIframe.style.width = `${CAPTURE_WIDTH_PX}px`;
          kontaktIframe.style.height = `${kontaktH + 60}px`;
          await new Promise((r) => setTimeout(r, 300));

          const kontaktJpeg = await toJpeg(kontaktBody, {
            quality: 0.92,
            backgroundColor: "#ffffff",
            pixelRatio: 1.5,
            width: CAPTURE_WIDTH_PX,
            height: kontaktH + 60,
            skipFonts: true,
          });
          kontaktCapture = { imgData: kontaktJpeg, captureHeightPx: kontaktH + 60 };
          console.log("Kontakt page captured:", kontaktH + 60, "px");
        }
      } catch (kontaktErr) {
        console.warn("Kontakt page capture failed:", kontaktErr);
      } finally {
        if (kontaktIframe.parentNode) document.body.removeChild(kontaktIframe);
      }

      // CAUSE C — require at least one valid page before touching jsPDF.
      const validPages = pages.filter(
        (p) => p.imgData && p.mmW > 0 && p.mmH > 0
      );
      if (validPages.length === 0) {
        throw new Error(
          `Keine Seiten konnten gerendert werden. Alle ${pages.length} Panels haben leere Canvas.`
        );
      }

      // Build file name using shared helpers.
      const pdfDomain    = formatDomainForFilename(report.url);
      const pdfTimestamp = buildExportTimestamp();
      const today        = new Date().toISOString().slice(0, 10); // kept for the per-page label only

      console.log("Creating jsPDF...");
      const GAP_MM = 4; // vertical gap (mm) between header image and tab content
      const hasHeader = !!headerImgData && headerMmH > 0;
      // Page height = top margin + header (if any) + gap + tab content + bottom margin
      const pageHeight = (tabMmH: number) =>
        MARGIN_MM + (hasHeader ? headerMmH + GAP_MM : 0) + tabMmH + MARGIN_MM;

      const firstValid = validPages[0];
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [PDF_MM_W, pageHeight(firstValid.mmH)],
      });

      pages.forEach((page, idx) => {
        const pgH = pageHeight(page.mmH);
        if (idx > 0) {
          pdf.addPage([PDF_MM_W, pgH], "portrait");
        }

        // Header image — inset by MARGIN_MM on all sides.
        if (hasHeader) {
          pdf.addImage(headerImgData!, "JPEG", MARGIN_MM, MARGIN_MM, CONTENT_MM_W, headerMmH);
        }

        const tabY = MARGIN_MM + (hasHeader ? headerMmH + GAP_MM : 0);

        if (
          page.imgData &&
          typeof page.mmW === "number" && isFinite(page.mmW) && page.mmW > 0 &&
          typeof page.mmH === "number" && isFinite(page.mmH) && page.mmH > 0
        ) {
          pdf.addImage(page.imgData, "JPEG", MARGIN_MM, tabY, CONTENT_MM_W, page.mmH);
        } else {
          pdf.setFontSize(12);
          pdf.setTextColor(150, 150, 150);
          pdf.text("Seite konnte nicht exportiert werden", PDF_MM_W / 2, tabY + page.mmH / 2, { align: "center" });
        }

        // Small label line — sits inside the top margin.
        const tabLabel  = TAB_LABELS[page.tabValue] ?? page.tabValue;
        const labelText = `${report.companyName ?? report.url ?? ""} · ${tabLabel} · ${today}`;
        pdf.setFontSize(7);
        pdf.setTextColor(136, 136, 136);
        pdf.text(labelText, MARGIN_MM, MARGIN_MM - 3);
      });

      // ── FAQ final page ────────────────────────────────────────────────────────
      if (faqCapture) {
        const d = calcPdfDimensions(faqCapture.captureHeightPx);
        pdf.addPage([d.pageW, d.pageH], "portrait");
        pdf.addImage(faqCapture.imgData, "JPEG", d.imgX, d.imgY, d.imgW, d.imgH);
        pdf.setFontSize(7);
        pdf.setTextColor(136, 136, 136);
        pdf.text(`FAQ / So funktioniert's · ${today}`, d.imgX, d.imgY - 3);
      }

      // ── Analyseparameter page (page 6) ───────────────────────────────────────
      if (analyseparameterCapture) {
        const d = calcPdfDimensions(analyseparameterCapture.captureHeightPx);
        pdf.addPage([d.pageW, d.pageH], "portrait");
        pdf.addImage(analyseparameterCapture.imgData, "JPEG", d.imgX, d.imgY, d.imgW, d.imgH);
        pdf.setFontSize(7);
        pdf.setTextColor(136, 136, 136);
        pdf.text(`Analyseparameter · ${today}`, d.imgX, d.imgY - 3);
      }

      // ── Kontakt final page ────────────────────────────────────────────────────
      if (kontaktCapture) {
        const d = calcPdfDimensions(kontaktCapture.captureHeightPx);
        pdf.addPage([d.pageW, d.pageH], "portrait");
        pdf.addImage(kontaktCapture.imgData, "JPEG", d.imgX, d.imgY, d.imgW, d.imgH);
        pdf.setFontSize(7);
        pdf.setTextColor(136, 136, 136);
        pdf.text(`Kontakt · ${today}`, d.imgX, d.imgY - 3);
      }

      // Remove overlay BEFORE triggering download so it doesn't appear in capture.
      removeOverlay();

      console.log("Triggering download...");
      pdf.save(`GAIO-Analyzer-${pdfDomain}--${pdfTimestamp}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      setExportError(
        "PDF-Export fehlgeschlagen: " +
        (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setExportingPdf(false);
      setPdfMode(false);
      // Always restore the DOM and overlay, even if an error occurred mid-capture.
      restoreDom();
      removeOverlay();
    }
  };

  // ── HTML export ──────────────────────────────────────────────────────────────
  const handleHtmlExport = async () => {
    setExportingHtml(true);
    try {
      const filename = `GAIO-Analyzer-${formatDomainForFilename(report.url)}--${buildExportTimestamp()}.html`;

      const htmlBase = import.meta.env.BASE_URL;
      const [htmlLogoB64, htmlProfileB64] = await Promise.all([
        fetchAsBase64(htmlBase + "brand-logo.png"),
        fetchAsBase64(htmlBase + "kontakt-silvio.webp"),
      ]);

      const htmlInputParams: InputParams = {
        domainUrl: String(report.url ?? ""),
        companyName: domainForm.companyName.trim() || null,
        targetAudience: domainForm.personas.trim() || null,
        competitors: domainForm.competitors.filter((c) => c.trim()),
        socialMedia: Object.fromEntries(
          Object.entries(domainForm.social).filter(([, v]) => v.trim())
        ),
        analysisDate: new Date().toLocaleString("de-DE"),
        crawledPagesCount: (report.crawledPages as string[])?.length ?? 0,
      };

      const htmlContent = generateHtmlReport(report as Record<string, unknown>, {
        logoSrc: htmlLogoB64,
        profileSrc: htmlProfileB64,
        inputParams: htmlInputParams,
      });
      const blob = new Blob([htmlContent], { type: "text/html" });
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(dlUrl);
    } finally {
      setExportingHtml(false);
    }
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
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handlePdfExport} disabled={exportingPdf} data-testid="button-export-pdf">
            {exportingPdf ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileText className="w-4 h-4 mr-1.5" />}
            {exportingPdf ? "PDF wird erstellt…" : "Report als PDF exportieren"}
          </Button>
          <Button size="sm" onClick={handleHtmlExport} disabled={exportingHtml} data-testid="button-export-html">
            {exportingHtml ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Globe className="w-4 h-4 mr-1.5" />}
            {exportingHtml ? "Bereite Export vor…" : "Report als HTML exportieren"}
          </Button>
        </div>
      </div>

      {/* PDF export error banner */}
      {exportError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>{exportError}</span>
          <button className="ml-auto shrink-0 opacity-60 hover:opacity-100" onClick={() => setExportError(null)}>✕</button>
        </div>
      )}

      {/* Prompt to re-run */}
      <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/20">
        Basisdaten ändern oder neue Analyse starten? → Wechseln Sie zu <strong>Domainanalyse</strong> oder <strong>HTML-Analyse</strong>.
      </p>

      {/* Score overview + dimension cards — captured as header in PDF */}
      <div id="results-header" className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Left: GAIO Score */}
          <Card className="overflow-hidden">
            <ScoreDonut score={report.overallScore ?? 0} />
          </Card>

          {/* Right: RadarDimensions (col-span-2) */}
          <div className="md:col-span-2">
            <RadarDimensions dimensions={[
              { label: "Techn. SEO", value: radarData[0].value, color: "#ef4444" },
              { label: "Schema.org", value: radarData[1].value, color: "#a855f7" },
              { label: "Headings",   value: radarData[2].value, color: "#3b82f6" },
              { label: "Inhalt",     value: radarData[3].value, color: "#22c55e" },
              { label: "FAQ",        value: radarData[4].value, color: "#f59e0b" },
              { label: "LLM",        value: radarData[5].value, color: "#06b6d4" },
            ]} />
          </div>

        </div>
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
        <TabsContent forceMount value="details" className="space-y-4 pt-4">
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
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} isAnimationActive={!pdfMode} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Gecrawlte Seiten collapsible panel */}
          {report.crawledPages.filter((p) => p !== "uploaded-page").length > 0 && (
            <CrawledPagesPanel pages={report.crawledPages.filter((p) => p !== "uploaded-page")} pdfMode={pdfMode} />
          )}

          {/* Hreflang variants panel — always shown, handles empty state internally */}
          <HreflangVariantsPanel
            variants={(report as { hreflangVariants?: HreflangVariant[] }).hreflangVariants ?? []}
          />

          {technicalSeo && (
            <Card>
              <CardHeader><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technische Details</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {/* C1 + C2: Antwortzeit with traffic light and tooltip */}
                  <div>
                    <MetricLabelWithTooltip
                      label="Antwortzeit"
                      tooltip="Die Antwortzeit misst, wie lange der Server insgesamt braucht, um eine vollständige Seite zu liefern. Unter 400 ms gilt als schnell. Über 800 ms wirkt sich negativ auf SEO und Nutzererfahrung aus."
                    />
                    <TrafficLightValue
                      value={technicalSeo.responseTime as number}
                      type="responseTime"
                    />
                  </div>
                  {/* C1 + C2: TTFB with traffic light and tooltip */}
                  <div>
                    <MetricLabelWithTooltip
                      label="TTFB"
                      tooltip="Time to First Byte (TTFB) misst, wie schnell der Server mit der Auslieferung beginnt — bevor der Browser die Seite aufgebaut hat. Ein niedriger TTFB (unter 200 ms) zeigt gute Server-Performance. Google nutzt TTFB als Qualitätssignal."
                    />
                    <TrafficLightValue
                      value={technicalSeo.ttfb as number}
                      type="ttfb"
                    />
                  </div>
                  {/* Remaining metrics */}
                  {[
                    { label: "robots.txt", val: (technicalSeo.robotsTxt as boolean) ? "✓" : "✗" },
                    { label: "Sitemap", val: (() => { const t = technicalSeo.sitemapType as string; if (t === "xml") return "XML ✓"; if (t === "xml_index") return "XML-Index ✓"; if (t === "html") return "HTML ✓"; return (technicalSeo.sitemapXml as boolean) ? "✓" : "✗"; })() },
                    { label: "llms.txt", val: (technicalSeo.llmsTxt as boolean) ? "✓" : "✗" },
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

          {technicalSeo && (() => {
            type LlmCrawlerStatus = { name: string; status: "allowed" | "disallowed" | "not_mentioned" };
            type RobotsAnalysis = { userAgents: string[]; llmCrawlers: LlmCrawlerStatus[]; siteBlockedAgents: string[]; crawlDelays: Array<{ agent: string; delay: number }>; sitemapUrls: string[]; summary: string };
            type SitemapAnalysis = { type?: "xml" | "xml_index" | "html" | "none"; totalUrls: number; isSitemapIndex: boolean; oldestLastmod: string | null; newestLastmod: string | null; priorityDistribution: Record<string, number>; hasImageSitemap: boolean; hasVideoSitemap: boolean; crawledPageCoverage: number; htmlSitemapUrl?: string | null; htmlSections?: string[]; summary: string };
            type LlmsSection = { name: string; links: Array<{ title: string; url: string; description: string }> };
            type LlmsAnalysis = { present: boolean; title: string | null; description: string | null; sections: LlmsSection[]; linkedPageCount: number; hasDescription: boolean; summary: string };
            const robots = technicalSeo.robotsTxtAnalysis as RobotsAnalysis | null;
            const sitemap = technicalSeo.sitemapXmlAnalysis as SitemapAnalysis | null;
            const llms = technicalSeo.llmsTxtAnalysis as LlmsAnalysis | null;
            const robotsContent = technicalSeo.robotsTxtContent as string | null;
            const sitemapContent = technicalSeo.sitemapXmlContent as string | null;
            const llmsContent = technicalSeo.llmsTxtContent as string | null;
            const statusColor = (s: string) => s === "allowed" ? "text-green-600" : s === "disallowed" ? "text-red-600" : "text-muted-foreground";
            const statusLabel = (s: string) => s === "allowed" ? "Erlaubt" : s === "disallowed" ? "Gesperrt" : "Nicht erwähnt";
            return (
              <Card>
                <CardHeader><CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Technische Dateien</CardTitle></CardHeader>
                <CardContent className="space-y-6">

                  {/* robots.txt */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">robots.txt</span>
                      <Badge variant={(technicalSeo.robotsTxt as boolean) ? "secondary" : "destructive"} className="font-mono text-xs">
                        {(technicalSeo.robotsTxt as boolean) ? "gefunden" : "nicht gefunden"}
                      </Badge>
                    </div>
                    {robots ? (
                      <div className="space-y-3 pl-1">
                        {robots.siteBlockedAgents.length > 0 && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            <strong>Kritisch:</strong> Komplette Sperrung (Disallow: /) für: {robots.siteBlockedAgents.join(", ")}
                          </div>
                        )}
                        <div>
                          <p className="text-xs text-muted-foreground mb-2 font-medium">LLM-Crawler Status</p>
                          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                            {robots.llmCrawlers.map((c) => (
                              <div key={c.name} className="flex items-center justify-between text-xs py-0.5 border-b border-border/40 last:border-0">
                                <span className="font-mono">{c.name}</span>
                                <span className={`font-medium ${statusColor(c.status)}`}>{statusLabel(c.status)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {robots.crawlDelays.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">Crawl-Delay:</span> {robots.crawlDelays.map((d) => `${d.agent}: ${d.delay}s`).join(", ")}
                          </div>
                        )}
                        {robots.sitemapUrls.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">Sitemap-Referenzen:</span> {robots.sitemapUrls.join(", ")}
                          </div>
                        )}
                        {robots.userAgents.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            <span className="font-medium">Erwähnte User-Agents:</span> {robots.userAgents.join(", ")}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground italic">{robots.summary}</p>
                        {robotsContent && !pdfMode && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">Rohdaten anzeigen (erste 500 Zeichen)</summary>
                            <pre className="mt-2 rounded-md bg-muted p-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{robotsContent}</pre>
                          </details>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground pl-1">robots.txt wurde nicht gefunden oder ist nicht erreichbar.</p>
                    )}
                  </div>

                  <div className="border-t border-border/50" />

                  {/* Sitemap */}
                  <div className="space-y-3">
                    {(() => {
                      const sType = (sitemap?.type ?? (technicalSeo.sitemapType as string | undefined)) as "xml" | "xml_index" | "html" | "none" | undefined;
                      const isXml = sType === "xml" || sType === "xml_index";
                      const isHtml = sType === "html";
                      const found = isXml || isHtml;
                      const badgeLabel = sType === "xml" ? "XML" : sType === "xml_index" ? "XML-Index" : sType === "html" ? "HTML-Sitemap" : "nicht gefunden";
                      return (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold">Sitemap</span>
                            <Badge variant={found ? "secondary" : "destructive"} className="font-mono text-xs">{badgeLabel}</Badge>
                          </div>
                          {sitemap && isXml && (
                            <div className="space-y-3 pl-1">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div>
                                  <p className="text-xs text-muted-foreground">URLs gesamt</p>
                                  <p className="text-sm font-bold font-mono">{sitemap.totalUrls}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Typ</p>
                                  <p className="text-sm font-bold">{sitemap.isSitemapIndex ? "Sitemap-Index" : "Einzelne Sitemap"}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Crawl-Abdeckung</p>
                                  <p className="text-sm font-bold font-mono">{sitemap.crawledPageCoverage}%</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Spezial-Typen</p>
                                  <p className="text-sm font-bold">{[sitemap.hasImageSitemap && "Bild", sitemap.hasVideoSitemap && "Video"].filter(Boolean).join(", ") || "—"}</p>
                                </div>
                                {sitemap.oldestLastmod && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Älteste Lastmod</p>
                                    <p className="text-sm font-mono">{sitemap.oldestLastmod.slice(0, 10)}</p>
                                  </div>
                                )}
                                {sitemap.newestLastmod && (
                                  <div>
                                    <p className="text-xs text-muted-foreground">Neueste Lastmod</p>
                                    <p className="text-sm font-mono">{sitemap.newestLastmod.slice(0, 10)}</p>
                                  </div>
                                )}
                                {Object.keys(sitemap.priorityDistribution).length > 0 && (
                                  <div className="col-span-2">
                                    <p className="text-xs text-muted-foreground mb-1">Priority-Verteilung</p>
                                    <div className="flex flex-wrap gap-1">
                                      {Object.entries(sitemap.priorityDistribution).sort(([a], [b]) => parseFloat(b) - parseFloat(a)).map(([val, count]) => (
                                        <Badge key={val} variant="outline" className="font-mono text-xs">{val} × {count}</Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground italic">{sitemap.summary}</p>
                              {sitemapContent && !pdfMode && (
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">Rohdaten anzeigen (erste 500 Zeichen)</summary>
                                  <pre className="mt-2 rounded-md bg-muted p-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{sitemapContent}</pre>
                                </details>
                              )}
                            </div>
                          )}
                          {sitemap && isHtml && (
                            <div className="space-y-3 pl-1">
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {sitemap.htmlSitemapUrl && (
                                  <div className="col-span-2 md:col-span-3">
                                    <p className="text-xs text-muted-foreground">Gefunden unter</p>
                                    <p className="text-sm font-mono break-all">{sitemap.htmlSitemapUrl}</p>
                                  </div>
                                )}
                                <div>
                                  <p className="text-xs text-muted-foreground">Verlinkungen gesamt</p>
                                  <p className="text-sm font-bold font-mono">{sitemap.totalUrls}</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Crawl-Abdeckung</p>
                                  <p className="text-sm font-bold font-mono">{sitemap.crawledPageCoverage}%</p>
                                </div>
                                <div>
                                  <p className="text-xs text-muted-foreground">Struktur-Sektionen</p>
                                  <p className="text-sm font-bold font-mono">{sitemap.htmlSections?.length ?? 0}</p>
                                </div>
                                {sitemap.htmlSections && sitemap.htmlSections.length > 0 && (
                                  <div className="col-span-2 md:col-span-3">
                                    <p className="text-xs text-muted-foreground mb-1">Sektion-Überschriften</p>
                                    <div className="flex flex-wrap gap-1">
                                      {sitemap.htmlSections.map((s, i) => (
                                        <Badge key={i} variant="outline" className="text-xs">{s}</Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground italic">{sitemap.summary}</p>
                              <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
                                HTML-Sitemaps sind nicht maschinenlesbar — Suchmaschinen und LLM-Crawler können sie nicht automatisch verarbeiten. Erstellen Sie zusätzlich eine <span className="font-mono">/sitemap.xml</span>.
                              </div>
                              {sitemapContent && !pdfMode && (
                                <details className="text-xs">
                                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">HTML-Vorschau (erste 500 Zeichen)</summary>
                                  <pre className="mt-2 rounded-md bg-muted p-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{sitemapContent}</pre>
                                </details>
                              )}
                            </div>
                          )}
                          {!sitemap && !found && (
                            <p className="text-xs text-muted-foreground pl-1">Keine Sitemap gefunden (weder XML noch HTML).</p>
                          )}
                          {!sitemap && found && (
                            <p className="text-xs text-muted-foreground pl-1">Sitemap erkannt, aber keine Detailanalyse verfügbar.</p>
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div className="border-t border-border/50" />

                  {/* llms.txt */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">llms.txt</span>
                      <Badge variant={(technicalSeo.llmsTxt as boolean) ? "secondary" : "outline"} className="font-mono text-xs">
                        {(technicalSeo.llmsTxt as boolean) ? "gefunden" : "nicht gefunden"}
                      </Badge>
                    </div>
                    {llms && !llms.present ? (
                      <div className="pl-1 space-y-2">
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <strong>Verpasste Chance:</strong> llms.txt ist ein aufkommender Standard, mit dem Website-Betreiber strukturierte Informationen speziell für LLM-Crawler bereitstellen — ähnlich wie robots.txt, aber mit inhaltlichem Fokus für KI-Systeme wie ChatGPT, Claude und Perplexity.
                        </div>
                        <p className="text-xs text-muted-foreground italic">{llms.summary}</p>
                      </div>
                    ) : llms && llms.present ? (
                      <div className="space-y-3 pl-1">
                        {llms.title && (
                          <div>
                            <p className="text-xs text-muted-foreground">Titel</p>
                            <p className="text-sm font-semibold">{llms.title}</p>
                          </div>
                        )}
                        {llms.description && (
                          <div>
                            <p className="text-xs text-muted-foreground">Beschreibung</p>
                            <p className="text-sm">{llms.description}</p>
                          </div>
                        )}
                        {llms.sections.length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-2 font-medium">Abschnitte ({llms.sections.length})</p>
                            <div className="space-y-2">
                              {llms.sections.map((section, si) => (
                                <div key={si} className="rounded-md border border-border/60 px-3 py-2">
                                  <p className="text-xs font-semibold mb-1">{section.name}</p>
                                  {section.links.length > 0 ? (
                                    <ul className="space-y-0.5">
                                      {section.links.map((link, li) => (
                                        <li key={li} className="text-xs text-muted-foreground">
                                          <span className="font-medium text-foreground">{link.title}</span>
                                          {link.description && <span> — {link.description}</span>}
                                          <span className="ml-1 font-mono text-[10px] opacity-60 break-all">{link.url}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="text-xs text-muted-foreground">Keine Links in diesem Abschnitt</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-4 text-xs text-muted-foreground">
                          <span><span className="font-medium">{llms.linkedPageCount}</span> verlinkte Seiten</span>
                          <span>{llms.hasDescription ? "✓ Beschreibung vorhanden" : "✗ Keine Beschreibung"}</span>
                        </div>
                        <p className="text-xs text-muted-foreground italic">{llms.summary}</p>
                        {llmsContent && !pdfMode && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">Rohdaten anzeigen (erste 500 Zeichen)</summary>
                            <pre className="mt-2 rounded-md bg-muted p-3 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{llmsContent}</pre>
                          </details>
                        )}
                      </div>
                    ) : null}
                  </div>

                </CardContent>
              </Card>
            );
          })()}

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
        <TabsContent forceMount value="llm" className="space-y-4 pt-4">
          {llmQuestions.length > 0 ? (
            <>
              {/* Sub-score grid */}
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Auffindbarkeit (Teil A · 70%)</div>
                    <div className="text-2xl font-mono font-bold mt-1">{llmPartA?.score ?? 0}<span className="text-sm text-muted-foreground">/100</span></div>
                    <div className="text-[10px] text-muted-foreground mt-1">Ø {llmPartA?.avgRating?.toFixed(2) ?? "—"} / 5</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Informationstiefe (Teil B · 30%)</div>
                    <div className="text-2xl font-mono font-bold mt-1">{llmPartB?.score ?? 0}<span className="text-sm text-muted-foreground">/100</span></div>
                    <div className="text-[10px] text-muted-foreground mt-1">Ø {llmPartB?.avgRating?.toFixed(2) ?? "—"} / 5</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Gesamt (gewichtet)</div>
                    <div className="text-2xl font-mono font-bold mt-1">{(llmDiscoverability?.score as number) ?? 0}<span className="text-sm text-muted-foreground">/100</span></div>
                    <div className="text-[10px] text-muted-foreground mt-1">Ø {llmAvgRating.toFixed(2)} / 5</div>
                  </CardContent>
                </Card>
              </div>

              {/* Part A */}
              {llmPartA && llmPartA.questions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {llmPartA.label}
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground font-normal normal-case">
                      Buyer kennt das Unternehmen NICHT — testet, ob die Seite in Kategorie- und Problemfragen auftaucht.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {llmPartA.questions.map((q, i) => (
                      <LlmQuestionRow key={i} q={q} />
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Part B */}
              {llmPartB && llmPartB.questions.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {llmPartB.label}
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground font-normal normal-case">
                      Buyer kennt die Marke bereits — prüft, wie tief und konkret die Seite Markenfragen beantwortet.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {llmPartB.questions.map((q, i) => (
                      <LlmQuestionRow key={i} q={q} />
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Fallback: flat list for old reports without partA/partB */}
              {!llmPartA && !llmPartB && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      LLM-Auffindbarkeits-Simulation (Score: {(llmDiscoverability?.score as number) ?? 0}/100)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {llmQuestions.map((q, i) => <LlmQuestionRow key={i} q={q} />)}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">Keine LLM-Daten verfügbar.</CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Competitors Tab */}
        <TabsContent forceMount value="competitors" className="space-y-4 pt-4">
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
                      <Bar dataKey="compositeScore" radius={[0, 4, 4, 0]} isAnimationActive={!pdfMode}>
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
        <TabsContent forceMount value="recommendations" className="space-y-5 pt-4">
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

function LlmQuestionRow({ q }: { q: { question: string; rating: number; gap: string; sourceUrl?: string | null } }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 space-y-2">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium flex-1">{q.question}</p>
        <div className="flex shrink-0">
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} className={`w-3.5 h-3.5 ${star <= q.rating ? "fill-yellow-500 text-yellow-500" : "text-muted-foreground/20"}`} />
          ))}
        </div>
      </div>
      {q.gap && <p className="text-xs text-muted-foreground">{q.gap}</p>}
      {q.sourceUrl ? (
        <a href={q.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:underline break-all">
          <ExternalLink className="w-3 h-3 shrink-0" />
          <span className="truncate">{q.sourceUrl}</span>
        </a>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">Keine passende Quellseite gefunden</p>
      )}
    </div>
  );
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
