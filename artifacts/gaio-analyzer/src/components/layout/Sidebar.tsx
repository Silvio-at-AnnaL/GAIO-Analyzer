import { Globe, FileCode, BarChart3, HelpCircle, Mail, Settings } from "lucide-react";
import { useAppStore, type ActiveView } from "@/store/appStore";

const NAV_ITEMS: { id: ActiveView; icon: React.ElementType; label: string }[] = [
  { id: 1, icon: Globe, label: "Domainanalyse – Basisdaten" },
  { id: 2, icon: FileCode, label: "HTML-Analyse" },
  { id: 3, icon: BarChart3, label: "Ergebnisse" },
  { id: 4, icon: HelpCircle, label: "FAQ / So funktioniert's" },
  { id: 5, icon: Mail, label: "Kontakt" },
  { id: 6, icon: Settings, label: "Einstellungen" },
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
      {/* Brand logo */}
      <div
        className="px-4 h-16 flex items-center border-b shrink-0"
        style={{ borderColor: "hsl(var(--sidebar-border))" }}
      >
        <img
          src="/brand-logo.png"
          alt="GAIO Analyzer"
          className="h-8 w-auto object-contain"
          style={{ display: "block" }}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              data-testid={`nav-item-${id}`}
              className="w-full flex items-center gap-3 py-2.5 text-left transition-all"
              style={{
                paddingLeft: "calc(0.75rem - 3px)",
                paddingRight: "0.75rem",
                borderLeft: isActive
                  ? "3px solid hsl(var(--sidebar-primary))"
                  : "3px solid transparent",
                borderRadius: "0 6px 6px 0",
                background: isActive ? "hsl(var(--sidebar-accent))" : "transparent",
                color: isActive
                  ? "hsl(var(--sidebar-accent-foreground))"
                  : "hsl(var(--sidebar-foreground))",
                fontWeight: isActive ? 600 : 400,
              }}
            >
              <span className="shrink-0 flex items-center" style={{ width: 15, height: 15 }}>
                <Icon style={{ width: 15, height: 15 }} />
              </span>
              <span className="flex-1 text-xs leading-tight">
                <span
                  style={{
                    opacity: 0.3,
                    fontFamily: "monospace",
                    fontSize: 10,
                    marginRight: 4,
                  }}
                >
                  {id}.
                </span>
                {label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer attribution */}
      <div
        className="px-4 py-3 border-t"
        style={{
          borderColor: "hsl(var(--sidebar-border))",
          color: "hsl(var(--sidebar-foreground))",
          opacity: 0.4,
        }}
      >
        <p style={{ fontSize: 10, lineHeight: 1.5, margin: 0 }}>GAIO Analyzer v1.0</p>
        <p style={{ fontSize: 10, lineHeight: 1.5, margin: 0 }}>IndustryStock.com</p>
      </div>
    </aside>
  );
}
