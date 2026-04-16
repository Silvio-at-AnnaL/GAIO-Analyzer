import { Globe, FileCode, BarChart3, HelpCircle, Settings } from "lucide-react";
import { useAppStore, type ActiveView } from "@/store/appStore";

const NAV_ITEMS: { id: ActiveView; icon: React.ElementType; label: string }[] = [
  { id: 1, icon: Globe, label: "Domainanalyse – Basisdaten" },
  { id: 2, icon: FileCode, label: "HTML-Analyse" },
  { id: 3, icon: BarChart3, label: "Ergebnisse" },
  { id: 4, icon: HelpCircle, label: "FAQ / So funktioniert's" },
  { id: 5, icon: Settings, label: "Einstellungen" },
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
      <div
        className="flex items-center gap-2.5 px-5 h-14 border-b shrink-0"
        style={{ borderColor: "hsl(var(--sidebar-border))" }}
      >
        <div className="w-3 h-3 rounded-sm bg-primary animate-pulse shrink-0" />
        <span
          className="font-bold text-sm tracking-tight"
          style={{ color: "hsl(var(--sidebar-foreground))", fontFamily: "var(--font-family-base)" }}
        >
          GAIO Analyzer
        </span>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              data-testid={`nav-item-${id}`}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors"
              style={{
                background: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
                color: isActive ? "hsl(var(--sidebar-primary))" : "hsl(var(--sidebar-foreground))",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <span className="shrink-0 w-4 h-4 flex items-center">
                <Icon className="w-4 h-4" />
              </span>
              <span className="flex-1 text-xs leading-tight">
                <span className="opacity-40 mr-1 font-mono">{id}.</span>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      <div
        className="px-4 py-3 border-t text-xs"
        style={{
          borderColor: "hsl(var(--sidebar-border))",
          color: "hsl(var(--sidebar-foreground))",
          opacity: 0.35,
        }}
      >
        GAIO Analyzer v1.0
      </div>
    </aside>
  );
}
