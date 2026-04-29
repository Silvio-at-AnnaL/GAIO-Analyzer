import { Mail } from "lucide-react";

const EMAIL = "Silvio.Haase@IndustryStock.com";
const BASE  = import.meta.env.BASE_URL;

export function KontaktView() {
  return (
    <div className="max-w-2xl space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kontakt</h1>
        <p className="text-muted-foreground mt-1">
          Ihr Ansprechpartner für GAIO Analyzer und LLM-Sichtbarkeit.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-8 space-y-8">
        {/* Logo */}
        <div className="flex justify-center sm:justify-start">
          <img
            src={`${BASE}brand-logo.png`}
            alt="Deutscher Medien Verlag / IndustryStock.com"
            className="h-14 w-auto object-contain"
            onError={(e) => {
              const el = e.currentTarget as HTMLImageElement;
              el.style.display = "none";
              const ph = el.nextElementSibling as HTMLElement | null;
              if (ph) ph.style.removeProperty("display");
            }}
          />
          <div
            className="hidden h-14 items-center justify-center rounded-md border border-border bg-muted/40 px-4 text-xs text-muted-foreground"
            style={{ display: "none" }}
          >
            [Bild: Brand-Logo]
          </div>
        </div>

        {/* Contact person */}
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="shrink-0">
            <img
              src={`${BASE}kontakt-silvio.webp`}
              alt="Silvio Haase"
              className="w-[120px] h-[120px] rounded-full object-cover object-top border-2 border-border"
              onError={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                el.style.display = "none";
                const ph = el.nextElementSibling as HTMLElement | null;
                if (ph) ph.style.removeProperty("display");
              }}
            />
            <div
              className="w-[120px] h-[120px] rounded-full items-center justify-center bg-muted border border-border text-xs text-muted-foreground text-center leading-tight p-2"
              style={{ display: "none" }}
            >
              [Bild:<br />Silvio Haase]
            </div>
          </div>

          <div className="text-center sm:text-left space-y-1 pt-1">
            <p className="text-lg font-bold">Silvio Haase</p>
            <p className="text-sm text-muted-foreground">CMO &amp; Head of Business Development</p>
            <p className="text-sm text-muted-foreground">
              Deutscher Medien Verlag GmbH / IndustryStock.com
            </p>
            <a
              href={`mailto:${EMAIL}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium pt-1"
              style={{ color: "hsl(var(--primary))" }}
            >
              <Mail className="w-4 h-4 shrink-0" />
              {EMAIL}
            </a>
          </div>
        </div>

        {/* Activating text */}
        <div className="space-y-3 border-t border-border pt-6 text-sm leading-relaxed">
          <p className="text-foreground/90">
            Sie haben Fragen zum GAIO Analyzer, möchten eine Analyse für Ihr Unternehmen
            durchführen lassen oder interessieren sich für eine individuelle Beratung zur
            LLM-Sichtbarkeit Ihrer Website?
          </p>
          <p className="text-muted-foreground">
            Sprechen Sie uns einfach an — wir antworten schnell und unkompliziert.
          </p>
        </div>

        {/* CTA */}
        <div className="flex justify-center sm:justify-start">
          <a
            href={`mailto:${EMAIL}`}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            style={{ background: "hsl(var(--primary))" }}
          >
            <Mail className="w-4 h-4 shrink-0" />
            E-Mail schreiben
          </a>
        </div>
      </div>
    </div>
  );
}
