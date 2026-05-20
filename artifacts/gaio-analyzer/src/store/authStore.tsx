import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export interface AdminUser {
  id: number;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: "admin" | "user_extended" | "user";
  isActive: boolean;
  mustChangePw: boolean;
}

export type Permissions = Record<string, string[]>;

interface AuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  pendingChangeUsername: string | null;
  permissions: Permissions;
  setPendingChangeUsername: (u: string | null) => void;
  login: (user: AdminUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  reloadPermissions: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
}

export function canAccess(featureId: string, userRole: string, permissions: Permissions): boolean {
  if (userRole === "admin") return true;
  const allowed = permissions[featureId] ?? ["admin"];
  return allowed.includes(userRole);
}

async function fetchPermissions(): Promise<Permissions> {
  try {
    const res = await adminFetch("/api/admin/settings/permissions");
    if (res.ok) return (await res.json()) as Permissions;
  } catch { /* ignore */ }
  return {};
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]                             = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading]                   = useState(true);
  const [pendingChangeUsername, setPendingChangeUsername] = useState<string | null>(null);
  const [permissions, setPermissions]               = useState<Permissions>({});

  const reloadPermissions = useCallback(async () => {
    const p = await fetchPermissions();
    setPermissions(p);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/me");
      if (res.ok) {
        const d = await res.json() as { user: AdminUser };
        setUser(d.user);
        const p = await fetchPermissions();
        setPermissions(p);
      } else {
        setUser(null);
        setPermissions({});
      }
    } catch {
      setUser(null);
      setPermissions({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = useCallback((u: AdminUser) => {
    setUser(u);
    setIsLoading(false);
    setPendingChangeUsername(null);
    fetchPermissions().then(setPermissions);
  }, []);

  const logout = useCallback(async () => {
    await adminFetch("/api/admin/logout", { method: "POST" });
    setUser(null);
    setPermissions({});
  }, []);

  return (
    <AuthContext.Provider value={{
      user, isAuthenticated: !!user, isLoading,
      pendingChangeUsername, setPendingChangeUsername,
      permissions,
      login, logout, refreshUser, reloadPermissions,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
