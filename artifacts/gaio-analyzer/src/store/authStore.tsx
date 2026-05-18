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

interface AuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  pendingChangeUsername: string | null;
  setPendingChangeUsername: (u: string | null) => void;
  login: (user: AdminUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]                             = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading]                   = useState(true);
  const [pendingChangeUsername, setPendingChangeUsername] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const res = await adminFetch("/api/admin/me");
      if (res.ok) { const d = await res.json(); setUser(d.user); }
      else setUser(null);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refreshUser(); }, [refreshUser]);

  const login = useCallback((u: AdminUser) => {
    setUser(u);
    setIsLoading(false);
    setPendingChangeUsername(null);
  }, []);

  const logout = useCallback(async () => {
    await adminFetch("/api/admin/logout", { method: "POST" });
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      user, isAuthenticated: !!user, isLoading,
      pendingChangeUsername, setPendingChangeUsername,
      login, logout, refreshUser,
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
