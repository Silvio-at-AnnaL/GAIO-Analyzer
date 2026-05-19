import { useState, useRef, useCallback } from "react";
import { useAuth, adminFetch } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Upload, FileSearch, RefreshCw } from "lucide-react";

interface DimensionScores {
  technical: number;
  schema: number;
  headings: number;
  content: number;
  faq: number;
  llm: number;
}

interface AnalysisSnapshot {
  id?: number;
  domain: string;
  companyName?: string | null;
  label: string;
  date: string;
  gaioScore: number;
  scores: DimensionScores;
}

interface LogItem {
  id: number;
  domain: string;
  companyName: string | null;
  gaioScore: number | null;
  scoresJson: string | null;
  startedAt: string;
  status: string;
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
  const z = { technical: 0, schema: 0, headings: 0, content: 0, faq: 0, llm: 0 };
  if (!scoresJson) return z;
  try {
    const raw = JSON.parse(scoresJson) as Record<string, unknown>;
    return {
      technical: Number(raw.technicalSeo        ?? raw.technical ?? 0),
      schema:    Number(raw.schemaOrg           ?? raw.schema    ?? 0),
      headings:  Number(raw.headingStructure    ?? raw.headings  ?? 0),
      content:   Number(raw.contentRelevance    ?? raw.content   ?? 0),
      faq:       Number(raw.faqQuality          ?? raw.faq       ?? 0),
      llm:       Number(raw.llmDiscoverability  ?? raw.llm       ?? 0),
    };
  } catch { return z; }
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
  const sign = delta > 0 ? "+" : "";
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

function CompareResult({ a, b }: { a: AnalysisSnapshot; b: AnalysisSnapshot }) {
  const delta = b.gaioScore - a.gaioScore;
  const deltaColor = scoreColor(delta);

  return (
    <div className="space-y-6 mt-6">
      {/* Header cards */}
      <div className="grid grid-cols-2 gap-4">
        {([a, b] as AnalysisSnapshot[]).map((snap, i) => (
          <div key={i} className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
            <div className="text-xs text-muted-foreground mb-1">{snap.label}</div>
            <div className="font-semibold text-sm truncate">{snap.domain}</div>
            {snap.companyName && <div className="text-xs text-muted-foreground truncate">{snap.companyName}</div>}
            <div className="text-xs text-muted-foreground mt-1">{new Date(snap.date).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })}</div>
            <div className="mt-2" style={{ fontSize: 28, fontWeight: 700, color: snap.gaioScore >= 70 ? "#3b82f6" : snap.gaioScore >= 45 ? "#d97706" : "#ef4444" }}>
              {snap.gaioScore}<span style={{ fontSize: 14, color: "#6b7280", fontWeight: 400 }}>/100</span>
            </div>
          </div>
        ))}
      </div>

      {/* Delta hero */}
      <div className="rounded-xl border p-6 text-center" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
        <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Veränderung GAIO Score</div>
        <div style={{ fontSize: 48, fontWeight: 800, color: deltaColor, lineHeight: 1 }}>
          {delta > 0 ? "+" : ""}{delta}
        </div>
        <div className="text-xs text-muted-foreground mt-1">{b.gaioScore} − {a.gaioScore}</div>
        <div className="mt-3 text-sm" style={{ color: "hsl(var(--foreground))" }}>{interpretDelta(delta)}</div>
      </div>

