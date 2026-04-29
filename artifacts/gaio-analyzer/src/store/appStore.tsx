import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type ActiveView = 1 | 2 | 3 | 4 | 5 | 6;
export type Theme = "light" | "dark" | "system";
export type AnalysisStatus = "idle" | "running" | "completed" | "failed";

export interface SocialMedia {
  linkedin: string;
  facebook: string;
  instagram: string;
  youtube: string;
  tiktok: string;
  wechat: string;
  twitter: string;
  kununu: string;
  xing: string;
}

export interface DomainForm {
  companyName: string;
  url: string;
  competitors: string[];
  social: SocialMedia;
  personas: string;
}

export interface HtmlForm {
  code: string;
  filename: string | null;
  fileSize: number | null;
}

interface AppState {
  activeView: ActiveView;
  setActiveView: (v: ActiveView) => void;

  domainForm: DomainForm;
  setDomainForm: (form: DomainForm) => void;

  htmlForm: HtmlForm;
  setHtmlForm: (form: HtmlForm) => void;

  analysisId: string | null;
  setAnalysisId: (id: string | null) => void;

  analysisStatus: AnalysisStatus;
  setAnalysisStatus: (s: AnalysisStatus) => void;

  crawledPages: string[];
  setCrawledPages: (pages: string[]) => void;

  selectedPages: string[];
  setSelectedPages: (pages: string[]) => void;

  theme: Theme;
  setTheme: (t: Theme) => void;
}

const AppContext = createContext<AppState | null>(null);

const DEFAULT_DOMAIN_FORM: DomainForm = {
  companyName: "",
  url: "",
  competitors: [""],
  social: {
    linkedin: "",
    facebook: "",
    instagram: "",
    youtube: "",
    tiktok: "",
    wechat: "",
    twitter: "",
    kununu: "",
    xing: "",
  },
  personas: "",
};

const DEFAULT_HTML_FORM: HtmlForm = {
  code: "",
  filename: null,
  fileSize: null,
};

function getSystemDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "light") {
    root.setAttribute("data-theme", "light");
  } else if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.setAttribute("data-theme", getSystemDark() ? "dark" : "light");
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ActiveView>(1);
  const [domainForm, setDomainForm] = useState<DomainForm>(DEFAULT_DOMAIN_FORM);
  const [htmlForm, setHtmlForm] = useState<HtmlForm>(DEFAULT_HTML_FORM);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>("idle");
  const [crawledPages, setCrawledPages] = useState<string[]>([]);
  const [selectedPages, setSelectedPages] = useState<string[]>([]);
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("gaio-theme");
    return (saved as Theme) || "system";
  });

  useEffect(() => {
    applyTheme(theme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => applyTheme("system");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem("gaio-theme", t);
    applyTheme(t);
  };

  return (
    <AppContext.Provider
      value={{
        activeView,
        setActiveView,
        domainForm,
        setDomainForm,
        htmlForm,
        setHtmlForm,
        analysisId,
        setAnalysisId,
        analysisStatus,
        setAnalysisStatus,
        crawledPages,
        setCrawledPages,
        selectedPages,
        setSelectedPages,
        theme,
        setTheme,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppStore() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppStore must be used within AppProvider");
  return ctx;
}
