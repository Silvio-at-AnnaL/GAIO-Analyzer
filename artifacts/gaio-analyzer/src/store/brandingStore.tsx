import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export interface BrandingData {
  logoSrc:    string;
  footerText: string;
  footerUrl:  string;
  isLoaded:   boolean;
}

export interface ThemeData {
  primary:        string;
  sidebarBg:      string;
  sidebarText:    string;
  accent:         string;
  colorblindMode: boolean;
}

const DEFAULT_BRANDING: BrandingData = {
  logoSrc:    "",
  footerText: "IndustryStock.com",
  footerUrl:  "https://www.industrystock.com",
  isLoaded:   false,
};

const BrandingContext = createContext<BrandingData>(DEFAULT_BRANDING);

const BASE = (import.meta.env.BASE_URL as string).replace(/\/$/, "");

function isValidHex(h: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(h);
}

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function applyThemeToDocument(theme: ThemeData) {
  const root = document.documentElement;
  if (isValidHex(theme.primary)) {
    const hsl = hexToHsl(theme.primary);
    root.style.setProperty("--primary", hsl);
    root.style.setProperty("--ring", hsl);
    root.style.setProperty("--sidebar-primary", hsl);
    root.style.setProperty("--sidebar-ring", hsl);
    root.style.setProperty("--gaio-primary", theme.primary);
  }
  if (isValidHex(theme.sidebarBg)) {
    root.style.setProperty("--sidebar", hexToHsl(theme.sidebarBg));
    root.style.setProperty("--gaio-sidebar-bg", theme.sidebarBg);
  }
  if (isValidHex(theme.sidebarText)) {
    root.style.setProperty("--sidebar-foreground", hexToHsl(theme.sidebarText));
    root.style.setProperty("--gaio-sidebar-text", theme.sidebarText);
  }
  if (isValidHex(theme.accent)) {
    root.style.setProperty("--gaio-accent", theme.accent);
  }
  if (theme.colorblindMode) {
    document.body.classList.add("colorblind-mode");
  } else {
    document.body.classList.remove("colorblind-mode");
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingData>(DEFAULT_BRANDING);

  function fetchTheme() {
    fetch(`${BASE}/api/admin/public/theme`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ThemeData | null) => {
        if (data) applyThemeToDocument(data);
      })
      .catch(() => {});
  }

  useEffect(() => {
    fetch(`${BASE}/api/admin/public/branding`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { logoSrc?: string; footerText?: string; footerUrl?: string } | null) => {
        if (!data) return;
        setBranding({
          logoSrc:    data.logoSrc    ?? "",
          footerText: data.footerText ?? "IndustryStock.com",
          footerUrl:  data.footerUrl  ?? "https://www.industrystock.com",
          isLoaded:   true,
        });
      })
      .catch(() => setBranding((prev) => ({ ...prev, isLoaded: true })));

    fetchTheme();

    const onBrandingUpdate = () => {
      fetch(`${BASE}/api/admin/public/branding`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { logoSrc?: string; footerText?: string; footerUrl?: string } | null) => {
          if (!data) return;
          setBranding({
            logoSrc:    data.logoSrc    ?? "",
            footerText: data.footerText ?? "IndustryStock.com",
            footerUrl:  data.footerUrl  ?? "https://www.industrystock.com",
            isLoaded:   true,
          });
        })
        .catch(() => {});
    };
    const onThemeUpdate = () => fetchTheme();

    window.addEventListener("branding-updated", onBrandingUpdate);
    window.addEventListener("theme-updated", onThemeUpdate);
    return () => {
      window.removeEventListener("branding-updated", onBrandingUpdate);
      window.removeEventListener("theme-updated", onThemeUpdate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
