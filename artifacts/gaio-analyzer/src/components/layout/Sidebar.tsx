import { useState, useEffect } from "react";
import {
  Globe, FileCode, BarChart3, HelpCircle, Mail, Settings, Menu,
  LogIn, User, Users, Server, ArrowLeftRight,
  BrainCircuit, BarChart2, Palette, ChevronDown,
} from "lucide-react";
import { useAppStore, type ActiveView } from "@/store/appStore";
import { useAuth, canAccess, type Permissions } from "@/store/authStore";
import { useBranding } from "@/store/brandingStore";
import { ADMIN_NAV_GROUPS, ADMIN_FEATURES } from "@/config/adminFeatures";
import { useLabelContext, useT } from "@/lib/LabelProvider";

const MAIN_NAV: { id: ActiveView; icon: React.ElementType; labelKey: string }[] = [
  { id: 1,  icon: Globe,      labelKey: "nav.domain_analyse" },
  { id: 2,  icon: FileCode,   labelKey: "nav.html_analyse" },
  { id: 3,  icon: BarChart3,  labelKey: "nav.ergebnisse" },
  { id: 4,  icon: HelpCircle, labelKey: "nav.faq" },
  { id: 5,  icon: Mail,       labelKey: "nav.kontakt" },
  { id: 6,  icon: Settings,   labelKey: "nav.einstellungen" },
];

const FEATURE_VIEW: Record<string, ActiveView> = {
  nutzerverwaltung: 8,
  rechtemanagement: 15,
  analyseprotokoll: 9,
  geteilte_analysen: 17,
  angebots_creator: 18,
  versand_analyse: 12,
  erscheinungsbild: 13,
  kontakt_daten: 14,
  prompt_verwaltung: 19,
  ki_tool: 10,
  textverwaltung: 20,
};

const FEATURE_LABEL: Record<string, string> = Object.fromEntries(
  (ADMIN_FEATURES as ReadonlyArray<{ id: string; label: string }>).map((f) => [f.id, f.label]),
);

const GROUP_ICON: Record<string, React.ElementType> = {
  Users, BarChart2, Palette, BrainCircuit,
};

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
        paddingLeft:  "calc(0.75rem - 3px)",
        paddingRight: "0.75rem",
        borderLeft:   active ? "3px solid hsl(var(--sidebar-primary))" : "3px solid transparent",
        borderRadius: "0 6px 6px 0",
        background:   active ? "hsl(var(--sidebar-accent))" : "transparent",
        color:        active ? "hsl(var(--sidebar-accent-foreground))" : "hsl(var(--sidebar-foreground))",
        fontWeight:   active ? 600 : 400,
      }}
    >
      <span className="shrink-0 flex items-center" style={{ width: 15, height: 15 }}>
        <Icon style={{ width: 15, height: 15 }} />
      </span>
      <span className="flex-1 text-sm font-medium leading-tight">{label}</span>
    </button>
  );
}

