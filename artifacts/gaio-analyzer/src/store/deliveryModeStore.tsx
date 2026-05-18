import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type DeliveryMode = "download" | "mail-only";

interface DeliveryModeState {
  mode: DeliveryMode;
  isLoading: boolean;
}

const DeliveryModeContext = createContext<DeliveryModeState>({ mode: "download", isLoading: false });

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function DeliveryModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DeliveryMode>("download");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/admin/public/delivery-mode`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { mode?: string } | null) => {
        if (d?.mode === "mail-only") setMode("mail-only");
        else setMode("download");
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <DeliveryModeContext.Provider value={{ mode, isLoading }}>
      {children}
    </DeliveryModeContext.Provider>
  );
}

export function useDeliveryMode() {
  return useContext(DeliveryModeContext);
}
