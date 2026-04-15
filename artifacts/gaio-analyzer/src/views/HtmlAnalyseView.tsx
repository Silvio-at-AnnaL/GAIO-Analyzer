import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, Upload, FileText, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useStartAnalysis } from "@workspace/api-client-react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function HtmlAnalyseView() {
  const { htmlForm, setHtmlForm, setAnalysisId, setAnalysisStatus, setActiveView } = useAppStore();
  const startAnalysis = useStartAnalysis();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"code" | "upload">("code");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = (file: File) => {
    if (!file.name.match(/\.(html?|htm)$/i)) {
      setError("Nur .html und .htm Dateien werden akzeptiert.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      if (typeof content === "string") {
        setHtmlForm({ code: content, filename: file.name, fileSize: file.size });
        setError(null);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleStart = () => {
    const html = htmlForm.code.trim();
    if (!html) {
      setError("Bitte HTML-Code einfügen oder eine Datei hochladen.");
      return;
    }
    setError(null);

    startAnalysis.mutate(
      { data: { mode: "html", html } },
      {
        onSuccess: (result) => {
          setAnalysisId(result.id);
          setAnalysisStatus("running");
          setActiveView(3);
        },
        onError: () => {
          setAnalysisStatus("failed");
          setError("Analyse konnte nicht gestartet werden. Bitte erneut versuchen.");
        },
      },
    );
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-bold font-mono tracking-tight">HTML-Analyse</h1>
        <p className="text-sm text-muted-foreground mt-1">Einzelne HTML-Seite analysieren.</p>
      </div>

      {/* Info box */}
      <div className="flex gap-3 p-3 rounded-lg border border-border bg-muted/30 text-sm text-muted-foreground">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-primary" />
        <p>
          Wenn Sie diesen Weg wählen, wird nur die einzelne Seite analysiert, die Sie hier bereitstellen. Crawler-abhängige Module werden übersprungen.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "code" | "upload")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="code" data-testid="tab-code">Code einfügen</TabsTrigger>
          <TabsTrigger value="upload" data-testid="tab-upload">Datei hochladen</TabsTrigger>
        </TabsList>

        <TabsContent value="code" className="pt-4 space-y-2">
          <Textarea
            value={htmlForm.code}
            onChange={(e) => setHtmlForm({ ...htmlForm, code: e.target.value })}
            placeholder="HTML-Code hier einfügen..."
            className="min-h-[400px] font-mono text-xs bg-background resize-y"
            data-testid="input-html-code"
          />
        </TabsContent>

        <TabsContent value="upload" className="pt-4 space-y-4">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors"
            style={{
              borderColor: dragging ? "hsl(var(--primary))" : "hsl(var(--border))",
              background: dragging ? "hsl(var(--primary) / 0.05)" : "transparent",
            }}
            data-testid="drop-zone"
          >
            <Upload className="w-8 h-8 text-muted-foreground" />
            <div className="text-center">
              <p className="text-sm font-medium">Datei hierher ziehen</p>
              <p className="text-xs text-muted-foreground">oder klicken zum Auswählen</p>
              <p className="text-xs text-muted-foreground mt-1">.html, .htm</p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />

          {htmlForm.filename && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
              <FileText className="w-4 h-4 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{htmlForm.filename}</p>
                {htmlForm.fileSize !== null && (
                  <p className="text-xs text-muted-foreground">{formatBytes(htmlForm.fileSize)}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="text-xs"
              >
                Ersetzen
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button
        size="lg"
        className="w-full"
        onClick={handleStart}
        disabled={startAnalysis.isPending}
        data-testid="button-start-html-analysis"
      >
        {startAnalysis.isPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : null}
        Analyse starten
      </Button>
    </div>
  );
}
