import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/Tooltip";
import { Plus, X, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useStartAnalysis } from "@workspace/api-client-react";

const SOCIAL_PLATFORMS = [
  { key: "linkedin", label: "LinkedIn" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "wechat", label: "WeChat" },
  { key: "twitter", label: "Twitter / X" },
  { key: "kununu", label: "Kununu" },
  { key: "xing", label: "Xing" },
] as const;

export function DomainAnalyseView() {
  const { domainForm, setDomainForm, setAnalysisId, setAnalysisStatus, setActiveView } = useAppStore();
  const startAnalysis = useStartAnalysis();
  const [errors, setErrors] = useState<{ companyName?: string; url?: string }>({});

  const updateField = <K extends keyof typeof domainForm>(key: K, value: typeof domainForm[K]) => {
    setDomainForm({ ...domainForm, [key]: value });
  };

  const updateSocial = (key: string, value: string) => {
    setDomainForm({ ...domainForm, social: { ...domainForm.social, [key]: value } });
  };

  const updateCompetitor = (index: number, value: string) => {
    const next = [...domainForm.competitors];
    next[index] = value;

    // Auto-add new field if last field was filled and we're under limit
    if (value.trim() !== "" && index === next.length - 1 && next.length < 10) {
      next.push("");
    }
    setDomainForm({ ...domainForm, competitors: next });
  };

  const removeCompetitor = (index: number) => {
    const next = domainForm.competitors.filter((_, i) => i !== index);
    // Always keep at least 1
    setDomainForm({ ...domainForm, competitors: next.length > 0 ? next : [""] });
  };

  const validate = () => {
    const errs: { companyName?: string; url?: string } = {};
    if (!domainForm.companyName.trim()) errs.companyName = "Bitte Unternehmensname eingeben";
    if (!domainForm.url.trim()) errs.url = "Bitte Website-URL eingeben";
    else if (!domainForm.url.startsWith("http")) errs.url = "Bitte eine gültige URL eingeben (https://...)";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleStart = () => {
    if (!validate()) return;

    const competitorUrls = domainForm.competitors.filter((c) => c.trim()).join("\n");
    const socialLines = Object.entries(domainForm.social)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    startAnalysis.mutate(
      {
        data: {
          mode: "url",
          url: domainForm.url.trim(),
          questionnaire: {
            companyName: domainForm.companyName.trim() || null,
            competitors: competitorUrls || null,
            buyerPersonas: domainForm.personas.trim() || null,
            socialMedia: socialLines || null,
          },
        },
      },
      {
        onSuccess: (result) => {
          setAnalysisId(result.id);
          setAnalysisStatus("running");
          setActiveView(3);
        },
        onError: () => {
          setAnalysisStatus("failed");
        },
      },
    );
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-bold font-mono tracking-tight">Domainanalyse – Basisdaten</h1>
        <p className="text-sm text-muted-foreground mt-1">Website crawlen und alle 7 Analysemodule ausführen.</p>
      </div>

      {/* Section: Unternehmen & Website */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold font-mono text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
          Unternehmen &amp; Website
        </h2>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="companyName">Unternehmensname</Label>
            <Tooltip text="Bitte geben Sie die korrekte Unternehmensbezeichnung ein" />
          </div>
          <Input
            id="companyName"
            value={domainForm.companyName}
            onChange={(e) => updateField("companyName", e.target.value)}
            placeholder="Muster GmbH"
            data-testid="input-company-name"
          />
          {errors.companyName && (
            <p className="text-xs text-destructive">{errors.companyName}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="websiteUrl">Website-URL</Label>
            <Tooltip text="Bitte Ihre hier zu analysierende Website eintragen" />
          </div>
          <Input
            id="websiteUrl"
            type="url"
            value={domainForm.url}
            onChange={(e) => updateField("url", e.target.value)}
            placeholder="https://www.beispiel.de"
            data-testid="input-url"
          />
          {errors.url && (
            <p className="text-xs text-destructive">{errors.url}</p>
          )}
        </div>
      </section>

      {/* Section: Wettbewerber */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold font-mono text-muted-foreground uppercase tracking-wider border-b border-border pb-1 flex items-center gap-1.5">
          Wettbewerber-Domains
          <Tooltip text="Die Website-Adresse/n Ihrer wichtigsten Wettbewerber" />
        </h2>

        <div className="space-y-2">
          {domainForm.competitors.map((comp, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                type="url"
                value={comp}
                onChange={(e) => updateCompetitor(i, e.target.value)}
                onBlur={(e) => updateCompetitor(i, e.target.value)}
                placeholder="https://www.wettbewerber.de"
                data-testid={`input-competitor-${i}`}
              />
              {domainForm.competitors.length > 1 && (
                <button
                  onClick={() => removeCompetitor(i)}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Entfernen"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {domainForm.competitors.length < 10 && domainForm.competitors.every((c) => c.trim() !== "") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDomainForm({ ...domainForm, competitors: [...domainForm.competitors, ""] })}
              className="text-muted-foreground text-xs"
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              Weiteren Wettbewerber hinzufügen
            </Button>
          )}
        </div>
      </section>

      {/* Section: Social Media */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold font-mono text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
          Social Media &amp; Online-Profile
        </h2>
        <p className="text-xs text-muted-foreground -mt-2">Optional — URL oder Profilname</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {SOCIAL_PLATFORMS.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`social-${key}`} className="text-muted-foreground text-xs">
                {label}
              </Label>
              <Input
                id={`social-${key}`}
                value={domainForm.social[key as keyof typeof domainForm.social]}
                onChange={(e) => updateSocial(key, e.target.value)}
                placeholder="https://..."
                className="text-xs"
                data-testid={`input-social-${key}`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Section: Zielgruppen */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold font-mono text-muted-foreground uppercase tracking-wider border-b border-border pb-1 flex items-center gap-1.5">
          Zielgruppen / Käuferpersonas
          <Tooltip text="Hier Ihre Zielbranchen und Zielpersonen (Einkäufer, Projektingenieure, R+D…) eintragen" />
        </h2>

        <Textarea
          value={domainForm.personas}
          onChange={(e) => updateField("personas", e.target.value)}
          placeholder="z. B. Einkaufsleiter in der Automobilindustrie, Projektingenieure im Maschinenbau, F&E-Verantwortliche..."
          className="min-h-[96px]"
          data-testid="input-personas"
        />
      </section>

      {/* CTA */}
      <Button
        size="lg"
        className="w-full"
        onClick={handleStart}
        disabled={startAnalysis.isPending}
        data-testid="button-start-analysis"
      >
        {startAnalysis.isPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : null}
        Analyse starten
      </Button>
    </div>
  );
}
