import { useState, useEffect } from "react";
import { Mail } from "lucide-react";
import { useBranding } from "@/store/brandingStore";
import { useT } from "@/lib/LabelProvider";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ContactInfo {
  name: string;
  title: string;
  company: string;
  email: string;
  photoSrc: string;
  ctaText: string;
  ctaSubtext: string;
}

const DEFAULT_CONTACT: ContactInfo = {
  name:       "Silvio Haase",
  title:      "CMO & Head of Business Development",
  company:    "Deutscher Medien Verlag GmbH / IndustryStock.com",
  email:      "Silvio.Haase@IndustryStock.com",
  photoSrc:   "",
  ctaText:    "Sie haben Fragen zum GAIO Analyzer, möchten eine Analyse für Ihr Unternehmen durchführen lassen oder interessieren sich für eine individuelle Beratung zur LLM-Sichtbarkeit Ihrer Website?",
  ctaSubtext: "Sprechen Sie uns einfach an — wir antworten schnell und unkompliziert.",
};

function SkeletonLine({ w }: { w?: string }) {
  return (
    <div
      className="animate-pulse rounded"
      style={{ height: 14, width: w ?? "100%", background: "hsl(var(--muted))", marginBottom: 6 }}
    />
  );
}

export function KontaktView() {
  const t = useT();
  const branding = useBranding();
  const [contact, setContact] = useState<ContactInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/admin/public/contact`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ContactInfo | null) => { if (d) setContact(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const c = contact ?? DEFAULT_CONTACT;
  const logoSrc = branding.logoSrc || null;

  return (
    <div className="max-w-2xl space-y-6 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.kontakt")}</h1>
        <p className="text-muted-foreground mt-1">
          {t("contact.subtitle")}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-8 space-y-8">
        {/* Logo */}
        <div className="flex justify-center sm:justify-start">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Brand-Logo"
              className="h-14 w-auto object-contain"
            />
          ) : (
            <img
              src={`${BASE}/brand-logo.png`}
              alt="Deutscher Medien Verlag / IndustryStock.com"
              className="h-14 w-auto object-contain"
              onError={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                el.style.display = "none";
              }}
            />
          )}
        </div>

        {/* Contact person */}
        {loading ? (
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="w-[120px] h-[120px] rounded-full shrink-0 animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            <div className="flex-1 space-y-2 pt-2 w-full">
              <SkeletonLine w="60%" />
              <SkeletonLine w="80%" />
              <SkeletonLine w="90%" />
              <SkeletonLine w="50%" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <div className="shrink-0">
              {c.photoSrc ? (
                <img
                  src={c.photoSrc}
                  alt={c.name}
                  className="w-[120px] h-[120px] rounded-full object-cover object-top border-2 border-border"
                />
              ) : (
                <>
                  <img
                    src={`${BASE}/kontakt-silvio.webp`}
                    alt={c.name}
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
                    [Bild:<br />{c.name}]
                  </div>
                </>
              )}
            </div>

            <div className="text-center sm:text-left space-y-1 pt-1">
              <p className="text-lg font-bold">{c.name}</p>
              <p className="text-sm text-muted-foreground">{c.title}</p>
              <p className="text-sm text-muted-foreground">{c.company}</p>
              <a
                href={`mailto:${c.email}`}
                className="inline-flex items-center gap-1.5 text-sm font-medium pt-1"
                style={{ color: "hsl(var(--primary))" }}
              >
                <Mail className="w-4 h-4 shrink-0" />
                {c.email}
              </a>
            </div>
          </div>
        )}

        {/* Activating text */}
        {loading ? (
          <div className="space-y-2 border-t border-border pt-6">
            <SkeletonLine />
            <SkeletonLine />
            <SkeletonLine w="70%" />
            <SkeletonLine w="50%" />
          </div>
        ) : (
          <div className="space-y-3 border-t border-border pt-6 text-sm leading-relaxed">
            {c.ctaText && (
              <p className="text-foreground/90">{c.ctaText}</p>
            )}
            {c.ctaSubtext && (
              <p className="text-muted-foreground">{c.ctaSubtext}</p>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="flex justify-center sm:justify-start">
          <a
            href={`mailto:${c.email}`}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            style={{ background: "hsl(var(--primary))" }}
          >
            <Mail className="w-4 h-4 shrink-0" />
            {t("contact.btn_email")}
          </a>
        </div>
      </div>
    </div>
  );
}
