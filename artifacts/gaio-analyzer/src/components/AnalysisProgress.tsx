import { useEffect, useState } from "react";
import { useGetAnalysisReport, getGetAnalysisReportQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

interface Props {
  analysisId: string;
  onComplete: () => void;
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

export function AnalysisProgress({ analysisId, onComplete }: Props) {
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
        setCompletedModules((prev) => [...prev, currentModuleName]);
      }
      setCurrentModuleName(report.currentModule);
    }

    if (report?.status === "completed") {
      setTimeout(() => onComplete(), 500);
    }
  }, [report, currentModuleName, completedModules, onComplete]);

  const progress = report?.progress ?? 0;
  const isFailed = report?.status === "failed";

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold font-mono tracking-tight">
          {isFailed ? "Analyse fehlgeschlagen" : "Analyse laeuft"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isFailed
            ? "Es sind Fehler aufgetreten. Bitte versuchen Sie es erneut."
            : "Bitte warten Sie, waehrend die Module ausgefuehrt werden..."}
        </p>
      </div>

      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {isFailed ? (
              <XCircle className="w-5 h-5 text-destructive" />
            ) : (
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            )}
            <span className="text-sm font-medium">
              {report?.currentModule || "Initialisierung..."}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Fortschritt</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="space-y-2">
            {MODULE_NAMES.map((name) => {
              const isCompleted = completedModules.includes(name);
              const isCurrent = name === currentModuleName;
              const isError = isFailed && isCurrent;

              return (
                <div
                  key={name}
                  className={`flex items-center gap-3 py-2 px-3 rounded text-sm transition-colors ${
                    isCurrent
                      ? "bg-primary/10 text-foreground"
                      : isCompleted
                        ? "text-muted-foreground"
                        : "text-muted-foreground/40"
                  }`}
                >
                  {isError ? (
                    <XCircle className="w-4 h-4 text-destructive shrink-0" />
                  ) : isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  ) : isCurrent ? (
                    <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-muted-foreground/20 shrink-0" />
                  )}
                  <span className="text-sm font-medium">{name}</span>
                </div>
              );
            })}
          </div>

          {report?.errors && report.errors.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-border">
              <p className="text-xs font-mono text-destructive">Fehler:</p>
              {report.errors.map((err, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  - {err}
                </p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