      {/* Dimension table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "hsl(var(--muted))", borderBottom: "1px solid hsl(var(--border))" }}>
              <th className="text-left px-4 py-2 font-semibold text-xs text-muted-foreground">Dimension</th>
              <th className="text-center px-3 py-2 font-semibold text-xs text-muted-foreground">A (Referenz)</th>
              <th className="text-center px-3 py-2 font-semibold text-xs text-muted-foreground">B (Vergleich)</th>
              <th className="text-center px-3 py-2 font-semibold text-xs text-muted-foreground">Δ</th>
            </tr>
          </thead>
          <tbody>
            {DIM_KEYS.map((key, i) => {
              const d = b.scores[key] - a.scores[key];
              return (
                <tr key={key} style={{ borderBottom: i < DIM_KEYS.length - 1 ? "1px solid hsl(var(--border))" : undefined, background: i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted)/0.3)" }}>
                  <td className="px-4 py-2 font-medium">{DIM_LABELS[key]}</td>
                  <td className="px-3 py-2 text-center"><ScoreCell score={a.scores[key]} /></td>
                  <td className="px-3 py-2 text-center"><ScoreCell score={b.scores[key]} /></td>
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

function LogSelect({ label, items, selected, onSelect }: {
  label: string;
  items: LogItem[];
  selected: LogItem | null;
  onSelect: (item: LogItem) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</label>
      <select
        className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{ borderColor: "hsl(var(--border))" }}
        value={selected?.id ?? ""}
        onChange={(e) => {
          const item = items.find((i) => i.id === Number(e.target.value));
          if (item) onSelect(item);
        }}
      >
        <option value="">— Analyse auswählen —</option>
        {items.map((item) => (
          <option key={item.id} value={item.id} disabled={!item.scoresJson && item.gaioScore == null}>
            {item.domain} · {new Date(item.startedAt).toLocaleDateString("de-DE")} · Score: {item.gaioScore ?? "n/a"}{item.companyName ? ` · ${item.companyName}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function FileDropZone({ label, onLoad, loaded }: { label: string; onLoad: (snap: AnalysisSnapshot) => void; loaded: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const processFile = useCallback((file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const html = e.target?.result as string;
      const data = extractEmbedJson(html);
      if (!data) {
        setError("Kein GAIO-Datensatz in dieser HTML-Datei gefunden. Bitte einen aktuellen GAIO Analyzer Export verwenden.");
        return;
      }
      const snap: AnalysisSnapshot = {
        domain: String(data.domain ?? ""),
        companyName: data.companyName ? String(data.companyName) : null,
        label,
        date: String(data.exportDate ?? new Date().toISOString()),
        gaioScore: Number(data.gaioScore ?? 0),
        scores: parseEmbedScores(data),
      };
      onLoad(snap);
    };
    reader.readAsText(file);
  }, [label, onLoad]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  return (
    <div
      className="rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors"
      style={{
        borderColor: dragging ? "#3b82f6" : loaded ? "#3b82f6" : "hsl(var(--border))",
        background: loaded ? "hsl(var(--muted)/0.4)" : "transparent",
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept=".html,.htm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      <Upload className="mx-auto mb-2" style={{ width: 20, height: 20, color: loaded ? "#3b82f6" : "hsl(var(--muted-foreground))" }} />
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</div>
      {loaded ? (
        <div className="mt-1 text-xs" style={{ color: "#3b82f6" }}>Geladen ✓</div>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">HTML-Export hier ablegen oder klicken</div>
      )}
      {error && <div className="mt-2 text-xs" style={{ color: "#d97706" }}>{error}</div>}
    </div>
  );
}

type Mode = "protokoll" | "upload";

export function VergleichView() {
  const { isAuthenticated } = useAuth();
  const [mode, setMode] = useState<Mode>(isAuthenticated ? "protokoll" : "upload");
  const [logItems, setLogItems] = useState<LogItem[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logLoaded, setLogLoaded] = useState(false);
  const [selectedA, setSelectedA] = useState<LogItem | null>(null);
  const [selectedB, setSelectedB] = useState<LogItem | null>(null);
  const [snapA, setSnapA] = useState<AnalysisSnapshot | null>(null);
  const [snapB, setSnapB] = useState<AnalysisSnapshot | null>(null);
  const [comparing, setComparing] = useState(false);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const res = await adminFetch("/api/admin/analysis-log?limit=100&status=completed");
      const data = await res.json() as { items: LogItem[] };
      setLogItems(data.items ?? []);
      setLogLoaded(true);
    } finally {
      setLogLoading(false);
    }
  }, []);

  const handleProtokollCompare = () => {
    if (!selectedA || !selectedB) return;
    setComparing(true);
    setSnapA({
      id: selectedA.id,
      domain: selectedA.domain,
      companyName: selectedA.companyName,
      label: "A (Referenz)",
      date: selectedA.startedAt,
      gaioScore: selectedA.gaioScore ?? 0,
      scores: parseLogScores(selectedA.scoresJson),
    });
    setSnapB({
      id: selectedB.id,
      domain: selectedB.domain,
      companyName: selectedB.companyName,
      label: "B (Vergleich)",
      date: selectedB.startedAt,
      gaioScore: selectedB.gaioScore ?? 0,
      scores: parseLogScores(selectedB.scoresJson),
    });
  };

  const reset = () => {
    setSnapA(null);
    setSnapB(null);
    setComparing(false);
    setSelectedA(null);
    setSelectedB(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="shrink-0" style={{ width: 20, height: 20, color: "#3b82f6" }} />
        <div>
          <h1 className="text-xl font-bold">Analyse-Vergleich</h1>
          <p className="text-sm text-muted-foreground">Vergleiche zwei GAIO-Analysen und sieh die Entwicklung auf einen Blick.</p>
        </div>
      </div>

      {!comparing ? (
        <>
          {/* Mode tabs */}
          <div className="flex gap-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
            {(isAuthenticated ? ["protokoll", "upload"] : ["upload"]) .map((m) => (
              <button
                key={m}
                className="pb-2 px-1 text-sm font-medium transition-colors"
                style={{
                  borderBottom: mode === m ? "2px solid #3b82f6" : "2px solid transparent",
                  color: mode === m ? "#3b82f6" : "hsl(var(--muted-foreground))",
                }}
                onClick={() => { setMode(m as Mode); reset(); }}
              >
                {m === "protokoll" ? "Aus Protokoll" : "HTML-Upload"}
              </button>
            ))}
          </div>

