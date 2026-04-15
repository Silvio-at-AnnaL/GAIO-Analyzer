import { useState } from "react";
import { QuestionnaireForm } from "@/components/QuestionnaireForm";
import { InputModeSelection } from "@/components/InputModeSelection";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { ReportDashboard } from "@/components/ReportDashboard";
import { useHealthCheck } from "@workspace/api-client-react";

export default function Home() {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [questionnaireData, setQuestionnaireData] = useState<Record<string, string | null | undefined>>({});
  const [analysisId, setAnalysisId] = useState<string | null>(null);

  useHealthCheck(); // Keep connection alive

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">
      <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center px-4 md:px-6">
          <div className="flex items-center gap-2 font-bold font-mono tracking-tight text-lg">
            <div className="w-4 h-4 rounded bg-primary animate-pulse" />
            GAIO_ANALYZER_
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm text-muted-foreground font-mono">
            {step > 1 && <span>Schritt {step}/4</span>}
          </div>
        </div>
      </header>

      <main className="container px-4 md:px-6 py-6 md:py-10 max-w-6xl mx-auto">
        {step === 1 && (
          <QuestionnaireForm
            initialData={questionnaireData}
            onComplete={(data) => {
              setQuestionnaireData(data);
              setStep(2);
            }}
            onSkip={() => {
              setStep(2);
            }}
          />
        )}

        {step === 2 && (
          <InputModeSelection
            questionnaireData={questionnaireData}
            onAnalysisStarted={(id) => {
              setAnalysisId(id);
              setStep(3);
            }}
            onBack={() => setStep(1)}
          />
        )}

        {step === 3 && analysisId && (
          <AnalysisProgress
            analysisId={analysisId}
            onComplete={() => setStep(4)}
          />
        )}

        {step === 4 && analysisId && (
          <ReportDashboard analysisId={analysisId} />
        )}
      </main>
    </div>
  );
}
