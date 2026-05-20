import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth, adminFetch, canAccess } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Upload, FileSearch, RefreshCw, Building2, Calendar, BarChart3 } from "lucide-react";

const BASE = (import.meta.env.BASE_URL as string ?? "/").replace(/\/$/, "");

interface DimensionScores {
  technical: number;
  schema:    number;
  headings:  number;
  content:   number;
  faq:       number;
  llm:       number;
}

interface AnalysisSnapshot {
  id?:           number;
  domain:        string;
  companyName?:  string | null;
  label:         string;
  date:          string;
  gaioScore:     number;
  scores:        DimensionScores;
}

interface LogItem {
  id:           number;
  domain:       string;
  companyName:  string | null;
  gaioScore:    number | null;
  scoresJson:   string | null;
  startedAt:    string;
  status:       string;
  hasHtmlExport: boolean;
}

const DIM_KEYS: (keyof DimensionScores)[] = ["technical", "schema", "headings", "content", "faq", "llm"];
const DIM_LABELS: Record<keyof DimensionScores, string> = {
  technical: "Technisches SEO",
  schema:    "Strukturierte Daten",
  headings:  "Überschriften",
  content:   "Content-Relevanz",
  faq:       "FAQ-Qualität",
  llm:       "LLM-Auffindbarkeit",
};

function parseLogScores(scoresJson: string | null): DimensionScores {
  const z: DimensionScores = { technical: 0, schema: 0, headings: 0, content: 0, faq: 0, llm: 0 };
  if (!scoresJson) return z;
  try {
    const raw = JSON.parse(scoresJson) as Record<string, unknown>;
    return {
      technical: Number(raw.technicalSeo       ?? raw.technical ?? 0),
      schema:    Number(raw.schemaOrg          ?? raw.schema    ?? 0),
      headings:  Number(raw.headingStructure   ?? raw.headings  ?? 0),
      content:   Number(raw.contentRelevance   ?? raw.content   ?? 0),
      faq:       Number(raw.faqQuality         ?? raw.faq       ?? 0),
      llm:       Number(raw.llmDiscoverability ?? raw.llm       ?? 0),
    };
  } catch { return z; }
}

function parseReportScores(report: Record<string, unknown>): DimensionScores {
  const s = (key: string) =>
    ((report[key] as { score?: number } | null)?.score) ?? 0;
  return {
    technical: s("technicalSeo"),
    schema:    s("schemaOrg"),
    headings:  s("headingStructure"),
    content:   s("contentRelevance"),
    faq:       s("faqQuality"),
    llm:       s("llmDiscoverability"),
  };
}

function parseEmbedScores(data: Record<string, unknown>): DimensionScores {
  const s = (data.scores ?? {}) as Record<string, unknown>;
  return {
    technical: Number(s.technical ?? 0),
    schema:    Number(s.schema    ?? 0),
    headings:  Number(s.headings  ?? 0),
    content:   Number(s.content   ?? 0),
    faq:       Number(s.faq       ?? 0),
    llm:       Number(s.llm       ?? 0),
  };
}

