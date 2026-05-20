import { useState, useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import {
  FileText, RefreshCw, Clipboard, CheckCircle, AlertCircle,
  Bold, Italic, UnderlineIcon, List, Minus,
} from "lucide-react";
import { adminFetch } from "@/store/authStore";

interface AnalysisItem {
  id: number;
  domain: string;
  companyName: string | null;
  gaioScore: number | null;
  completedAt: string | null;
  status: string;
}

interface GeneratedResult {
  html: string;
  companyName: string;
  domain: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return "–";
  return iso.slice(0, 10).split("-").reverse().join(".");
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

export function AngebotCreatorView() {
  const [analyses, setAnalyses]       = useState<AnalysisItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId]   = useState<number | "">("");
  const [generating, setGenerating]   = useState(false);
  const [genError, setGenError]       = useState("");
  const [generated, setGenerated]     = useState<GeneratedResult | null>(null);
  const [copied, setCopied]           = useState(false);
  const copyTimer                     = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    adminFetch("/api/admin/analysis-log?status=completed&limit=100")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { items?: AnalysisItem[] } | null) => {
        if (d?.items) setAnalyses(d.items.filter((a) => a.status === "completed"));
      })
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, []);

  useEffect(() => {
    return () => { if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, []);

  async function generate(force = false) {
    if (!selectedId) return;
    if (force && generated) {
      if (!window.confirm("Änderungen verwerfen und neu generieren?")) return;
    }
    setGenerating(true);
    setGenError("");
    try {
      const res = await adminFetch("/api/admin/angebot/generate", {
        method: "POST",
        body: JSON.stringify({ analysisId: selectedId }),
      });
      if (res.ok) {
        const d = (await res.json()) as GeneratedResult;
        setGenerated(d);
        editor?.commands.setContent(d.html);
      } else {
        setGenError("Angebot konnte nicht erstellt werden. Bitte prüfen Sie die KI-Tool-Einstellungen.");
      }
    } catch {
      setGenError("Angebot konnte nicht erstellt werden. Bitte prüfen Sie die KI-Tool-Einstellungen.");
    } finally {
      setGenerating(false);
    }
  }

  async function copyAsHtml() {
    if (!editor) return;
    const html = editor.getHTML();
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API may fail in some contexts */
    }
  }

  const charCount = editor ? editor.getText().length : 0;

  return (
    <div className="max-w-[900px] space-y-6 pb-12">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-5 h-5" style={{ color: "#3b82f6" }} />
          <h1 className="text-2xl font-bold tracking-tight">Angebots-Creator</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          KI-gestützte Angebotserstellung aus einer bestehenden Analyse
        </p>
      </div>

      {/* Step 1: Selection */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold">Analyse auswählen</h2>

        {!loadingList && analyses.length === 0 ? (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground text-center" style={{ background: "hsl(var(--muted)/0.3)" }}>
            Noch keine abgeschlossenen Analysen im Protokoll. Führen Sie zunächst eine Analyse durch.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Analyse</label>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value === "" ? "" : parseInt(e.target.value, 10))}
                disabled={loadingList || generating}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
              >
                <option value="">— Analyse auswählen —</option>
                {analyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.domain}
                    {a.companyName ? ` · ${a.companyName}` : ""}
                    {" · "}{formatDate(a.completedAt)}
                    {a.gaioScore !== null ? ` · Score: ${a.gaioScore}` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={() => generate(false)}
                disabled={!selectedId || generating}
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
        )}
      </div>

      {/* Step 2: Editor */}
      {generated && editor && (
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Toolbar */}
          <div
            className="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-border"
            style={{ background: "hsl(var(--muted)/0.4)" }}
          >
            <ToolBtn
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive("bold")}
              title="Fett"
            >
              <Bold className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive("italic")}
              title="Kursiv"
            >
              <Italic className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              active={editor.isActive("underline")}
              title="Unterstrichen"
            >
              <UnderlineIcon className="w-3.5 h-3.5" />
            </ToolBtn>

            <div style={{ width: 1, height: 20, background: "hsl(var(--border))", margin: "0 2px" }} />

            <ToolBtn
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              active={editor.isActive("heading", { level: 1 })}
              title="Überschrift 1"
            >
              H1
            </ToolBtn>
            <ToolBtn
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              active={editor.isActive("heading", { level: 2 })}
              title="Überschrift 2"
            >
              H2
            </ToolBtn>
            <ToolBtn
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              active={editor.isActive("heading", { level: 3 })}
              title="Überschrift 3"
            >
              H3
            </ToolBtn>

            <div style={{ width: 1, height: 20, background: "hsl(var(--border))", margin: "0 2px" }} />

            <ToolBtn
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              active={editor.isActive("bulletList")}
              title="Aufzählungsliste"
            >
              <List className="w-3.5 h-3.5" />
            </ToolBtn>
            <ToolBtn
              onClick={() => editor.chain().focus().setHorizontalRule().run()}
              active={false}
              title="Trennlinie"
            >
              <Minus className="w-3.5 h-3.5" />
            </ToolBtn>
          </div>

          {/* Editor content — white bg for document feel */}
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
        <div
          className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
        >
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
                <>
                  <CheckCircle className="w-3.5 h-3.5" />
                  HTML kopiert!
                </>
              ) : (
                <>
                  <Clipboard className="w-3.5 h-3.5" />
                  Als HTML kopieren
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