function NavGroup({
  group, activeView, navigate, role, permissions,
}: {
  group: typeof ADMIN_NAV_GROUPS[number];
  activeView: ActiveView;
  navigate: (id: ActiveView) => void;
  role: string;
  permissions: Permissions;
}) {
  const accessibleItems = group.items.filter(
    (itemId) => canAccess(itemId, role, permissions),
  );

  const isActiveGroup = group.items.some(
    (itemId) => FEATURE_VIEW[itemId] === activeView,
  );

  const [open, setOpen] = useState(isActiveGroup);

  useEffect(() => {
    if (isActiveGroup) setOpen(true);
  }, [isActiveGroup]);

  if (accessibleItems.length === 0) return null;

  const GroupIcon = GROUP_ICON[group.icon] ?? Users;

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 py-2 text-left transition-colors rounded-r-md"
        style={{
          paddingLeft:  "calc(0.75rem - 3px)",
          paddingRight: "0.75rem",
          borderLeft:   "3px solid transparent",
          color:        "hsl(var(--sidebar-foreground))",
          cursor:       "pointer",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "hsl(var(--sidebar-accent)/0.4)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <span className="shrink-0 flex items-center" style={{ width: 15, height: 15 }}>
          <GroupIcon style={{ width: 15, height: 15 }} />
        </span>
        <span className="flex-1 text-sm font-semibold leading-tight">{group.label}</span>
        <span
          className="shrink-0"
          style={{
            transition: "transform 150ms ease",
            transform:  open ? "rotate(0deg)" : "rotate(-90deg)",
            color:      "hsl(var(--sidebar-foreground)/0.5)",
          }}
        >
          <ChevronDown style={{ width: 14, height: 14 }} />
        </span>
      </button>

      <div
        style={{
          overflow:   "hidden",
          maxHeight:  open ? `${accessibleItems.length * 38}px` : "0px",
          transition: "max-height 200ms ease",
        }}
      >
        {accessibleItems.map((itemId) => {
          const viewId = FEATURE_VIEW[itemId];
          if (!viewId) return null;
          const label = FEATURE_LABEL[itemId] ?? itemId;
          const active = activeView === viewId;
          return (
            <button
              key={itemId}
              data-testid={`nav-item-${viewId}`}
              onClick={() => navigate(viewId)}
              className="w-full text-left py-2 text-sm transition-all"
              style={{
                paddingLeft:  "calc(1.75rem - 3px)",
                paddingRight: "0.75rem",
                borderLeft:   active ? "3px solid hsl(var(--sidebar-primary))" : "3px solid transparent",
                borderRadius: "0 6px 6px 0",
                background:   active ? "hsl(var(--sidebar-accent))" : "transparent",
                color:        active ? "hsl(var(--sidebar-accent-foreground))" : "hsl(var(--sidebar-foreground))",
                fontWeight:   active ? 500 : 400,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LocaleSwitcher() {
  const { locale, locales, setLocale } = useLabelContext();
  if (locales.length < 2) return null;
  return (
    <div
      className="px-4 py-2.5 flex items-center gap-1.5"
      style={{ borderTop: "1px solid hsl(var(--sidebar-border))" }}
    >
      {locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            onClick={() => setLocale(l)}
            style={{
              padding: "3px 10px",
              borderRadius: 5,
              border: `1.5px solid ${active ? "hsl(var(--sidebar-primary))" : "hsl(var(--sidebar-border))"}`,
              background: active ? "hsl(var(--sidebar-primary))" : "transparent",
              color: active
                ? "hsl(var(--sidebar-primary-foreground, var(--sidebar-accent-foreground)))"
                : "hsl(var(--sidebar-foreground))",
              fontWeight: active ? 700 : 400,
              fontSize: "0.7rem",
              cursor: "pointer",
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              lineHeight: 1.4,
              opacity: active ? 1 : 0.65,
              transition: "all 150ms ease",
            }}
          >
            {l}
          </button>
        );
      })}
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { activeView, setActiveView, analysisStatus } = useAppStore();
  const { user, isAuthenticated, permissions } = useAuth();
  const branding = useBranding();
  const t = useT();

  function navigate(id: ActiveView) {
    setActiveView(id);
    onNavigate?.();
  }

  const role = user?.role ?? "";

  const loginLabel = isAuthenticated
    ? `${user!.firstName} ${user!.lastName}`
    : t("nav.login");
  const LoginIcon = isAuthenticated ? User : LogIn;

  const logoSrc = branding.logoSrc || "/brand-logo.png";
  const footerLine = branding.footerText || "IndustryStock.com";
  const footerUrl  = branding.footerUrl  || "";

  return (
    <>
      <div style={{ paddingTop: 32, paddingBottom: 16, paddingLeft: 16, paddingRight: 16 }}>
        <img
          src={logoSrc}
          alt="GAIO Analyzer"
          style={{ width: "100%", height: "auto", maxHeight: 48, objectFit: "contain", objectPosition: "left center", display: "block" }}
        />
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {MAIN_NAV.flatMap(({ id, icon, labelKey }) => {
          const label = t(labelKey);
          const btn = <NavButton key={id} id={id} icon={icon} label={label} active={activeView === id} onClick={() => navigate(id)} />;
          if (id === 3 && analysisStatus === "completed") {
            return [
              btn,
              <NavButton key={16} id={16} icon={ArrowLeftRight} label={t("nav.vergleich")} active={activeView === 16} onClick={() => navigate(16)} />,
            ];
          }
          return [btn];
        })}

        <div style={{ height: 1, background: "hsl(var(--sidebar-border))", margin: "10px 12px 6px" }} />

        <NavButton id={7} icon={LoginIcon} label={loginLabel} active={activeView === 7} onClick={() => navigate(7)} />

        {isAuthenticated && ADMIN_NAV_GROUPS.map((group) => (
          <NavGroup
            key={group.id}
            group={group}
            activeView={activeView}
            navigate={navigate}
            role={role}
            permissions={permissions}
          />
        ))}

        {isAuthenticated && canAccess("mailserver", role, permissions) && (
          <NavButton id={11} icon={Server} label={t("nav.server")} active={activeView === 11} onClick={() => navigate(11)} />
        )}
      </nav>

      <LocaleSwitcher />

      <div className="px-4 py-3 border-t" style={{ borderColor: "hsl(var(--sidebar-border))", color: "hsl(var(--sidebar-foreground))", opacity: 0.4 }}>
        <p style={{ fontSize: 10, lineHeight: 1.5, margin: 0 }}>GAIO Analyzer v2.0</p>
        <p style={{ fontSize: 10, lineHeight: 1.5, margin: 0 }}>
          {footerUrl ? (
            <a href={footerUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
              {footerLine}
            </a>
          ) : (
            footerLine
          )}
        </p>
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
  const t = useT();

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />}
      <div
        className={`fixed top-0 left-0 h-screen w-60 z-50 flex flex-col border-r transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "hsl(var(--sidebar))", borderColor: "hsl(var(--sidebar-border))" }}
      >
        <SidebarContent onNavigate={() => setOpen(false)} />
      </div>
      <button onClick={() => setOpen(true)} className="p-1 rounded-md hover:bg-muted transition-colors" aria-label={t("nav.menu_open")}>
        <Menu className="w-5 h-5" />
      </button>
    </>
  );
}
