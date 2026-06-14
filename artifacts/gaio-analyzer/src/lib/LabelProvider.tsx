import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { labelDefaults, SUPPORTED_LOCALES, type Locale } from "@/lib/labelDefaults";

interface LabelContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const LabelContext = createContext<LabelContextValue>({
  locale: "de",
  setLocale: () => {},
  t: (key) => labelDefaults[key]?.de ?? key,
});

export function useLabelContext(): LabelContextValue {
  return useContext(LabelContext);
}

export function useT(): (key: string) => string {
  return useContext(LabelContext).t;
}

function getInitialLocale(): Locale {
  const params = new URLSearchParams(window.location.search);
  const lang = params.get("lang");
  if (lang && (SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
    return lang as Locale;
  }
  return "de";
}

const BASE = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

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
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);
  const [labelsMap, setLabelsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchLabels(locale).then(setLabelsMap);
  }, [locale]);

  function setLocale(l: Locale) {
    setLocaleState(l);
  }

  function t(key: string): string {
    if (key in labelsMap) return labelsMap[key] as string;
    const def = labelDefaults[key];
    if (def) return def.de;
    return key;
  }

  return (
    <LabelContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LabelContext.Provider>
  );
}
