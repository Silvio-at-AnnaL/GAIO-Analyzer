import { useState, useEffect, useRef } from "react";
import { Palette, UploadCloud, RotateCcw, Save, CheckCircle, AlertCircle, Info } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { useBranding, applyThemeToDocument } from "@/store/brandingStore";

interface BrandingSettings {
  branding_logo_base64:   string;
  branding_logo_mimetype: string;
  branding_footer_text:   string;
  branding_footer_url:    string;
}

interface ThemeSettings {
  theme_primary:         string;
  theme_sidebar_bg:      string;
  theme_sidebar_text:    string;
  theme_accent:          string;
  theme_colorblind_mode: string;
}

const THEME_DEFAULTS = {
  primary:     "#2563eb",
  sidebarBg:   "#1e2235",
  sidebarText: "#94a3b8",
  accent:      "#f59e0b",
  colorblind:  false,
};

const MAX_B64_BYTES = 500 * 1024;

function sizeOk(dataUrl: string): boolean {
  const b64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return Math.round((b64.length * 3) / 4) <= MAX_B64_BYTES;
}

function isValidHex(h: string) {
  return /^#[0-9a-fA-F]{6}$/.test(h);
}

function ColorField({
  label, desc, value, onChange,
}: {
  label: string; desc: string; value: string; onChange: (v: string) => void;
}) {
  const [hex, setHex] = useState(value);
  const valid = isValidHex(hex);

  useEffect(() => setHex(value), [value]);

  return (
    <div className="flex items-center gap-3 py-1">
      <label className="relative shrink-0 cursor-pointer" style={{ width: 32, height: 32 }}>
        <span
          className="block w-8 h-8 rounded border"
          style={{ background: valid ? hex : "#ccc", borderColor: "hsl(var(--border))" }}
        />
        <input
          type="color"
          value={valid ? hex : "#000000"}
          onChange={(e) => { setHex(e.target.value); onChange(e.target.value); }}
          className="absolute inset-0 opacity-0 cursor-pointer"
          style={{ width: "100%", height: "100%" }}
        />
      </label>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground truncate">{desc}</div>
      </div>
      <input
        type="text"
        value={hex}
        maxLength={7}
        onChange={(e) => {
          let v = e.target.value;
          if (v && !v.startsWith("#")) v = `#${v}`;
          setHex(v);
          if (isValidHex(v)) onChange(v);
        }}
        className="w-24 rounded border bg-background px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1"
        style={{ borderColor: valid ? "hsl(var(--border))" : "#d97706" }}
      />
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center h-5 w-9 rounded-full transition-colors focus:outline-none shrink-0"
      style={{ background: checked ? "#3b82f6" : "hsl(var(--muted))" }}
      role="switch"
      aria-checked={checked}
    >
      <span
        className="inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function ThemePreview({
  primary, accent, sidebarBg, sidebarText, colorblind,
}: {
  primary: string; accent: string; sidebarBg: string; sidebarText: string; colorblind: boolean;
}) {
  const successBg    = colorblind ? "#eff6ff" : "#dcfce7";
  const successColor = colorblind ? "#2563eb" : "#16a34a";
  const errorBg      = colorblind ? "#fffbeb" : "#fee2e2";
  const errorColor   = colorblind ? "#d97706" : "#dc2626";

  return (
    <div className="rounded-lg border overflow-hidden" style={{ maxWidth: 300, borderColor: "hsl(var(--border))" }}>
      <div className="flex">
        {/* Mini sidebar */}
        <div style={{ width: 56, background: sidebarBg, padding: "12px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
          <div style={{ height: 5, borderRadius: 3, background: primary }} />
          {[0.4, 0.25].map((op, i) => (
            <div key={i} style={{ height: 5, borderRadius: 3, background: sidebarText, opacity: op }} />
          ))}
          <div style={{ height: 1, background: sidebarText, opacity: 0.15, marginTop: 4 }} />
          {[0.15, 0.15].map((op, i) => (
            <div key={i} style={{ height: 5, borderRadius: 3, background: sidebarText, opacity: op }} />
          ))}
        </div>
        {/* Content */}
        <div className="flex-1 p-3 space-y-2.5" style={{ background: "hsl(var(--card))" }}>
          <button
            style={{ background: primary, color: "#fff", fontSize: 11, padding: "4px 10px", borderRadius: 6, fontWeight: 600, border: "none", cursor: "default", display: "block" }}
          >
            Primäre Aktion
          </button>
          <div className="flex gap-2">
            <span style={{ background: successBg, color: successColor, fontSize: 10, padding: "2px 7px", borderRadius: 999, fontWeight: 600 }}>Erfolg</span>
            <span style={{ background: errorBg, color: errorColor, fontSize: 10, padding: "2px 7px", borderRadius: 999, fontWeight: 600 }}>Fehler</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: accent, lineHeight: 1 }}>
            76<span style={{ fontSize: 11, fontWeight: 400, color: "hsl(var(--muted-foreground))" }}>/100</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BrandingView() {
  const branding = useBranding();

  const [logoPreview, setLogoPreview]     = useState<string>("");
  const [logoChanged, setLogoChanged]     = useState(false);
  const [footerText, setFooterText]       = useState("IndustryStock.com");
  const [footerUrl, setFooterUrl]         = useState("https://www.industrystock.com");
  const [logoStatus, setLogoStatus]       = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [logoMsg, setLogoMsg]             = useState("");
  const [footerStatus, setFooterStatus]   = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [footerMsg, setFooterMsg]         = useState("");

  const [primary,     setPrimary]     = useState(THEME_DEFAULTS.primary);
  const [accent,      setAccent]      = useState(THEME_DEFAULTS.accent);
  const [sidebarBg,   setSidebarBg]   = useState(THEME_DEFAULTS.sidebarBg);
  const [sidebarText, setSidebarText] = useState(THEME_DEFAULTS.sidebarText);
  const [colorblind,  setColorblind]  = useState(THEME_DEFAULTS.colorblind);
  const [themeStatus, setThemeStatus] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [themeMsg,    setThemeMsg]    = useState("");

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

    adminFetch("/api/admin/settings/theme")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ThemeSettings | null) => {
        if (!d) return;
        setPrimary(d.theme_primary ?? THEME_DEFAULTS.primary);
        setAccent(d.theme_accent ?? THEME_DEFAULTS.accent);
        setSidebarBg(d.theme_sidebar_bg ?? THEME_DEFAULTS.sidebarBg);
        setSidebarText(d.theme_sidebar_text ?? THEME_DEFAULTS.sidebarText);
        setColorblind(d.theme_colorblind_mode === "true");
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
      body.branding_logo_base64 = logoChanged ? logoPreview : "";
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

  async function saveTheme() {
    setThemeStatus("saving");
    setThemeMsg("");
    try {
      const res = await adminFetch("/api/admin/settings/branding", {
        method: "PATCH",
        body: JSON.stringify({
          theme_primary:         primary,
          theme_sidebar_bg:      sidebarBg,
          theme_sidebar_text:    sidebarText,
          theme_accent:          accent,
          theme_colorblind_mode: String(colorblind),
        }),
      });
      if (res.ok) {
        setThemeStatus("ok");
        setThemeMsg("Farbschema gespeichert.");
        applyThemeToDocument({ primary, sidebarBg, sidebarText, accent, colorblindMode: colorblind });
        window.dispatchEvent(new Event("theme-updated"));
      } else {
        setThemeStatus("error");
        setThemeMsg("Fehler beim Speichern.");
      }
    } catch {
      setThemeStatus("error");
      setThemeMsg("Netzwerkfehler.");
    }
  }

  function resetTheme() {
    setPrimary(THEME_DEFAULTS.primary);
    setAccent(THEME_DEFAULTS.accent);
    setSidebarBg(THEME_DEFAULTS.sidebarBg);
    setSidebarText(THEME_DEFAULTS.sidebarText);
    setColorblind(THEME_DEFAULTS.colorblind);
    setThemeStatus("idle");
    setThemeMsg("");
  }

  const effectiveLogo = logoPreview || (branding.isLoaded && !branding.logoSrc ? null : branding.logoSrc || null);

  return (
    <div className="max-w-2xl space-y-6 pb-12">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Palette className="w-5 h-5" style={{ color: "#3b82f6" }} />
          <h1 className="text-2xl font-bold tracking-tight">Erscheinungsbild</h1>
        </div>
        <p className="text-muted-foreground text-sm">Logo, Footer-Branding und Farbschema der Anwendung anpassen.</p>
      </div>

      {/* Card: Logo */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="text-base font-semibold">Logo</h2>
        <div className="flex items-center justify-center rounded-lg border border-border bg-background" style={{ minHeight: 96, padding: 16 }}>
          {effectiveLogo ? (
            <img src={effectiveLogo} alt="Logo-Vorschau" style={{ maxHeight: 120, maxWidth: "100%", objectFit: "contain" }} />
          ) : (
            <div style={{ height: 48, display: "flex", alignItems: "center" }}>
              <img
                src="/brand-logo.png"
                alt="Standard-Logo"
                style={{ maxHeight: 120, maxWidth: "100%", objectFit: "contain" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={onFileChange} />
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
        <p className="text-xs text-muted-foreground">Empfohlenes Format: PNG mit transparentem Hintergrund, min. 300 px Breite. Maximal 500 KB.</p>
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
        <p className="text-xs text-muted-foreground">Wird im Footer der App sowie in PDF- und HTML-Exporten angezeigt.</p>
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

      {/* Card: Farbschema */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold">Farbschema</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Farben für Buttons, Sidebar, Highlights und Status-Anzeigen.</p>
          </div>
          <button
            onClick={resetTheme}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Auf Standard zurücksetzen
          </button>
        </div>

        <div className="space-y-1 divide-y" style={{ borderColor: "hsl(var(--border))" }}>
          <ColorField
            label="Primärfarbe"
            desc="Buttons, aktiver Nav-Eintrag, Links, Focus-Ringe"
            value={primary}
            onChange={setPrimary}
          />
          <ColorField
            label="Akzentfarbe"
            desc="Score-Highlights, Badges, aktiver Tab-Unterstrich"
            value={accent}
            onChange={setAccent}
          />
          <ColorField
            label="Sidebar-Hintergrund"
            desc="Hintergrundfarbe der Navigation"
            value={sidebarBg}
            onChange={setSidebarBg}
          />
          <ColorField
            label="Sidebar-Text"
            desc="Textfarbe der Nav-Einträge"
            value={sidebarText}
            onChange={setSidebarText}
          />
        </div>

        {/* Colorblind toggle */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Toggle checked={colorblind} onChange={setColorblind} />
            <div>
              <div className="text-sm font-medium">Farbenblinden-Modus</div>
              <div className="text-xs text-muted-foreground">Barrierefreie Farbgebung (Rot-Grün-sicher)</div>
            </div>
          </div>
          {colorblind && (
            <div className="flex items-start gap-2 rounded-lg border p-3 text-xs" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.4)" }}>
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#3b82f6" }} />
              <span className="text-muted-foreground">
                Im Farbenblinden-Modus werden Rot- und Grün-Töne durch Blau und Amber ersetzt.
                Alle Status-Anzeigen bleiben durch Icons zusätzlich unterscheidbar.
              </span>
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Vorschau</div>
          <ThemePreview
            primary={primary}
            accent={accent}
            sidebarBg={sidebarBg}
            sidebarText={sidebarText}
            colorblind={colorblind}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={saveTheme}
            disabled={themeStatus === "saving"}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#3b82f6" }}
          >
            <Save className="w-4 h-4" />
            {themeStatus === "saving" ? "Speichern…" : "Farbschema speichern"}
          </button>
          {themeMsg && (
            <span className="flex items-center gap-1.5 text-sm" style={{ color: themeStatus === "ok" ? "#3b82f6" : "#d97706" }}>
              {themeStatus === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {themeMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
