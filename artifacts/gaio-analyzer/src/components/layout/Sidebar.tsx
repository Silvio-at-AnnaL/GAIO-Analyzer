import { useState } from "react";
import { Globe, FileCode, BarChart3, HelpCircle, Mail, Settings, Menu } from "lucide-react";
import { useAppStore, type ActiveView } from "@/store/appStore";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const NAV_ITEMS: { id: ActiveView; icon: React.ElementType; label: string }[] = [
  { id: 1, icon: Globe, label: "Domainanalyse – Basisdaten" },
  { id: 2, icon: FileCode, label: "HTML-Analyse" },
  { id: 3, icon: BarChart3, label: "Ergebnisse" },
  { id: 4, icon: HelpCircle, label: "FAQ / So funktioniert's" },
  { id: 5, icon: Mail, label: "Kontakt" },
  { id: 6, icon: Settings, label: "Einstellungen" },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { activeView, setActiveView } = useAppStore();

  return (
    <>
      {/* Brand logo */}
      <div style={{ paddingTop: 32, paddingBottom: 16, paddingLeft: 16, paddingRight: 16 }}>
        <img
          src="/brand-logo.png"
          alt="GAIO Analyzer"
          style={{
            width: "100%",
            height: "auto",
            maxHeight: 48,
            objectFit: "contain",
            objectPosition: "left center",
            display: "block",
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => {
          const isActive = activeView === id;
          return (
            <button
              key={id}
              onClick={() => {
                setActiveView(id);
                onNavigate?.();
              }}
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
              <span className="flex-1 text-sm font-medium leading-tight">
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
        <p style={{ fontSize: 10, lineHeight: 1.5, margin: 0 }}>GAIO Analyzer v2.0</p>
        <p style={{ fontSize: 10, lineHeight: 1.5, margin: 0 }}>IndustryStock.com</p>
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside
      className="w-60 shrink-0 h-screen sticky top-0 flex-col border-r hidden md:flex"
      style={{
        background: "hsl(var(--sidebar))",
        borderColor: "hsl(var(--sidebar-border))",
      }}
    >
      <SidebarContent />
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="block md:hidden">
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none",
          border: "none",
          padding: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          color: "hsl(var(--foreground))",
        }}
        aria-label="Menü öffnen"
      >
        <Menu size={22} />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="w-60 p-0 flex flex-col"
          style={{ background: "hsl(var(--sidebar))" }}
        >
          <SidebarContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}
