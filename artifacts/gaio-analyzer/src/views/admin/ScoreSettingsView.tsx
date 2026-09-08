import { useEffect, useRef, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { adminFetch } from "@/store/authStore";
import { useT } from "@/lib/LabelProvider";

interface ScoreParam {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  help: string;
  current: number;
}

interface ScoreProfile {
  slug: string;
  label: string;
  params: ScoreParam[];
}

export function ScoreSettingsView() {
  const t = useT();
  const [profiles, setProfiles] = useState<ScoreProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<string | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    adminFetch("/api/admin/score-profiles")
      .then(async (response) => {
        if (!response.ok) throw new Error();
        setProfiles(await response.json() as ScoreProfile[]);
      })
      .catch(() => setMessages({ load: t("score.save_error") }))
      .finally(() => setLoading(false));

    return () => {
      Object.values(saveTimers.current).forEach(clearTimeout);
    };
  }, [t]);

  const replaceProfile = (updated: ScoreProfile) => {
    setProfiles((current) =>
      current.map((profile) => profile.slug === updated.slug ? updated : profile),
    );
  };

  const saveParam = async (slug: string, key: string, value: number) => {
    try {
      const response = await adminFetch(`/api/admin/score-profiles/${slug}`, {
        method: "PATCH",
        body: JSON.stringify({ key, value }),
      });
      if (!response.ok) throw new Error();
      replaceProfile(await response.json() as ScoreProfile);
      setMessages((current) => ({ ...current, [slug]: t("score.saved_msg") }));
    } catch {
      setMessages((current) => ({ ...current, [slug]: t("score.save_error") }));
    }
  };

  const handleValueChange = (slug: string, key: string, value: number) => {
    setProfiles((current) =>
      current.map((profile) =>
        profile.slug === slug
          ? {
              ...profile,
              params: profile.params.map((param) =>
                param.key === key ? { ...param, current: value } : param,
              ),
            }
          : profile,
      ),
    );
    setMessages((current) => ({ ...current, [slug]: "" }));

    const timerKey = `${slug}:${key}`;
    clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = setTimeout(() => {
      void saveParam(slug, key, value);
      delete saveTimers.current[timerKey];
    }, 350);
  };

  const handleReset = async (slug: string) => {
    Object.entries(saveTimers.current).forEach(([key, timer]) => {
      if (key.startsWith(`${slug}:`)) {
        clearTimeout(timer);
        delete saveTimers.current[key];
      }
    });
    setResetting(slug);
    setMessages((current) => ({ ...current, [slug]: "" }));
    try {
      const response = await adminFetch(`/api/admin/score-profiles/${slug}/reset`, {
        method: "POST",
      });
      if (!response.ok) throw new Error();
      replaceProfile(await response.json() as ScoreProfile);
      setMessages((current) => ({ ...current, [slug]: t("score.saved_msg") }));
    } catch {
      setMessages((current) => ({ ...current, [slug]: t("score.save_error") }));
    } finally {
      setResetting(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <SlidersHorizontal className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">{t("score.title")}</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("score.subtitle")}</p>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        {t("score.intro_note")}
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t("score.loading")}
        </div>
      )}

      {!loading && profiles.length === 0 && (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {messages.load || t("score.empty")}
        </div>
      )}

      {profiles.map((profile) => {
        const message = messages[profile.slug] ?? "";
        return (
          <section key={profile.slug} className="rounded-lg border border-border bg-card shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="text-lg font-semibold text-foreground">{profile.label}</h2>
              <button
                type="button"
                onClick={() => void handleReset(profile.slug)}
                disabled={resetting === profile.slug}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className={`h-4 w-4 ${resetting === profile.slug ? "animate-spin" : ""}`} />
                {t("score.reset_button")}
              </button>
            </div>

            <div className="divide-y divide-border">
              {profile.params.map((param) => (
                <div key={param.key} className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,1fr)] md:items-center">
                  <div>
                    <div className="font-medium text-foreground">{param.label}</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{param.help}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min={param.min}
                      max={param.max}
                      step={param.step}
                      value={param.current}
                      onChange={(event) =>
                        handleValueChange(profile.slug, param.key, Number(event.target.value))
                      }
                      className="h-2 min-w-0 flex-1 cursor-pointer accent-primary"
                      aria-label={param.label}
                    />
                    <div className="w-24 text-right">
                      <div className="text-[11px] text-muted-foreground">
                        {t("score.current_value_label")}
                      </div>
                      <div className="font-mono text-base font-semibold text-foreground">
                        {param.current}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {message && (
              <div
                className={`border-t border-border px-5 py-3 text-sm ${
                  message.startsWith("Fehler") ? "text-destructive" : "text-emerald-600"
                }`}
              >
                {message}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}