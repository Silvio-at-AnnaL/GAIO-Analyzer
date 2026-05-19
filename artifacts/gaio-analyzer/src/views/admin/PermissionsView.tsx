import { useState, useEffect } from "react";
import { ShieldCheck, Save, CheckCircle, AlertCircle, Lock } from "lucide-react";
import { adminFetch, useAuth } from "@/store/authStore";

const FEATURES: { id: string; label: string }[] = [
  { id: "nutzerverwaltung", label: "Nutzerverwaltung" },
  { id: "analyseprotokoll", label: "Analyseprotokoll" },
  { id: "erscheinungsbild", label: "Erscheinungsbild" },
  { id: "kontakt_daten",    label: "Kontakt-Daten" },
  { id: "rechtemanagement", label: "Rechtemanagement" },
  { id: "ki_tool",          label: "KI-Tool" },
  { id: "mailserver",       label: "Mailserver" },
  { id: "versand_analyse",  label: "Versand-Analyse" },
];

const ROLES: { id: string; label: string; locked: boolean }[] = [
  { id: "admin",         label: "Admin (a)",                locked: true },
  { id: "user_extended", label: "Erweiterter User (b)",     locked: false },
  { id: "user",          label: "User (c)",                 locked: false },
];

type PermissionsMap = Record<string, string[]>;

const DEFAULT_PERMISSIONS: PermissionsMap = Object.fromEntries(
  FEATURES.map((f) => [f.id, ["admin"]])
);

export function PermissionsView() {
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
        setMsg("Berechtigungen gespeichert.");
        await reloadPermissions();
      } else {
        setStatus("error");
        setMsg("Fehler beim Speichern.");
      }
    } catch {
      setStatus("error");
      setMsg("Netzwerkfehler.");
    }
  }

  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5" style={{ color: "#3b82f6" }} />
          <h1 className="text-2xl font-bold tracking-tight">Rechtemanagement</h1>
        </div>
        <p className="text-muted-foreground text-sm">Steuern Sie, welche Rollen auf Admin-Bereiche zugreifen dürfen.</p>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border" style={{ background: "hsl(var(--muted)/0.4)" }}>
              <th className="text-left px-5 py-3 font-semibold text-muted-foreground w-1/2">Funktion</th>
              {ROLES.map((r) => (
                <th key={r.id} className="text-center px-4 py-3 font-semibold text-muted-foreground" style={{ width: "16.6%" }}>
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((feature, idx) => {
              const allowed = permissions[feature.id] ?? ["admin"];
              return (
                <tr
                  key={feature.id}
                  className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
                  style={idx % 2 === 0 ? {} : { background: "hsl(var(--muted)/0.15)" }}
                >
                  <td className="px-5 py-3 font-medium">{feature.label}</td>
                  {ROLES.map((role) => {
                    if (role.locked) {
                      return (
                        <td key={role.id} className="px-4 py-3 text-center">
                          <div className="flex justify-center" title="Admins haben immer Zugriff">
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
            })}
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
          {status === "saving" ? "Speichern…" : "Speichern"}
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
        <p className="font-medium text-foreground mb-1">Hinweis</p>
        <p>
          Änderungen gelten sofort für alle angemeldeten User. Admins behalten immer Zugriff
          auf alle Bereiche, unabhängig von dieser Konfiguration.
        </p>
      </div>
    </div>
  );
}
