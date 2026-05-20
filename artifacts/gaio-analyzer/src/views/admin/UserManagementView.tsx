import { useState, useEffect, useCallback } from "react";
import { Trash2, UserPlus, RefreshCw } from "lucide-react";
import { useAuth, adminFetch } from "@/store/authStore";
import { useAppStore } from "@/store/appStore";

interface UserRow {
  id: number;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: "admin" | "user_extended" | "user";
  isActive: boolean;
  mustChangePw: boolean;
  createdAt: string;
  lastLogin: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  user_extended: "Erw. Benutzer",
  user: "Benutzer",
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function UserManagementView() {
  const { user: me, isAuthenticated, isLoading } = useAuth();
  const { setActiveView } = useAppStore();
  const [users, setUsers]       = useState<UserRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [error, setError]       = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating,  setCreating]   = useState(false);
  const [newFirst,  setNewFirst]   = useState("");
  const [newLast,   setNewLast]    = useState("");
  const [newEmail,  setNewEmail]   = useState("");
  const [createMsg, setCreateMsg]  = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoadingUsers(true);
    const res = await adminFetch("/api/admin/users");
    if (res.ok) { const d = await res.json(); setUsers(d.users); }
    else setError("Benutzer konnten nicht geladen werden.");
    setLoadingUsers(false);
  }, []);

  useEffect(() => { if (isAuthenticated && me?.role === "admin") fetchUsers(); }, [isAuthenticated, me, fetchUsers]);

  if (isLoading) return <div className="p-8 text-muted-foreground text-sm">Laden…</div>;
  if (!isAuthenticated) return <div className="p-8"><p className="text-muted-foreground mb-3">Sie sind nicht angemeldet.</p><button className="text-sm underline text-primary" onClick={() => setActiveView(7)}>Zum Login</button></div>;
  if (me?.role !== "admin") return <div className="p-8 text-muted-foreground">Kein Zugriff. Diese Seite ist nur für Administratoren.</div>;

  async function changeRole(userId: number, role: string) {
    const res = await adminFetch(`/api/admin/users/${userId}/role`, { method: "PATCH", body: JSON.stringify({ role }) });
    if (res.ok) fetchUsers();
    else { const d = await res.json(); setError(d.error ?? "Fehler beim Ändern der Rolle"); }
  }

  async function deleteUser(userId: number) {
    const res = await adminFetch(`/api/admin/users/${userId}`, { method: "DELETE" });
    if (res.ok) { setDeleteConfirm(null); fetchUsers(); }
    else { const d = await res.json(); setError(d.error ?? "Fehler beim Löschen"); }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault(); setCreateMsg(""); setCreating(true);
    const res = await adminFetch("/api/admin/users", { method: "POST", body: JSON.stringify({ firstName: newFirst, lastName: newLast, email: newEmail }) });
    const d = await res.json();
    setCreating(false);
    if (res.ok) { setNewFirst(""); setNewLast(""); setNewEmail(""); setShowCreate(false); fetchUsers(); }
    else setCreateMsg(d.error ?? "Fehler beim Anlegen");
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Nutzerverwaltung</h1>
        <div className="flex gap-2">
          <button onClick={fetchUsers} className="p-2 rounded-lg transition-colors hover:bg-muted" title="Aktualisieren"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => { setShowCreate(true); setCreateMsg(""); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
            <UserPlus className="w-4 h-4" /> Neuen User anlegen
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-amber-400">{error}</p>}

      {/* Create user form */}
      {showCreate && (
        <div className="p-5 rounded-xl space-y-4" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <h2 className="font-semibold text-sm">Neuen Benutzer anlegen</h2>
          <form onSubmit={createUser} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Vorname",  val: newFirst, set: setNewFirst },
                { label: "Nachname", val: newLast,  set: setNewLast },
                { label: "E-Mail",   val: newEmail, set: setNewEmail },
              ].map(f => (
                <div key={f.label} className="space-y-1">
                  <label className="text-xs font-medium">{f.label}</label>
                  <input value={f.val} onChange={e => f.set(e.target.value)} required
                    className="w-full px-2.5 py-1.5 rounded-lg text-sm"
                    style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                </div>
              ))}
            </div>
            {createMsg && <p className="text-xs text-amber-400">{createMsg}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={creating}
                className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}>
                {creating ? "Anlegen…" : "Anlegen"}
              </button>
              <button type="button" onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ border: "1px solid hsl(var(--border))" }}>
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))" }}>
        {loadingUsers ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Laden…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))" }}>
                {["Name", "E-Mail", "Benutzername", "Rolle", "Status", "Erstellt", "Letzter Login", "Aktionen"].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: "1px solid hsl(var(--border)/0.5)" }}>
                  <td className="px-4 py-3 font-medium">{u.firstName} {u.lastName}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{u.email}</td>
                  <td className="px-4 py-3 font-mono text-xs">{u.username}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={u.id === me?.id}
                      onChange={e => changeRole(u.id, e.target.value)}
                      className="text-xs rounded px-2 py-1"
                      style={{ background: "hsl(var(--input))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                      <option value="user">Benutzer</option>
                      <option value="user_extended">Erw. Benutzer</option>
                      <option value="admin" disabled={!u.isActive}>Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: u.isActive ? "rgba(37,99,235,0.15)" : "rgba(156,163,175,0.15)", color: u.isActive ? "#3b82f6" : "#9ca3af" }}>
                      {u.isActive ? "Aktiv" : "Inaktiv"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(u.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(u.lastLogin)}</td>
                  <td className="px-4 py-3">
                    {u.id !== me?.id && (
                      deleteConfirm === u.id ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Löschen?</span>
                          <button onClick={() => deleteUser(u.id)} className="text-xs text-amber-400 font-medium hover:underline">Ja</button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-xs text-muted-foreground hover:underline">Nein</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(u.id)} className="p-1 rounded hover:bg-amber-500/10 text-muted-foreground hover:text-amber-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">Keine Benutzer gefunden</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {users.length} Benutzer · Rollen können nur für aktive Benutzer auf "Admin" gesetzt werden
      </p>
    </div>
  );
}
