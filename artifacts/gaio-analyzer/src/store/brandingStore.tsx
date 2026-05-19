import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export interface BrandingData {
  logoSrc: string;
  footerText: string;
  footerUrl: string;
  isLoaded: boolean;
}

const DEFAULT_BRANDING: BrandingData = {
  logoSrc:    "",
  footerText: "IndustryStock.com",
  footerUrl:  "https://www.industrystock.com",
  isLoaded:   false,
};

const BrandingContext = createContext<BrandingData>(DEFAULT_BRANDING);

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingData>(DEFAULT_BRANDING);

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
  }, []);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
