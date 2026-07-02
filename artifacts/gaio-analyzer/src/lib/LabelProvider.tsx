import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { labelDefaults, SUPPORTED_LOCALES, type Locale } from "@/lib/labelDefaults";

interface LabelContextValue {
  locale: Locale;
  locales: Locale[];
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function applyVars(raw: string, vars?: Record<string, string | number>): string {
  if (!vars) return raw;
  return raw.replace(/\{([^}]+)\}/g, (match, name: string) => {
    const val = vars[name];
    return val !== undefined ? String(val) : match;
  });
}

const LabelContext = createContext<LabelContextValue>({
  locale: "de",
  locales: SUPPORTED_LOCALES as unknown as Locale[],
  setLocale: () => {},
  t: (key, vars) => applyVars(labelDefaults[key]?.de ?? key, vars),
});

export function useLabelContext(): LabelContextValue {
  return useContext(LabelContext);
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  return useContext(LabelContext).t;
}

const BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

function mapNavigatorLocale(supported: readonly string[]): Locale | null {
  try {
    const lang = navigator.language?.split("-")[0]?.toLowerCase();
    if (lang && supported.includes(lang)) return lang as Locale;
  } catch {}
  return null;
}

function getInitialLocale(supported: readonly string[]): Locale {
  const params = new URLSearchParams(window.location.search);
  const queryLang = params.get("lang");
  if (queryLang && supported.includes(queryLang)) return queryLang as Locale;

  try {
    const stored = localStorage.getItem("gaio_locale");
    if (stored && supported.includes(stored)) return stored as Locale;
  } catch {}

  const navLocale = mapNavigatorLocale(supported);
  if (navLocale) return navLocale;

  return "de";
}

async function fetchServerLocales(): Promise<Locale[]> {
  try {
    const r = await fetch(`${BASE}/api/admin/locales`);
    if (!r.ok) return SUPPORTED_LOCALES as unknown as Locale[];
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) return data as Locale[];
  } catch {}
  return SUPPORTED_LOCALES as unknown as Locale[];
}

async function fetchLabels(locale: Locale): Promise<Record<string, string>> {
  try {
    const r = await fetch(`${BASE}/api/admin/public/labels?locale=${locale}`);
    if (!r.ok) return {};
    return r.json() as Promise<Record<string, string>>;
  } catch {
    return {};
  }
}

export function LabelProvider({ children }: { children: ReactNode }) {
  const [locales, setLocales] = useState<Locale[]>(SUPPORTED_LOCALES as unknown as Locale[]);
  const [locale, setLocaleState] = useState<Locale>(() =>
    getInitialLocale(SUPPORTED_LOCALES as readonly string[]),
  );
  const [labelsMap, setLabelsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchServerLocales().then((serverLocales) => {
      setLocales(serverLocales);
      const current = locale;
      if (!serverLocales.includes(current)) {
        setLocaleState("de");
      }
    });
  }, []);

  useEffect(() => {
    void fetchLabels(locale).then(setLabelsMap);
  }, [locale]);

  function setLocale(l: Locale) {
    void (async () => {
      const serverLocales = await fetchServerLocales();
      if (!serverLocales.includes(l)) return;
      try {
        localStorage.setItem("gaio_locale", l);
      } catch {}
      setLocaleState(l);
    })();
  }

  function t(key: string, vars?: Record<string, string | number>): string {
    let raw: string;
    if (key in labelsMap) {
      raw = labelsMap[key] as string;
    } else {
      const def = labelDefaults[key];
      raw = def ? def.de : key;
    }
    return applyVars(raw, vars);
  }

  return (
    <LabelContext.Provider value={{ locale, locales, setLocale, t }}>
      {children}
    </LabelContext.Provider>
  );
}