          {mode === "protokoll" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Wähle zwei abgeschlossene Analysen aus dem Protokoll für den Vergleich aus.
              </p>
              {!logLoaded ? (
                <Button variant="outline" size="sm" onClick={loadLog} disabled={logLoading}>
                  {logLoading ? <RefreshCw className="w-3 h-3 mr-2 animate-spin" /> : <FileSearch className="w-3 h-3 mr-2" />}
                  Protokoll laden
                </Button>
              ) : (
                <div className="space-y-4">
                  <LogSelect label="A — Referenzanalyse (älter)" items={logItems} selected={selectedA} onSelect={setSelectedA} />
                  <LogSelect label="B — Vergleichsanalyse (neuer)" items={logItems} selected={selectedB} onSelect={setSelectedB} />
                  <Button
                    onClick={handleProtokollCompare}
                    disabled={!selectedA || !selectedB || selectedA.id === selectedB.id}
                    className="w-full"
                  >
                    Vergleich starten
                  </Button>
                  {selectedA && selectedB && selectedA.id === selectedB.id && (
                    <p className="text-xs" style={{ color: "#d97706" }}>Bitte zwei verschiedene Analysen auswählen.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Lade zwei GAIO Analyzer HTML-Exporte hoch. Der eingebettete Datensatz wird automatisch ausgelesen.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <FileDropZone label="A — Referenzanalyse" loaded={snapA !== null} onLoad={(s) => setSnapA({ ...s, label: "A (Referenz)" })} />
                <FileDropZone label="B — Vergleichsanalyse" loaded={snapB !== null} onLoad={(s) => setSnapB({ ...s, label: "B (Vergleich)" })} />
              </div>
              {snapA && snapB && (
                <Button className="w-full" onClick={() => setComparing(true)}>
                  Vergleich starten
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="text-xs">
              <ArrowLeftRight style={{ width: 11, height: 11, marginRight: 4 }} />
              Vergleichsansicht
            </Badge>
            <Button variant="outline" size="sm" onClick={reset}>Zurücksetzen</Button>
          </div>
          {snapA && snapB && <CompareResult a={snapA} b={snapB} />}
        </>
      )}
    </div>
  );
}
