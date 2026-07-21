import { Fragment, useState, useEffect } from "react";
import { ShieldCheck, Save, CheckCircle, AlertCircle, Lock } from "lucide-react";
import { adminFetch, useAuth } from "@/store/authStore";
import { ADMIN_FEATURES, ADMIN_NAV_GROUPS } from "@/config/adminFeatures";
import { useT } from "@/lib/LabelProvider";

const ROLES: { id: string; label: string; locked: boolean }[] = [
  { id: "admin",         label: "users.role_admin_short", locked: true  },
  { id: "user_extended", label: "perm.role_extended",     locked: false },
  { id: "user",          label: "perm.role_basic",        locked: false },
];

type AnyFeature = { id: string; label: string; defaultRoles: readonly string[]; isGroup?: boolean };
const allFeatures = ADMIN_FEATURES as ReadonlyArray<AnyFeature>;
const configurableFeatures = allFeatures.filter((f) => !f.isGroup);

type PermissionsMap = Record<string, string[]>;

const DEFAULT_PERMISSIONS: PermissionsMap = Object.fromEntries(
  configurableFeatures.map((f) => [f.id, [...f.defaultRoles]]),
);

const ALL_GROUP_ITEMS = new Set(ADMIN_NAV_GROUPS.flatMap((g) => g.items as readonly string[]));

export function PermissionsView() {
  const t = useT();
  const { reloadPermissions } = useAuth();
  const [permissions, setPermissions] = useState<PermissionsMap>(DEFAULT_PERMISSIONS);
  const [status, setStatus]           = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [msg, setMsg]                 = useState("");

  useEffect(() => {
    adminFetch("/api/admin/settings/permissions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: PermissionsMap | null) => {
        if (d) setPermissions(d);
      })
      .catch(() => {});
  }, []);

  function toggle(featureId: string, roleId: string, enabled: boolean) {
    setPermissions((prev) => {
      const current = prev[featureId] ?? ["admin"];
      let next: string[];
      if (enabled) {
        next = current.includes(roleId) ? current : [...current, roleId];
      } else {
        next = current.filter((r) => r !== roleId);
        if (!next.includes("admin")) next = ["admin", ...next];
      }
      return { ...prev, [featureId]: next };
    });
  }

  async function save() {
    setStatus("saving");
    setMsg("");
    try {
      const res = await adminFetch("/api/admin/settings/permissions", {
        method: "PATCH",
        body: JSON.stringify(permissions),
      });
      if (res.ok) {
        setStatus("ok");
        setMsg(t("perm.saved_msg"));
        await reloadPermissions();
      } else {
        setStatus("error");
        setMsg(t("perm.save_error"));
      }
    } catch {
      setStatus("error");
      setMsg(t("perm.network_error"));
    }
  }

  function FeatureRow({ feature, idx }: { feature: AnyFeature; idx: number }) {
    const allowed = permissions[feature.id] ?? ["admin"];
    return (
      <tr
        className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
        style={idx % 2 !== 0 ? { background: "hsl(var(--muted)/0.15)" } : {}}
      >
        <td className="px-5 py-3 font-medium pl-8 text-sm">{t(feature.label)}</td>
        {ROLES.map((role) => {
          if (role.locked) {
            return (
              <td key={role.id} className="px-4 py-3 text-center">
                <div className="flex justify-center" title={t("perm.admin_always_title")}>
                  <Lock className="w-4 h-4 text-muted-foreground/50" />
                </div>
              </td>
            );
          }
          const checked = allowed.includes(role.id);
          return (
            <td key={role.id} className="px-4 py-3 text-center">
              <div className="flex justify-center">
                <button
                  onClick={() => toggle(feature.id, role.id, !checked)}
                  className="relative inline-flex items-center h-5 w-9 rounded-full transition-colors focus:outline-none"
                  style={{ background: checked ? "#3b82f6" : "hsl(var(--muted))" }}
                  role="switch"
                  aria-checked={checked}
                >
                  <span
                    className="inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
                    style={{ transform: checked ? "translateX(18px)" : "translateX(2px)" }}
                  />
                </button>
              </div>
            </td>
          );
        })}
      </tr>
    );
  }

  const standaloneFeatures = configurableFeatures.filter((f) => !ALL_GROUP_ITEMS.has(f.id));

  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5" style={{ color: "#3b82f6" }} />
          <h1 className="text-2xl font-bold tracking-tight">{t("nav.admin_rechtemanagement")}</h1>
        </div>
        <p className="text-muted-foreground text-sm">{t("perm.subtitle")}</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border" style={{ background: "hsl(var(--muted)/0.4)" }}>
              <th className="text-left px-5 py-3 font-semibold text-muted-foreground w-1/2">{t("perm.col_function")}</th>
              {ROLES.map((r) => (
                <th key={r.id} className="text-center px-4 py-3 font-semibold text-muted-foreground" style={{ width: "16.6%" }}>
                  {t(r.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ADMIN_NAV_GROUPS.map((group) => {
              const groupFeatures = (group.items as readonly string[])
                .map((itemId) => configurableFeatures.find((f) => f.id === itemId))
                .filter((f): f is AnyFeature => f != null);
              if (groupFeatures.length === 0) return null;
              return (
                <Fragment key={group.id}>
                  <tr className="border-b border-border" style={{ background: "hsl(var(--muted)/0.3)" }}>
                    <td colSpan={ROLES.length + 1} className="px-5 py-2">
                      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                        {t(group.label)}
                      </span>
                    </td>
                  </tr>
                  {groupFeatures.map((feature, idx) => (
                    <FeatureRow key={feature.id} feature={feature} idx={idx} />
                  ))}
                </Fragment>
              );
            })}
            {standaloneFeatures.length > 0 && (
              <Fragment>
                <tr className="border-b border-border" style={{ background: "hsl(var(--muted)/0.3)" }}>
                  <td colSpan={ROLES.length + 1} className="px-5 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {t("perm.col_system")}
                    </span>
                  </td>
                </tr>
                {standaloneFeatures.map((feature, idx) => (
                  <FeatureRow key={feature.id} feature={feature} idx={idx} />
                ))}
              </Fragment>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <button
          onClick={save}
          disabled={status === "saving"}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 w-fit"
          style={{ background: "#3b82f6" }}
        >
          <Save className="w-4 h-4" />
          {status === "saving" ? t("auth.saving_loading") : t("profile.save_button")}
        </button>
        {msg && (
          <span className="flex items-center gap-1.5 text-sm" style={{ color: status === "ok" ? "#3b82f6" : "#d97706" }}>
            {status === "ok" ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {msg}
          </span>
        )}
      </div>

      <div
        className="rounded-lg border border-border p-4 text-sm text-muted-foreground"
        style={{ background: "hsl(var(--muted)/0.3)" }}
      >
        <p className="font-medium text-foreground mb-1">{t("perm.hint_title")}</p>
        <p>{t("perm.hint_text")}</p>
      </div>
    </div>
  );
}
