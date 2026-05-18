import { useState } from "react";
import { Globe, FileCode, BarChart3, HelpCircle, Mail, Settings, Menu, LogIn, Users, User } from "lucide-react";
import { useAppStore, type ActiveView } from "@/store/appStore";
import { useAuth } from "@/store/authStore";

const MAIN_NAV: { id: ActiveView; icon: React.ElementType; label: string }[] = [
  { id: 1, icon: Globe,     label: "Domainanalyse – Basisdaten" },
  { id: 2, icon: FileCode,  label: "HTML-Analyse" },
  { id: 3, icon: BarChart3, label: "Ergebnisse" },
  { id: 4, icon: HelpCircle,label: "FAQ / So funktioniert's" },
  { id: 5, icon: Mail,      label: "Kontakt" },
  { id: 6, icon: Settings,  label: "Einstellungen" },
];

function NavButton({
  id, icon: Icon, label, active, onClick,
}: {
  id: ActiveView; icon: React.ElementType; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={`nav-item-${id}`}
      className="w-full flex items-center gap-3 py-2.5 text-left transition-all"
      style={{
        paddingLeft: "calc(0.75rem - 3px)",
        paddingRight: "0.75rem",
        borderLeft:  active ? "3px solid hsl(var(--sidebar-primary))" : "3px solid transparent",
        borderRadius: "0 6px 6px 0",
        background:  active ? "hsl(var(--sidebar-accent))" : "transparent",
        color:       active ? "hsl(var(--sidebar-accent-foreground))" : "hsl(var(--sidebar-foreground))",
        fontWeight:  active ? 600 : 400,
      }}
    >
      <span className="shrink-0 flex items-center" style={{ width: 15, height: 15 }}>
        <Icon style={{ width: 15, height: 15 }} />
      </span>
      <span className="flex-1 text-sm font-medium leading-tight">{label}</span>
    </button>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { activeView, setActiveView } = useAppStore();
  const { user, isAuthenticated }     = useAuth();

  function navigate(id: ActiveView) {
    setActiveView(id);
    onNavigate?.();
  }

  const loginLabel = isAuthenticated
    ? `${user!.firstName} ${user!.lastName}`
    : "Login";
  const LoginIcon = isAuthenticated ? User : LogIn;

  return (
    <>
      {/* Brand logo */}
      <div style={{ paddingTop: 32, paddingBottom: 16, paddingLeft: 16, paddingRight: 16 }}>
        <img
          src="/brand-logo.png"
          alt="GAIO Analyzer"
          style={{ width: "100%", height: "auto", maxHeight: 48, objectFit: "contain", objectPosition: "left center", display: "block" }}
        />
      </div>

      {/* Main navigation */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {MAIN_NAV.map(({ id, icon, label }) => (
          <NavButton key={id} id={id} icon={icon} label={label} active={activeView === id} onClick={() => navigate(id)} />
        ))}

        {/* Admin separator */}
        <div style={{ height: 1, background: "hsl(var(--sidebar-border))", margin: "10px 12px 6px" }} />

        {/* Login / Profile */}
        <NavButton id={7} icon={LoginIcon} label={loginLabel} active={activeView === 7} onClick={() => navigate(7)} />

        {/* User management — only admins */}
        {isAuthenticated && user?.role === "admin" && (
          <NavButton id={8} icon={Users} label="Nutzerverwaltung" active={activeView === 8} onClick={() => navigate(8)} />
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t" style={{ borderColor: "hsl(var(--sidebar-border))", color: "hsl(var(--sidebar-foreground))", opacity: 0.4 }}>
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
      style={{ background: "hsl(var(--sidebar))", borderColor: "hsl(var(--sidebar-border))" }}
    >
      <SidebarContent />
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />}
      <div
        className={`fixed top-0 left-0 h-screen w-60 z-50 flex flex-col border-r transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "hsl(var(--sidebar))", borderColor: "hsl(var(--sidebar-border))" }}
      >
        <SidebarContent onNavigate={() => setOpen(false)} />
      </div>
      <button onClick={() => setOpen(true)} className="p-1 rounded-md hover:bg-muted transition-colors" aria-label="Menü öffnen">
        <Menu className="w-5 h-5" />
      </button>
    </>
  );
}
