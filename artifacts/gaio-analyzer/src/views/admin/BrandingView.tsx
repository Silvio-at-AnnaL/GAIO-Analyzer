import { useState, useEffect, useRef } from "react";
import { Palette, UploadCloud, RotateCcw, Save, CheckCircle, AlertCircle } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { useBranding } from "@/store/brandingStore";

interface BrandingSettings {
  branding_logo_base64: string;
  branding_logo_mimetype: string;
  branding_footer_text: string;
  branding_footer_url: string;
}

const MAX_B64_BYTES = 500 * 1024;

function sizeOk(dataUrl: string): boolean {
  const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return Math.round((b64.length * 3) / 4) <= MAX_B64_BYTES;
}

export function BrandingView() {
  const branding = useBranding();

  const [logoPreview, setLogoPreview] = useState<string>("");
  const [logoChanged, setLogoChanged] = useState(false);
  const [footerText, setFooterText]   = useState("IndustryStock.com");
  const [footerUrl, setFooterUrl]     = useState("https://www.industrystock.com");

  const [logoStatus, setLogoStatus]   = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [logoMsg, setLogoMsg]         = useState("");
  const [footerStatus, setFooterStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [footerMsg, setFooterMsg]     = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    adminFetch("/api/admin/settings/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: BrandingSettings | null) => {
        if (!d) return;
        setLogoPreview(d.branding_logo_base64 ?? "");
        setFooterText(d.branding_footer_text ?? "IndustryStock.com");
        setFooterUrl(d.branding_footer_url ?? "https://www.industrystock.com");
      })
      .catch(() => {});
  }, []);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!sizeOk(dataUrl)) {
        setLogoMsg("Datei zu groß. Maximal 500 KB erlaubt.");
        setLogoStatus("error");
        return;
      }
      setLogoPreview(dataUrl);
      setLogoChanged(true);
      setLogoStatus("idle");
      setLogoMsg("");
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function saveLogo() {
    setLogoStatus("saving");
    setLogoMsg("");
    try {
      const body: Record<string, string> = {};
      if (logoChanged) {
        body.branding_logo_base64 = logoPreview;
      } else {
        body.branding_logo_base64 = "";
      }
      const res = await adminFetch("/api/admin/settings/branding", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setLogoStatus("ok");
        setLogoMsg("Logo gespeichert.");
        setLogoChanged(false);
        window.dispatchEvent(new Event("branding-updated"));
      } else {
        const d = (await res.json()) as { error?: string };
        setLogoStatus("error");
        setLogoMsg(d.error ?? "Fehler beim Speichern.");
      }
    } catch {
      setLogoStatus("error");
      setLogoMsg("Netzwerkfehler.");
    }
  }

  async function resetLogo() {
    setLogoStatus("saving");
    setLogoMsg("");
    try {
      const res = await adminFetch("/api/admin/settings/branding", {
        method: "PATCH",
        body: JSON.stringify({ branding_logo_base64: "" }),
      });
      if (res.ok) {
        setLogoPreview("");
        setLogoChanged(false);
        setLogoStatus("ok");
        setLogoMsg("Logo auf Standard zurückgesetzt.");
        window.dispatchEvent(new Event("branding-updated"));
      } else {
        setLogoStatus("error");
        setLogoMsg("Fehler beim Zurücksetzen.");
      }
    } catch {
      setLogoStatus("error");
      setLogoMsg("Netzwerkfehler.");
    }
  }

  async function saveFooter() {
    setFooterStatus("saving");
    setFooterMsg("");
    try {
      const res = await adminFetch("/api/admin/settings/branding", {
        method: "PATCH",
        body: JSON.stringify({ branding_footer_text: footerText, branding_footer_url: footerUrl }),
      });
      if (res.ok) {
        setFooterStatus("ok");
        setFooterMsg("Footer gespeichert.");
        window.dispatchEvent(new Event("branding-updated"));
      } else {
        setFooterStatus("error");
        setFooterMsg("Fehler beim Speichern.");
      }
    } catch {
      setFooterStatus("error");
      setFooterMsg("Netzwerkfehler.");
    }
  }

  const effectiveLogo = logoPreview || (branding.isLoaded && !branding.logoSrc ? null : branding.logoSrc || null);

  return (
    <div className="max-w-2xl space-y-6 pb-12">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Palette className="w-5 h-5" style={{ color: "#3b82f6" }} />
          <h1 className="text-2xl font-bold tracking-tight">Erscheinungsbild</h1>
        </div>
        <p className="text-muted-foreground text-sm">Logo und Footer-Branding der Anwendung anpassen.</p>
      </div>

      {/* Card: Logo */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold">Logo</h2>

        {/* Preview */}
        <div className="flex items-center justify-center rounded-lg border border-border bg-background" style={{ minHeight: 96, padding: 16 }}>
          {effectiveLogo ? (
            <img
              src={effectiveLogo}
              alt="Logo-Vorschau"
              style={{ maxHeight: 120, maxWidth: "100%", objectFit: "contain" }}
            />
          ) : (
            <div style={{ height: 48, display: "flex", alignItems: "center", color: "hsl(var(--muted-foreground))", fontSize: 13 }}>
              <img
                src="/brand-logo.png"
                alt="Standard-Logo"
                style={{ maxHeight: 120, maxWidth: "100%", objectFit: "contain" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
        </div>

        {/* Upload */}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          className="hidden"
          onChange={onFileChange}
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-border bg-background hover:bg-muted transition-colors"
          >
            <UploadCloud className="w-4 h-4" />
            Logo hochladen
          </button>
          <button
            onClick={resetLogo}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-border bg-background hover:bg-muted transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Auf Standard zurücksetzen
          </button>
          <button
            onClick={saveLogo}
            disabled={logoStatus === "saving"}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#3b82f6" }}
          >
            <Save className="w-4 h-4" />
            {logoStatus === "saving" ? "Speichern…" : "Speichern"}
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          Empfohlenes Format: PNG mit transparentem Hintergrund, min. 300 px Breite. Maximal 500 KB.
        </p>

        {logoMsg && (
          <div className="flex items-center gap-2 text-sm" style={{ color: logoStatus === "ok" ? "#3b82f6" : "#d97706" }}>
            {logoStatus === "ok" ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {logoMsg}
          </div>
        )}
      </div>

      {/* Card: Footer */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold">Footer</h2>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Footer-Text</label>
            <input
              type="text"
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2"
              style={{ accentColor: "#3b82f6" }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Footer-URL</label>
            <input
              type="url"
              value={footerUrl}
              onChange={(e) => setFooterUrl(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Wird im Footer der App sowie in PDF- und HTML-Exporten angezeigt.
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={saveFooter}
            disabled={footerStatus === "saving"}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#3b82f6" }}
          >
            <Save className="w-4 h-4" />
            {footerStatus === "saving" ? "Speichern…" : "Speichern"}
          </button>
          {footerMsg && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: footerStatus === "ok" ? "#3b82f6" : "#d97706" }}>
              {footerStatus === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {footerMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
