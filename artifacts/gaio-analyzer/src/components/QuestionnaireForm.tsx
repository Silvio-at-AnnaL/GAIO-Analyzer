import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ChevronRight, ChevronLeft, SkipForward } from "lucide-react";

interface QuestionnaireData {
  companyPitch?: string | null;
  companyName?: string | null;
  brandName?: string | null;
  brandVariants?: string | null;
  subBrands?: string | null;
  slogans?: string | null;
  buyerPersonas?: string | null;
  geographicFocus?: string | null;
  contentLanguages?: string | null;
  competitors?: string | null;
  differentiators?: string | null;
  influencers?: string | null;
  socialMedia?: string | null;
  microsites?: string | null;
  directories?: string | null;
  reviewPlatforms?: string | null;
  seoTools?: string | null;
  dataSources?: string | null;
  restrictions?: string | null;
  strategicPriority?: string | null;
  kpis?: string | null;
  weightingPreferences?: string | null;
  plannedCampaigns?: string | null;
}

interface Props {
  initialData: QuestionnaireData;
  onComplete: (data: QuestionnaireData) => void;
  onSkip: () => void;
}

const SECTIONS = [
  {
    key: "A",
    title: "Markengrundlagen",
    description: "Grundlegende Informationen zu Ihrem Unternehmen und Ihrer Marke",
    fields: [
      { key: "companyPitch", label: "Elevator Pitch (1-2 Saetze)", type: "textarea" },
      { key: "companyName", label: "Offizieller Firmenname (inkl. Rechtsform)", type: "input" },
      { key: "brandName", label: "Hauptmarkenname", type: "input" },
      { key: "brandVariants", label: "Schreibvarianten / Abkuerzungen", type: "input" },
      { key: "subBrands", label: "Sub-Marken, Produktmarken, fruehere Namen", type: "textarea" },
      { key: "slogans", label: "Slogans, Hashtags, proprietaere Begriffe", type: "textarea" },
    ],
  },
  {
    key: "B",
    title: "Zielmarkt",
    description: "Informationen zu Ihren Zielgruppen und Maerkten",
    fields: [
      { key: "buyerPersonas", label: "Primaere Kaeufer-Personas (Branche / Position / Entscheidungskriterien)", type: "textarea" },
      { key: "geographicFocus", label: "Geografischer Fokus (Laender/Regionen)", type: "input" },
      { key: "contentLanguages", label: "Content-Sprachen", type: "input" },
    ],
  },
  {
    key: "C",
    title: "Wettbewerbsumfeld",
    description: "Ihre Wettbewerber und Alleinstellungsmerkmale",
    fields: [
      { key: "competitors", label: "Top-Wettbewerber (Name + URL, je Zeile einer)", type: "textarea" },
      { key: "differentiators", label: "Wesentliche Differenzierungsmerkmale", type: "textarea" },
      { key: "influencers", label: "Bekannte Branchen-Influencer / Thought Leader", type: "textarea" },
    ],
  },
  {
    key: "D",
    title: "Digitale Praesenz",
    description: "Ihre Online-Kanaele und Verzeichnisse",
    fields: [
      { key: "socialMedia", label: "Social-Media-Profile (LinkedIn, X, YouTube, etc.)", type: "textarea" },
      { key: "microsites", label: "Microsites, Support-Portale, Dokumentations-Domains", type: "textarea" },
      { key: "directories", label: "Branchenverzeichnisse (IndustryStock, Kompass, Thomasnet, etc.)", type: "input" },
      { key: "reviewPlatforms", label: "Bewertungsplattformen (G2, Capterra, Trustpilot, kununu, etc.)", type: "input" },
    ],
  },
  {
    key: "E",
    title: "Technischer Zugang",
    description: "Vorhandene Tools und Datenquellen",
    fields: [
      { key: "seoTools", label: "SEO-/Monitoring-Tool-Lizenzen (Ahrefs, Semrush, etc.)", type: "input" },
      { key: "dataSources", label: "Interne Datenquellen (GA4, Search Console, CRM)", type: "input" },
      { key: "restrictions", label: "Technische/Compliance-Einschraenkungen (DSGVO, NDA, etc.)", type: "textarea" },
    ],
  },
  {
    key: "F",
    title: "Projektziele",
    description: "Strategische Prioritaeten und KPIs",
    fields: [
      { key: "strategicPriority", label: "Strategische Prioritaet (Reichweite, Reputation, Backlinks, Gen-AI Sichtbarkeit)", type: "textarea" },
      { key: "kpis", label: "Erforderliche KPIs oder Schwellenwerte", type: "textarea" },
      { key: "weightingPreferences", label: "Bevorzugte Gewichtung der Analysedimensionen", type: "textarea" },
      { key: "plannedCampaigns", label: "Geplante Kampagnen/Launches in den naechsten 12 Monaten", type: "textarea" },
    ],
  },
];

export function QuestionnaireForm({ initialData, onComplete, onSkip }: Props) {
  const [sectionIndex, setSectionIndex] = useState(0);
  const [data, setData] = useState<QuestionnaireData>(initialData);

  const section = SECTIONS[sectionIndex];

  const updateField = (key: string, value: string) => {
    setData((prev) => ({ ...prev, [key]: value || null }));
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold font-mono tracking-tight">Fragebogen</h1>
        <p className="text-muted-foreground text-sm max-w-lg mx-auto">
          Alle Felder sind optional, verbessern aber die Analysequalitaet erheblich. Sie koennen diesen Schritt auch ueberspringen.
        </p>
      </div>

      <div className="flex items-center justify-center gap-1 mb-6">
        {SECTIONS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => setSectionIndex(i)}
            className={`w-8 h-1.5 rounded-full transition-colors ${
              i === sectionIndex ? "bg-primary" : i < sectionIndex ? "bg-primary/40" : "bg-muted"
            }`}
            data-testid={`section-indicator-${s.key}`}
          />
        ))}
      </div>

      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
              Sektion {section.key}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {sectionIndex + 1}/{SECTIONS.length}
            </span>
          </div>
          <CardTitle className="text-lg">{section.title}</CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {section.fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={field.key} className="text-sm">
                {field.label}
              </Label>
              {field.type === "textarea" ? (
                <Textarea
                  id={field.key}
                  value={(data as Record<string, string | null | undefined>)[field.key] || ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className="min-h-[80px] bg-background"
                  data-testid={`input-${field.key}`}
                />
              ) : (
                <Input
                  id={field.key}
                  value={(data as Record<string, string | null | undefined>)[field.key] || ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className="bg-background"
                  data-testid={`input-${field.key}`}
                />
              )}
            </div>
          ))}

          <div className="flex items-center justify-between pt-4">
            <div className="flex gap-2">
              {sectionIndex > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSectionIndex((i) => i - 1)}
                  data-testid="button-prev-section"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Zurueck
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onSkip}
                className="text-muted-foreground"
                data-testid="button-skip"
              >
                <SkipForward className="w-4 h-4 mr-1" />
                Ueberspringen
              </Button>
              {sectionIndex < SECTIONS.length - 1 ? (
                <Button
                  size="sm"
                  onClick={() => setSectionIndex((i) => i + 1)}
                  data-testid="button-next-section"
                >
                  Weiter
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => onComplete(data)}
                  data-testid="button-complete-questionnaire"
                >
                  Analyse starten
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