function extractEmbedJson(html: string): Record<string, unknown> | null {
  const match = html.match(/<script[^>]+id="gaio-analysis-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]) as Record<string, unknown>; } catch { return null; }
}

function scoreColor(delta: number) {
  if (delta > 0) return "#3b82f6";
  if (delta < 0) return "#d97706";
  return "#6b7280";
}

function DeltaBadge({ delta }: { delta: number }) {
  const color = scoreColor(delta);
  const sign  = delta > 0 ? "+" : "";
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "—";
  return (
    <span style={{ color, fontWeight: 700, fontSize: 13 }}>
      {arrow} {sign}{delta}
    </span>
  );
}

function interpretDelta(delta: number): string {
  if (delta >= 15) return "Deutliche Verbesserung — der GAIO Score hat sich signifikant erhöht.";
  if (delta >= 5)  return "Positive Entwicklung — sichtbarer Fortschritt in der LLM-Auffindbarkeit und SEO-Qualität.";
  if (delta >= 1)  return "Leichte Verbesserung — kleinere Optimierungen zeigen erste Wirkung.";
  if (delta === 0) return "Keine Änderung — der GAIO Score ist stabil geblieben.";
  if (delta >= -4) return "Leichter Rückgang — geringfügige Verschlechterung, Monitoring empfohlen.";
  if (delta >= -14) return "Negativer Trend — relevante Verschlechterung, Handlungsbedarf prüfen.";
  return "Deutlicher Rückgang — der GAIO Score hat sich signifikant verschlechtert.";
}

function ScoreCell({ score }: { score: number }) {
  const color = score >= 70 ? "#3b82f6" : score >= 45 ? "#d97706" : "#ef4444";
  return <span style={{ fontWeight: 700, color }}>{score}</span>;
}

function SnapCard({ snap, muted }: { snap: AnalysisSnapshot; muted?: boolean }) {
  const scoreColor = snap.gaioScore >= 70 ? "#3b82f6" : snap.gaioScore >= 45 ? "#d97706" : "#ef4444";
  return (
    <div
      className="rounded-lg border p-4 space-y-1"
      style={{ borderColor: "hsl(var(--border))", background: muted ? "hsl(var(--muted)/0.4)" : "hsl(var(--card))" }}
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{snap.label}</div>
      <div className="flex items-center gap-1.5 font-semibold text-sm truncate">
        <Building2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        {snap.domain}
      </div>
      {snap.companyName && (
        <div className="text-xs text-muted-foreground truncate pl-5">{snap.companyName}</div>
      )}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground pt-0.5">
        <Calendar className="w-3 h-3 shrink-0" />
        {new Date(snap.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}
      </div>
      <div className="flex items-end gap-1 pt-1">
        <span style={{ fontSize: 26, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{snap.gaioScore}</span>
        <span className="text-xs text-muted-foreground pb-0.5">/100</span>
      </div>
    </div>
  );
}

function CompareResult({ current, comparison }: { current: AnalysisSnapshot; comparison: AnalysisSnapshot }) {
  const delta      = current.gaioScore - comparison.gaioScore;
  const deltaColor = scoreColor(delta);

  return (
    <div className="space-y-6 mt-6">
      <div className="grid grid-cols-2 gap-4">
        <SnapCard snap={comparison} />
        <SnapCard snap={current} />
      </div>

      <div className="rounded-xl border p-6 text-center" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Veränderung GAIO Score</div>
        <div style={{ fontSize: 48, fontWeight: 800, color: deltaColor, lineHeight: 1 }}>
          {delta > 0 ? "+" : ""}{delta}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{current.gaioScore} − {comparison.gaioScore}</div>
        <div className="mt-3 text-sm" style={{ color: "hsl(var(--foreground))" }}>{interpretDelta(delta)}</div>
      </div>

      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
              <th className="text-left px-4 py-2 font-semibold text-xs text-muted-foreground">Dimension</th>
              <th className="text-center px-3 py-2 font-semibold text-xs text-muted-foreground">Vergleich</th>
              <th className="text-center px-3 py-2 font-semibold text-xs text-muted-foreground">Aktuell</th>
              <th className="text-center px-3 py-2 font-semibold text-xs text-muted-foreground">Δ</th>
            </tr>
          </thead>
          <tbody>
            {DIM_KEYS.map((key, i) => {
              const d = current.scores[key] - comparison.scores[key];
              return (
                <tr
                  key={key}
                  style={{
                    borderBottom: i < DIM_KEYS.length - 1 ? "1px solid hsl(var(--border))" : undefined,
                    background:   i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted)/0.3)",
                  }}
                >
                  <td className="px-4 py-2 font-medium">{DIM_LABELS[key]}</td>
                  <td className="px-3 py-2 text-center"><ScoreCell score={comparison.scores[key]} /></td>
                  <td className="px-3 py-2 text-center"><ScoreCell score={current.scores[key]} /></td>
                  <td className="px-3 py-2 text-center"><DeltaBadge delta={d} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FileDropZone({ onLoad, loaded }: { onLoad: (snap: AnalysisSnapshot) => void; loaded: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError]     = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = useCallback((file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const html = e.target?.result as string;
      const data = extractEmbedJson(html);
      if (!data) {
        setError("Diese Datei enthält keine maschinenlesbaren Analysedaten.");
        return;
      }
      const snap: AnalysisSnapshot = {
        domain:      String(data.domain ?? ""),
        companyName: data.companyName ? String(data.companyName) : null,
        label:       "Vergleichsanalyse",
        date:        String(data.exportDate ?? new Date().toISOString()),
        gaioScore:   Number(data.gaioScore ?? 0),
        scores:      parseEmbedScores(data),
      };
      onLoad(snap);
    };
    reader.readAsText(file);
  }, [onLoad]);

  return (
    <div
      className="rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors"
      style={{
        borderColor: dragging ? "#3b82f6" : loaded ? "#3b82f6" : "hsl(var(--border))",
        background:  loaded ? "hsl(var(--muted)/0.4)" : "transparent",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".html,.htm"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }}
      />
      <Upload className="mx-auto mb-2" style={{ width: 20, height: 20, color: loaded ? "#3b82f6" : "hsl(var(--muted-foreground))" }} />
      {loaded ? (
        <div className="text-sm font-medium" style={{ color: "#3b82f6" }}>Geladen ✓</div>
      ) : (
        <>
          <div className="text-sm font-medium text-muted-foreground">HTML-Export hier ablegen oder klicken zum Auswählen</div>
          <div className="text-xs text-muted-foreground mt-1">Nur .html-Dateien aus dem GAIO Analyzer Export</div>
        </>
      )}
      {error && <div className="mt-2 text-xs" style={{ color: "#d97706" }}>{error}</div>}
    </div>
  );
}

type Mode = "protokoll" | "upload";

export function VergleichView() {
  const { isAuthenticated, user, permissions } = useAuth();
  const { analysisId } = useAppStore();
  const role                = user?.role ?? "";
  const hasProtokollAccess  = isAuthenticated && canAccess("analyseprotokoll", role, permissions);

  const [currentSnap,    setCurrentSnap]    = useState<AnalysisSnapshot | null>(null);
  const [loadingCurrent, setLoadingCurrent] = useState(false);

  const [mode,        setMode]        = useState<Mode>(hasProtokollAccess ? "protokoll" : "upload");
  const [compSnap,    setCompSnap]    = useState<AnalysisSnapshot | null>(null);
  const [logItems,    setLogItems]    = useState<LogItem[]>([]);
  const [logLoading,  setLogLoading]  = useState(false);
  const [logLoaded,   setLogLoaded]   = useState(false);
  const [selectedLog, setSelectedLog] = useState<LogItem | null>(null);
  const [comparing,   setComparing]   = useState(false);

  useEffect(() => {
    if (!analysisId) return;
    setLoadingCurrent(true);
    fetch(`${BASE}/api/analyze/${analysisId}`)
      .then((r) => r.json())
      .then((report: Record<string, unknown>) => {
        setCurrentSnap({
          id:          (report.logId as number | undefined) ?? undefined,
          domain:      String(report.domain ?? ""),
          companyName: report.companyName ? String(report.companyName) : null,
          label:       "Aktuelle Analyse",
          date:        String(report.startedAt ?? report.createdAt ?? new Date().toISOString()),
          gaioScore:   Number(report.overallScore ?? 0),
          scores:      parseReportScores(report),
        });
      })
      .catch(() => {})
      .finally(() => setLoadingCurrent(false));
  }, [analysisId]);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const res  = await adminFetch("/api/admin/analysis-log?limit=200&status=completed");
      const data = await res.json() as { items: LogItem[] };
      const currentId = currentSnap?.id;
      const filtered  = (data.items ?? []).filter(
        (item) => (item.gaioScore != null || item.scoresJson != null) && item.id !== currentId
      );
      setLogItems(filtered);
      setLogLoaded(true);
    } finally {
      setLogLoading(false);
    }
  }, [currentSnap?.id]);

  const handleLogSelect = (item: LogItem) => {
    setSelectedLog(item);
    setCompSnap({
      id:          item.id,
      domain:      item.domain,
      companyName: item.companyName,
      label:       "Vergleichsanalyse",
      date:        item.startedAt,
      gaioScore:   item.gaioScore ?? 0,
      scores:      parseLogScores(item.scoresJson),
    });
  };

  const resetComp = () => {
    setCompSnap(null);
    setComparing(false);
    setSelectedLog(null);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    resetComp();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="shrink-0" style={{ width: 20, height: 20, color: "#3b82f6" }} />
        <div>
          <h1 className="text-xl font-bold">Analyse-Vergleich</h1>
          <p className="text-sm text-muted-foreground">
            Vergleiche die aktuelle Analyse mit einer früheren und sieh die Entwicklung auf einen Blick.
          </p>
        </div>
      </div>

      {!comparing ? (
        <div className="space-y-6">
          {/* Left side — current analysis (fixed) */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Aktuelle Analyse (Referenz)</div>
            {loadingCurrent ? (
              <div className="rounded-lg border p-4 text-sm text-muted-foreground" style={{ borderColor: "hsl(var(--border))" }}>
                Lade aktuelle Analyse…
              </div>
            ) : currentSnap ? (
              <>
                <SnapCard snap={{ ...currentSnap, label: "Aktuelle Analyse" }} muted />
                <p className="text-xs text-muted-foreground">Diese Analyse wird als Referenz verwendet.</p>
              </>
            ) : (
              <div className="rounded-lg border p-4 text-sm text-muted-foreground" style={{ borderColor: "hsl(var(--border))" }}>
                Keine Analyse geladen.
              </div>
            )}
          </div>

          {/* Right side — comparison source */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vergleichsanalyse auswählen</div>

            {hasProtokollAccess ? (
              <>
                {/* Tab switcher */}
                <div className="flex gap-0 border rounded-lg overflow-hidden" style={{ borderColor: "hsl(var(--border))", width: "fit-content" }}>
                  {(["protokoll", "upload"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      className="px-4 py-1.5 text-sm font-medium transition-colors"
                      style={{
                        background:  mode === m ? "#3b82f6" : "hsl(var(--card))",
                        color:       mode === m ? "#fff" : "hsl(var(--muted-foreground))",
                      }}
                    >
                      {m === "protokoll" ? "Aus Protokoll laden" : "HTML-Datei hochladen"}
                    </button>
                  ))}
                </div>

                {mode === "protokoll" && (
                  <div className="space-y-3">
                    {!logLoaded ? (
                      <Button variant="outline" size="sm" onClick={loadLog} disabled={logLoading}>
                        {logLoading
                          ? <><RefreshCw className="w-3 h-3 mr-2 animate-spin" />Wird geladen…</>
                          : <><FileSearch className="w-3 h-3 mr-2" />Protokoll laden</>}
                      </Button>
                    ) : logItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Keine weiteren abgeschlossenen Analysen im Protokoll vorhanden.
                      </p>
                    ) : (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Analyse auswählen</label>
                        <select
                          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          style={{ borderColor: "hsl(var(--border))" }}
                          value={selectedLog?.id ?? ""}
                          onChange={(e) => {
                            const item = logItems.find((i) => i.id === Number(e.target.value));
                            if (item) handleLogSelect(item);
                          }}
                        >
                          <option value="">— Analyse auswählen —</option>
                          {logItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.domain} · {new Date(item.startedAt).toLocaleDateString("de-DE")} · Score: {item.gaioScore ?? "n/a"}{item.companyName ? ` · ${item.companyName}` : ""}
                            </option>
                          ))}
                        </select>
                        {compSnap && (
                          <div className="pt-1">
                            <SnapCard snap={compSnap} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {mode === "upload" && (
                  <div className="space-y-3">
                    <FileDropZone
                      loaded={compSnap !== null}
                      onLoad={(s) => setCompSnap(s)}
                    />
                    {compSnap && <SnapCard snap={compSnap} />}
                  </div>
                )}
              </>
            ) : (
              /* No protocol access — upload only, no tabs */
              <div className="space-y-3">
                <FileDropZone
                  loaded={compSnap !== null}
                  onLoad={(s) => setCompSnap(s)}
                />
                {compSnap && <SnapCard snap={compSnap} />}
              </div>
            )}
          </div>

          <Button
            className="w-full"
            disabled={!currentSnap || !compSnap}
            onClick={() => setComparing(true)}
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Vergleich anzeigen
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs">
              <ArrowLeftRight style={{ width: 11, height: 11, marginRight: 4 }} />
              Vergleichsansicht
            </Badge>
            <Button variant="outline" size="sm" onClick={resetComp}>Zurücksetzen</Button>
          </div>
          {currentSnap && compSnap && (
            <CompareResult current={currentSnap} comparison={compSnap} />
          )}
        </>
      )}
    </div>
  );
}
