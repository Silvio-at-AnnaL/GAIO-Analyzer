import { Globe, FileCode, BarChart3, Settings } from "lucide-react";
import { useAppStore, type ActiveView } from "@/store/appStore";

const NAV_ITEMS: { id: ActiveView; icon: React.ElementType; label: string }[] = [
  { id: 1, icon: Globe, label: "Domainanalyse – Basisdaten" },
  { id: 2, icon: FileCode, label: "HTML-Analyse" },
  { id: 3, icon: BarChart3, label: "Ergebnisse" },
  { id: 4, icon: Settings, label: "Einstellungen" },
];

export function Sidebar() {
  const { activeView, setActiveView } = useAppStore();

  return (
    <aside
      className="w-60 shrink-0 h-screen sticky top-0 flex flex-col border-r"
      style={{
        background: "hsl(var(--sidebar))",
        borderColor: "hsl(var(--sidebar-border))",
      }}
    >
      <div className="flex items-center gap-2.5 px-5 h-14 border-b shrink-0" style={{ borderColor: "hsl(var(--sidebar-border))" }}>
        <div className="w-3 h-3 rounded-sm bg-primary animate-pulse shrink-0" />
        <span className="font-mono font-bold text-sm tracking-tight" style={{ color: "hsl(var(--sidebar-foreground))" }}>
          GAIO_ANALYZER
        </span>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              data-testid={`nav-item-${id}`}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors text-sm"
              style={{
                background: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
                color: isActive
                  ? "hsl(var(--sidebar-primary))"
                  : "hsl(var(--sidebar-foreground))",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <span className="shrink-0 flex items-center justify-center w-5">
                <Icon className="w-4 h-4" />
              </span>
              <span className="flex-1 leading-tight font-mono text-xs">
                <span className="text-xs opacity-50 mr-1">{id}.</span>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t text-xs font-mono" style={{ borderColor: "hsl(var(--sidebar-border))", color: "hsl(var(--sidebar-foreground))", opacity: 0.4 }}>
        GAIO v1.0
      </div>
    </aside>
  );
}
