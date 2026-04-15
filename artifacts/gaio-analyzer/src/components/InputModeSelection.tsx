import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Globe, FileCode, ChevronLeft, Loader2, Upload } from "lucide-react";
import { useStartAnalysis } from "@workspace/api-client-react";

interface Props {
  questionnaireData: Record<string, unknown>;
  onAnalysisStarted: (id: string) => void;
  onBack: () => void;
}

export function InputModeSelection({ questionnaireData, onAnalysisStarted, onBack }: Props) {
  const [mode, setMode] = useState<"url" | "html">("url");
  const [url, setUrl] = useState("");
  const [html, setHtml] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startAnalysis = useStartAnalysis();

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      if (typeof content === "string") {
        setHtml(content);
      }
    };
    reader.readAsText(file);
  };

  const handleStart = () => {
    startAnalysis.mutate(
      {
        data: {
          mode,
          url: mode === "url" ? url : undefined,
          html: mode === "html" ? html : undefined,
          questionnaire: questionnaireData as Record<string, string | null>,
        },
      },
      {
        onSuccess: (result) => {
          onAnalysisStarted(result.id);
        },
      },
    );
  };

  const isValid = mode === "url" ? url.trim().length > 0 : html.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold font-mono tracking-tight">Eingabemodus</h1>
        <p className="text-muted-foreground text-sm max-w-lg mx-auto">
          Waehlen Sie, wie Sie die zu analysierende Website bereitstellen moechten.
        </p>
      </div>

      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-lg">Analyseziel</CardTitle>
          <CardDescription>Domain-Eingabe oder HTML-Upload</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as "url" | "html")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="url" className="gap-2" data-testid="tab-url">
                <Globe className="w-4 h-4" />
                Domain-Eingabe
              </TabsTrigger>
              <TabsTrigger value="html" className="gap-2" data-testid="tab-html">
                <FileCode className="w-4 h-4" />
                HTML-Upload
              </TabsTrigger>
            </TabsList>

            <TabsContent value="url" className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">
                  Website-URL eingeben (z.B. https://beispiel.de)
                </label>
                <Input
                  type="url"
                  placeholder="https://"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="font-mono bg-background"
                  data-testid="input-url"
                />
                <p className="text-xs text-muted-foreground">
                  Die Startseite + bis zu 15 Unterseiten werden gecrawlt. robots.txt wird respektiert.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="html" className="space-y-4 pt-4">
              <div className="space-y-2">
                <label className="text-sm text-muted-foreground">
                  HTML-Code einfuegen oder Datei hochladen
                </label>
                <Textarea
                  placeholder="<!DOCTYPE html>..."
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                  className="min-h-[200px] font-mono text-xs bg-background"
                  data-testid="input-html"
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".html,.htm"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="button-upload-html"
                  >
                    <Upload className="w-4 h-4 mr-1" />
                    .html Datei hochladen
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Analyse nur fuer diese einzelne Seite. Crawler-abhaengige Module werden deaktiviert.
                </p>
              </div>
            </TabsContent>
          </Tabs>

          <div className="flex items-center justify-between pt-4 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              data-testid="button-back"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Zurueck
            </Button>
            <Button
              size="sm"
              onClick={handleStart}
              disabled={!isValid || startAnalysis.isPending}
              data-testid="button-start-analysis"
            >
              {startAnalysis.isPending ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : null}
              Analyse starten
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
