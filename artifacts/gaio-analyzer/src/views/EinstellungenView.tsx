import { useAppStore, type Theme } from "@/store/appStore";
import { Sun, Moon, Monitor } from "lucide-react";
import { useT } from "@/lib/LabelProvider";

const THEME_OPTIONS: { value: Theme; labelKey: string; icon: React.ElementType }[] = [
  { value: "light",  labelKey: "settings.theme_light",  icon: Sun },
  { value: "dark",   labelKey: "settings.theme_dark",   icon: Moon },
  { value: "system", labelKey: "settings.theme_system", icon: Monitor },
];

export function EinstellungenView() {
  const t = useT();
  const { theme, setTheme } = useAppStore();

  return (
    <div className="max-w-md space-y-8">
      <div>
        <h1 className="text-xl font-bold font-mono tracking-tight">{t("nav.einstellungen")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("settings.subtitle")}</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold font-mono text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
          {t("settings.section_display")}
        </h2>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t("settings.color_mode")}</p>
          <div className="space-y-2">
            {THEME_OPTIONS.map(({ value, labelKey, icon: Icon }) => {
              const isSelected = theme === value;
              return (
                <button
                  key={value}
                  onClick={() => setTheme(value)}
                  data-testid={`theme-option-${value}`}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors text-left"
                  style={{
                    background: isSelected ? "hsl(var(--primary) / 0.08)" : "transparent",
                    borderColor: isSelected ? "hsl(var(--primary))" : "hsl(var(--border))",
                    color: isSelected ? "hsl(var(--primary))" : "hsl(var(--foreground))",
                  }}
                >
                  <div
                    className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors"
                    style={{
                      borderColor: isSelected ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {isSelected && (
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: "hsl(var(--primary))" }}
                      />
                    )}
                  </div>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium">{t(labelKey)}</span>
                  {value === "system" && (
                    <span className="text-xs text-muted-foreground ml-auto">{t("settings.theme_default")}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
