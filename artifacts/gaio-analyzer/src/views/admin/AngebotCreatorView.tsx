import { useState, useEffect, useRef, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import {
  FileText, RefreshCw, Clipboard, CheckCircle, AlertCircle,
  Bold, Italic, UnderlineIcon, List, Minus, UploadCloud, X,
} from "lucide-react";
import { adminFetch, canAccess, useAuth } from "@/store/authStore";
import { useT } from "@/lib/LabelProvider";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScoresJson {
  technicalSeo:       number | null;
  schemaOrg:          number | null;
  headingStructure:   number | null;
  contentRelevance:   number | null;
  faqQuality:         number | null;
  llmDiscoverability: number | null;
}

interface AnalysisItem {
  id: number;
  domain: string;
  companyName: string | null;
  gaioScore: number | null;
  scoresJson: string | null;
  completedAt: string | null;
  status: string;
}

interface GeneratedResult {
  html: string;
  companyName: string;
  domain: string;
}

interface ParsedRec { finding: string; fix: string; }

interface ParsedUpload {
  fileName:    string;
  domain:      string;
  companyName: string;
  exportDate:  string;
  gaioScore:   number;
  scores:      ScoresJson;
  kritisch:    ParsedRec[];
  hoherHebel:  ParsedRec[];
  nachgeordnet:ParsedRec[];
}

type InputMode = "protocol" | "upload";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null): string {
  if (!iso) return "–";
  try {
    return new Date(iso).toLocaleString("de-DE", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function scoreColor(score: number | null): string {
  if (score === null || score === undefined) return "#9ca3af";
  if (score >= 76) return "#16a34a";
  if (score >= 61) return "#84cc16";
  if (score >= 41) return "#f59e0b";
  return "#ef4444";
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  const color = scoreColor(value);
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums" style={{ color }}>
        {value !== null ? `${value}/100` : "–"}
      </span>
    </div>
  );
}

function ToolBtn({
  onClick, active, title, children,
}: {
  onClick: () => void; active?: boolean; title?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className="inline-flex items-center justify-center rounded px-2 text-sm font-semibold transition-colors"
      style={{
        height: 28,
        minWidth: 28,
        background: active ? "#3b82f6" : "hsl(var(--muted))",
        color: active ? "#fff" : "hsl(var(--foreground))",
      }}
    >
      {children}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AngebotCreatorView() {
  const t = useT();
  const { user, permissions } = useAuth();
  const canProtocol = canAccess("analyseprotokoll", user?.role ?? "", permissions);

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [inputMode, setInputMode] = useState<InputMode>(canProtocol ? "protocol" : "upload");

  // ── Protocol mode state ───────────────────────────────────────────────────
  const [analyses, setAnalyses]       = useState<AnalysisItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId]   = useState<number | "">("");

  // ── Upload mode state ─────────────────────────────────────────────────────
  const [uploadData, setUploadData]   = useState<ParsedUpload | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [isDragging, setIsDragging]   = useState(false);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  // ── Shared generation state ───────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]     = useState("");
  const [generated, setGenerated]   = useState<GeneratedResult | null>(null);
  const [copied, setCopied]         = useState(false);
  const copyTimer                   = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: "",
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-96 p-5 text-gray-900 text-sm leading-relaxed",
      },
    },
  });

  useEffect(() => {
    if (!canProtocol) return;
    adminFetch("/api/admin/analysis-log?status=completed&limit=100")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: AnalysisItem[] } | null) => {
        if (d?.items) setAnalyses(d.items.filter((a) => a.status === "completed"));
      })
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, [canProtocol]);

  useEffect(() => {
    return () => { if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  // ── Mode switching ────────────────────────────────────────────────────────

  function switchMode(mode: InputMode) {
    setInputMode(mode);
    setGenerated(null);
    setGenError("");
    if (mode === "upload") {
      setSelectedId("");
    } else {
      setUploadData(null);
      setUploadError("");
    }
  }

  // ── Protocol helpers ──────────────────────────────────────────────────────

  const selectedAnalysis = analyses.find((a) => a.id === selectedId) ?? null;

  const parsedScores: ScoresJson | null = (() => {
    if (!selectedAnalysis?.scoresJson) return null;
    try { return JSON.parse(selectedAnalysis.scoresJson) as ScoresJson; } catch { return null; }
  })();

  // ── Upload / file parsing ─────────────────────────────────────────────────

  const parseFile = useCallback(async (file: File) => {
    setUploadError("");
    setUploadData(null);
    setGenerated(null);
    setGenError("");

    if (!file.name.toLowerCase().endsWith(".html")) {
      setUploadError(t("offer.err_html_only"));
      return;
    }

    const text = await file.text();

    // Extract embedded JSON
    const match = text.match(/<script[^>]*id=["']gaio-analysis-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
      setUploadError(
        "Diese HTML-Datei enthält keine maschinenlesbaren Analysedaten. Bitte verwenden Sie einen aktuellen HTML-Export des GAIO Analyzers."
      );
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(match[1]) as Record<string, unknown>;
    } catch {
      setUploadError(t("offer.err_unreadable"));
      return;
    }

    // Validate required fields
    if (!data.domain || data.gaioScore === undefined || !data.scores || typeof data.scores !== "object") {
      setUploadError(t("offer.err_incomplete"));
      return;
    }

    // Parse recommendations via DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "text/html");
    const recs = doc.querySelectorAll(".rec");

    const kritisch:    ParsedRec[] = [];
    const hoherHebel:  ParsedRec[] = [];
    const nachgeordnet:ParsedRec[] = [];

    recs.forEach((el) => {
      const tier    = (el.querySelector(".tier")?.textContent ?? "").trim().toUpperCase();
      const finding = (el.querySelector(".finding")?.textContent ?? "").trim();
      const fix     = (el.querySelector(".fix")?.textContent ?? "").trim();
      if (!finding && !fix) return;
      if (tier.includes("KRITISCH"))                                    kritisch.push({ finding, fix });
      else if (tier.includes("HOHER HEBEL"))                            hoherHebel.push({ finding, fix });
      else if (tier.includes("NACHGEORDNET") || tier.includes("SEKUNDÄR")) nachgeordnet.push({ finding, fix });
    });

    const scores = data.scores as Record<string, unknown>;

    setUploadData({
      fileName:    file.name,
      domain:      String(data.domain),
      companyName: String(data.companyName ?? data.domain),
      exportDate:  String(data.exportDate ?? data.completedAt ?? ""),
      gaioScore:   Number(data.gaioScore),
      scores: {
        technicalSeo:       scores.technicalSeo       != null ? Number(scores.technicalSeo)       : null,
        schemaOrg:          scores.schemaOrg           != null ? Number(scores.schemaOrg)           : null,
        headingStructure:   scores.headingStructure    != null ? Number(scores.headingStructure)    : null,
        contentRelevance:   scores.contentRelevance    != null ? Number(scores.contentRelevance)    : null,
        faqQuality:         scores.faqQuality          != null ? Number(scores.faqQuality)          : null,
        llmDiscoverability: scores.llmDiscoverability  != null ? Number(scores.llmDiscoverability)  : null,
      },
      kritisch,
      hoherHebel,
      nachgeordnet,
    });
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void parseFile(file);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void parseFile(file);
  }

  // ── Generation ────────────────────────────────────────────────────────────

  const canGenerate = inputMode === "protocol"
    ? !!selectedId
    : !!uploadData;

  async function generate(force = false) {
    if (!canGenerate) return;
    if (force && generated) {
      if (!window.confirm(t("offer.confirm_regenerate"))) return;
    }
    setGenerating(true);
    setGenError("");
    try {
      let body: Record<string, unknown>;
      if (inputMode === "upload" && uploadData) {
        body = {
          fromUpload:      true,
          domain:          uploadData.domain,
          companyName:     uploadData.companyName,
          exportDate:      uploadData.exportDate,
          gaioScore:       uploadData.gaioScore,
          scores:          uploadData.scores,
          recommendations: {
            kritisch:    uploadData.kritisch,
            hoherHebel:  uploadData.hoherHebel,
            nachgeordnet: uploadData.nachgeordnet,
          },
        };
      } else {
        body = { analysisId: selectedId };
      }

      const res = await adminFetch("/api/admin/angebot/generate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const d = (await res.json()) as GeneratedResult;
        setGenerated(d);
        editor?.commands.setContent(d.html);
      } else {
        setGenError(t("offer.err_generate"));
      }
    } catch {
      setGenError(t("offer.err_generate"));
    } finally {
      setGenerating(false);
    }
  }

  async function copyAsHtml() {
    if (!editor) return;
    try {
      await navigator.clipboard.writeText(editor.getHTML());
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard API may fail in some contexts */ }
  }

  const charCount = editor ? editor.getText().length : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-[900px] space-y-6 pb-12">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-5 h-5" style={{ color: "#3b82f6" }} />
          <h1 className="text-2xl font-bold tracking-tight">{t("nav.admin_angebots_creator")}</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          {t("offer.subtitle")}
        </p>
      </div>

      {/* Step 1: Input selection */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">

        {/* Mode switcher — only shown when user can access both */}
        {canProtocol && (
          <div className="flex rounded-lg overflow-hidden border border-border w-fit text-sm font-medium">
            <button
              onClick={() => switchMode("protocol")}
              className="flex items-center gap-2 px-4 py-2 transition-colors"
              style={{
                background: inputMode === "protocol" ? "#3b82f6" : "hsl(var(--muted)/0.4)",
                color:      inputMode === "protocol" ? "#fff"    : "hsl(var(--foreground))",
              }}
            >
              📋 Aus Protokoll
            </button>
            <button
              onClick={() => switchMode("upload")}
              className="flex items-center gap-2 px-4 py-2 transition-colors border-l border-border"
              style={{
                background: inputMode === "upload" ? "#3b82f6" : "hsl(var(--muted)/0.4)",
                color:      inputMode === "upload" ? "#fff"    : "hsl(var(--foreground))",
              }}
            >
              📄 HTML hochladen
            </button>
          </div>
        )}

        {/* ── MODE A: Aus Protokoll ─────────────────────────────────────────── */}
        {inputMode === "protocol" && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">{t("offer.mode_select")}</h2>

            {!loadingList && analyses.length === 0 ? (
              <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center" style={{ background: "hsl(var(--muted)/0.3)" }}>
                {t("offer.no_analyses")}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">{t("offer.analysis_label")}</label>
                  <select
                    value={selectedId}
                    onChange={(e) => {
                      setSelectedId(e.target.value === "" ? "" : parseInt(e.target.value, 10));
                      setGenerated(null);
                      setGenError("");
                    }}
                    disabled={loadingList || generating}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
                  >
                    <option value="">{t("offer.select_placeholder")}</option>
                    {analyses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.domain}
                        {a.companyName ? t("offer.option_company", { company: a.companyName }) : ""}
                        {" · "}{formatDateTime(a.completedAt)}
                        {a.gaioScore !== null ? t("offer.option_score", { score: a.gaioScore }) : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedAnalysis && (
                  <div
                    className="rounded-lg border border-border px-4 py-3 space-y-2"
                    style={{ background: "hsl(var(--muted)/0.25)" }}
                  >
                    <p className="text-xs text-muted-foreground">
                      Ausgewählte Analyse · <strong>{selectedAnalysis.domain}</strong> · {formatDateTime(selectedAnalysis.completedAt)}
                    </p>
                    <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
                      <ScoreRow label={t("offer.score_gaio")}                  value={selectedAnalysis.gaioScore} />
                      <ScoreRow label={t("results.chart_dim_technical")}      value={parsedScores?.technicalSeo       ?? null} />
                      <ScoreRow label={t("results.chart_dim_schema")}         value={parsedScores?.schemaOrg           ?? null} />
                      <ScoreRow label={t("results.chart_dim_headings")}       value={parsedScores?.headingStructure    ?? null} />
                      <ScoreRow label={t("results.chart_dim_content")}        value={parsedScores?.contentRelevance    ?? null} />
                      <ScoreRow label={t("offer.score_faq")}                  value={parsedScores?.faqQuality          ?? null} />
                      <ScoreRow label={t("offer.score_llm")}                  value={parsedScores?.llmDiscoverability  ?? null} />
                    </div>
                    <p className="text-xs text-muted-foreground italic">
                      {t("offer.check_correct")}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── MODE B: HTML hochladen ───────────────────────────────────────── */}
        {inputMode === "upload" && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold">{t("offer.mode_upload")}</h2>

            {/* Drop zone */}
            {!uploadData && (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors select-none"
                style={{
                  height: 180,
                  borderColor: isDragging ? "#3b82f6" : "hsl(var(--border))",
                  background: isDragging ? "hsl(var(--muted)/0.5)" : "hsl(var(--muted)/0.2)",
                }}
              >
                <UploadCloud className="w-8 h-8" style={{ color: isDragging ? "#3b82f6" : "hsl(var(--muted-foreground))" }} />
                <span className="text-sm font-medium">{t("offer.drop_hint")}</span>
                <span className="text-xs text-muted-foreground">{t("offer.drop_or_click")}</span>
                <span className="text-xs text-muted-foreground">{t("offer.upload_note")}</span>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".html"
              className="hidden"
              onChange={handleFileInput}
            />

            {/* Upload error */}
            {uploadError && (
              <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            {/* Score preview after successful parse */}
            {uploadData && (
              <div className="space-y-3">
                <div
                  className="rounded-lg border border-border px-4 py-3 space-y-2"
                  style={{ background: "hsl(var(--muted)/0.25)" }}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Analyse aus Datei: <strong>{uploadData.fileName}</strong>
                      {uploadData.exportDate ? ` · ${uploadData.exportDate.slice(0, 10)}` : ""}
                    </p>
                    <button
                      onClick={() => { setUploadData(null); setUploadError(""); setGenerated(null); }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title={t("offer.remove_file_title")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs font-medium">{uploadData.domain}{uploadData.companyName !== uploadData.domain ? ` · ${uploadData.companyName}` : ""}</p>
                  <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
                    <ScoreRow label={t("offer.score_gaio")}                  value={uploadData.gaioScore} />
                    <ScoreRow label={t("results.chart_dim_technical")}      value={uploadData.scores.technicalSeo} />
                    <ScoreRow label={t("results.chart_dim_schema")}         value={uploadData.scores.schemaOrg} />
                    <ScoreRow label={t("results.chart_dim_headings")}       value={uploadData.scores.headingStructure} />
                    <ScoreRow label={t("results.chart_dim_content")}        value={uploadData.scores.contentRelevance} />
                    <ScoreRow label={t("offer.score_faq")}                  value={uploadData.scores.faqQuality} />
                    <ScoreRow label={t("offer.score_llm")}                  value={uploadData.scores.llmDiscoverability} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {uploadData.kritisch.length} kritisch · {uploadData.hoherHebel.length} hoher Hebel · {uploadData.nachgeordnet.length} nachgeordnet
                  </p>
                </div>

                {/* Re-upload option */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs text-muted-foreground underline"
                >
                  {t("offer.choose_other_file")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Generate button — shared */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={() => generate(false)}
            disabled={!canGenerate || generating}
            className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 w-fit"
            style={{ background: "#3b82f6" }}
          >
            {generating ? (
              <>
                <span className="inline-block animate-spin text-base leading-none">⏳</span>
                Angebot wird erstellt…
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Angebot generieren
              </>
            )}
          </button>

          {generating && (
            <p className="text-sm text-muted-foreground">
              Die KI analysiert die Empfehlungen und erstellt Ihren Angebotstext.
              Das dauert ca. 30–60 Sekunden…
            </p>
          )}

          {genError && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "#d97706" }}>
              <AlertCircle className="w-4 h-4 shrink-0" />
              {genError}
            </div>
          )}
        </div>
      </div>

      {/* Step 2: Editor */}
      {generated && editor && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div
            className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-border"
            style={{ background: "hsl(var(--muted)/0.4)" }}
          >
            <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} title="Fett">
              <Bold className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} title="Kursiv">
              <Italic className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")} title="Unterstrichen">
              <UnderlineIcon className="w-3.5 h-3.5" />
            </ToolBtn>

            <div style={{ width: 1, height: 20, background: "hsl(var(--border))", margin: "0 2px" }} />

            <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive("heading", { level: 1 })} title="Überschrift 1">H1</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })} title="Überschrift 2">H2</ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })} title="Überschrift 3">H3</ToolBtn>

            <div style={{ width: 1, height: 20, background: "hsl(var(--border))", margin: "0 2px" }} />

            <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} title="Aufzählungsliste">
              <List className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="Trennlinie">
              <Minus className="w-3.5 h-3.5" />
            </ToolBtn>
          </div>

          <div className="bg-white">
            <EditorContent
              editor={editor}
              className="prose prose-sm max-w-none [&_.ProseMirror]:focus:outline-none [&_.ProseMirror]:min-h-96 [&_.ProseMirror]:p-5"
            />
          </div>
        </div>
      )}

      {/* Step 3: Export bar */}
      {generated && editor && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {charCount.toLocaleString("de-DE")} Zeichen
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => generate(true)}
              disabled={generating}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Neu generieren
            </button>
            <button
              onClick={copyAsHtml}
              className="flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: copied ? "#16a34a" : "#3b82f6" }}
            >
              {copied ? (
                <><CheckCircle className="w-3.5 h-3.5" />HTML kopiert!</>
              ) : (
                <><Clipboard className="w-3.5 h-3.5" />Als HTML kopieren</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
