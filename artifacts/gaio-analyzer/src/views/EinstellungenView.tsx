import { useAppStore, type Theme } from "@/store/appStore";
import { Sun, Moon, Monitor } from "lucide-react";

const THEME_OPTIONS: { value: Theme; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Hell", icon: Sun },
  { value: "dark", label: "Dunkel", icon: Moon },
  { value: "system", label: "Systemeinstellung", icon: Monitor },
];

export function EinstellungenView() {
  const { theme, setTheme } = useAppStore();

  return (
    <div className="max-w-md space-y-8">
      <div>
        <h1 className="text-xl font-bold font-mono tracking-tight">Einstellungen</h1>
        <p className="text-sm text-muted-foreground mt-1">App-Konfiguration und Darstellung.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold font-mono text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
          Darstellung
        </h2>

        <div className="space-y-2">
          <p className="text-sm font-medium">Farbmodus</p>
          <div className="space-y-2">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
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
                  <span className="text-sm font-medium">{label}</span>
                  {value === "system" && (
                    <span className="text-xs text-muted-foreground ml-auto">(Standard)</span>
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
