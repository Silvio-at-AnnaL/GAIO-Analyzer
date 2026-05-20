import { useState, useEffect, useCallback } from "react";
import { adminFetch } from "@/store/authStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Share2, Copy, Trash2, ExternalLink, Plus, RefreshCw, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShareItem {
  id: number;
  token: string;
  analysisId: number | null;
  domain: string | null;
  companyName: string | null;
  title: string | null;
  createdAt: string;
  expiresAt: string;
  isActive: boolean;
  viewCount: number;
  shareUrl: string;
}

interface AccessLogEntry {
  id: number;
  accessedAt: string;
  ipHash: string | null;
  userAgent: string | null;
}

interface LogItem {
  id: number;
  domain: string;
  companyName: string | null;
  gaioScore: number | null;
  startedAt: string;
  status: string;
  hasHtmlExport: boolean;
}

function isExpired(expiresAt: string) {
  return new Date(expiresAt) < new Date();
}

function ShareUrlRow({ url }: { url: string }) {
  const { toast } = useToast();
  const copy = () => {
    navigator.clipboard.writeText(url).then(() => toast({ title: "URL kopiert" }));
  };
  return (
    <div className="flex items-center gap-2 mt-1">
      <span className="text-xs text-muted-foreground font-mono truncate max-w-xs">{url}</span>
      <button onClick={copy} className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors" title="Kopieren">
        <Copy style={{ width: 12, height: 12, color: "#3b82f6" }} />
      </button>
      <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors" title="Öffnen">
        <ExternalLink style={{ width: 12, height: 12, color: "#3b82f6" }} />
      </a>
    </div>
  );
}

function AccessLogDrawer({ shareId, shareToken }: { shareId: number; shareToken: string }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AccessLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/shares/${shareId}/access-log`);
      const data = await res.json() as { items: AccessLogEntry[] };
      setLogs(data.items ?? []);
    } finally { setLoading(false); }
  }, [shareId]);

  const toggle = () => {
    if (!open) load();
    setOpen(!open);
  };

  return (
    <div>
      <button onClick={toggle} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <Eye style={{ width: 11, height: 11 }} />
        Zugriffslog
        {open ? <ChevronUp style={{ width: 11, height: 11 }} /> : <ChevronDown style={{ width: 11, height: 11 }} />}
      </button>
      {open && (
        <div className="mt-2 rounded border text-xs" style={{ borderColor: "hsl(var(--border))" }}>
          {loading ? (
            <div className="px-3 py-2 text-muted-foreground">Lade...</div>
          ) : logs.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground">Noch keine Zugriffe.</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--muted))" }}>
                  <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">Zeitpunkt</th>
                  <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">IP-Hash</th>
                  <th className="px-3 py-1.5 text-left text-muted-foreground font-medium">User-Agent</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={l.id} style={{ borderBottom: i < logs.length - 1 ? "1px solid hsl(var(--border))" : undefined }}>
                    <td className="px-3 py-1.5">{new Date(l.accessedAt).toLocaleString("de-DE")}</td>
                    <td className="px-3 py-1.5 font-mono text-muted-foreground">{l.ipHash ?? "—"}</td>
                    <td className="px-3 py-1.5 text-muted-foreground max-w-xs truncate">{l.userAgent ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function CreateShareDialog({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [logItems, setLogItems] = useState<LogItem[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [expiryDays, setExpiryDays] = useState(30);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const loadLog = useCallback(async () => {
    setLogLoading(true);
    try {
      const res = await adminFetch("/api/admin/analysis-log?limit=100&status=completed");
      const data = await res.json() as { items: LogItem[] };
      setLogItems((data.items ?? []).filter((i) => i.hasHtmlExport));
    } finally { setLogLoading(false); }
  }, []);

  const handleOpen = () => {
    setOpen(true);
    loadLog();
  };

  const handleCreate = async () => {
    if (!selectedId) return;
    setCreating(true);
    try {
      const res = await adminFetch("/api/admin/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId: selectedId, expiryDays, title: title.trim() || null }),
      });
      if (!res.ok) { toast({ title: "Fehler beim Erstellen", variant: "destructive" }); return; }
      toast({ title: "Freigabe erstellt" });
      setOpen(false);
      setSelectedId("");
      setTitle("");
      onCreated();
    } finally { setCreating(false); }
  };

  if (!open) {
    return (
      <Button size="sm" onClick={handleOpen}>
        <Plus className="w-3 h-3 mr-1.5" />
        Neue Freigabe
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border p-6 shadow-xl space-y-4" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h2 className="text-base font-bold">Analyse teilen</h2>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Analyse</label>
          <select
            className="w-full rounded border bg-background px-3 py-2 text-sm"
            style={{ borderColor: "hsl(var(--border))" }}
            value={selectedId}
            onChange={(e) => setSelectedId(Number(e.target.value) || "")}
            disabled={logLoading}
          >
            <option value="">— Analyse auswählen —</option>
            {logItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.domain} · {new Date(item.startedAt).toLocaleDateString("de-DE")} · Score: {item.gaioScore ?? "n/a"}
              </option>
            ))}
          </select>
          {logLoading && <div className="text-xs text-muted-foreground">Lade Analysen...</div>}
          {!logLoading && logItems.length === 0 && (
            <div className="text-xs" style={{ color: "#d97706" }}>Keine Analysen mit HTML-Export gefunden.</div>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Titel (optional)</label>
          <input
            className="w-full rounded border bg-background px-3 py-2 text-sm"
            style={{ borderColor: "hsl(var(--border))" }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Q1 2026 Analyse"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Gültig für (Tage)</label>
          <input
            type="number"
            min={1}
            max={365}
            className="w-full rounded border bg-background px-3 py-2 text-sm"
            style={{ borderColor: "hsl(var(--border))" }}
            value={expiryDays}
            onChange={(e) => setExpiryDays(Math.max(1, Math.min(365, Number(e.target.value))))}
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Abbrechen</Button>
          <Button size="sm" onClick={handleCreate} disabled={!selectedId || creating}>
            {creating ? <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" /> : null}
            Freigabe erstellen
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SharesView() {
  const { toast } = useToast();
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch("/api/admin/shares");
      const data = await res.json() as { items: ShareItem[] };
      setShares(data.items ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deactivate = async (id: number) => {
    const res = await adminFetch(`/api/admin/shares/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "Freigabe deaktiviert" });
      load();
    }
  };

  const active = shares.filter((s) => s.isActive && !isExpired(s.expiresAt));
  const inactive = shares.filter((s) => !s.isActive || isExpired(s.expiresAt));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Share2 className="shrink-0" style={{ width: 20, height: 20, color: "#3b82f6" }} />
          <div>
            <h1 className="text-xl font-bold">Geteilte Analysen</h1>
            <p className="text-sm text-muted-foreground">Erstelle und verwalte öffentliche Links zu gespeicherten Analysen.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={load} disabled={loading} className="p-1.5 rounded hover:bg-muted transition-colors" title="Aktualisieren">
            <RefreshCw style={{ width: 14, height: 14, color: "hsl(var(--muted-foreground))" }} className={loading ? "animate-spin" : ""} />
          </button>
          <CreateShareDialog onCreated={load} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Aktive Freigaben", value: active.length, color: "#3b82f6" },
          { label: "Abgelaufen / Deaktiviert", value: inactive.length, color: "#6b7280" },
          { label: "Gesamtaufrufe", value: shares.reduce((s, i) => s + i.viewCount, 0), color: "#3b82f6" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border p-3 text-center" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
            <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Shares list */}
      {loading && shares.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Lade...</div>
      ) : shares.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" style={{ borderColor: "hsl(var(--border))" }}>
          Noch keine Freigaben erstellt.
        </div>
      ) : (
        <div className="space-y-3">
          {shares.map((share) => {
            const expired = isExpired(share.expiresAt);
            const statusColor = share.isActive && !expired ? "#3b82f6" : "#6b7280";
            const statusLabel = !share.isActive ? "Deaktiviert" : expired ? "Abgelaufen" : "Aktiv";
            return (
              <div key={share.id} className="rounded-lg border p-4 space-y-2" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))", opacity: (!share.isActive || expired) ? 0.6 : 1 }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{share.title || share.domain || "Freigabe"}</span>
                      {share.domain && share.title && <span className="text-xs text-muted-foreground">{share.domain}</span>}
                      <Badge variant="outline" style={{ fontSize: 10, color: statusColor, borderColor: statusColor }}>
                        {statusLabel}
                      </Badge>
                    </div>
                    <ShareUrlRow url={share.shareUrl} />
                  </div>
                  {share.isActive && !expired && (
                    <button
                      onClick={() => deactivate(share.id)}
                      className="shrink-0 p-1.5 rounded hover:bg-muted transition-colors"
                      title="Deaktivieren"
                    >
                      <Trash2 style={{ width: 14, height: 14, color: "#d97706" }} />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Erstellt: {new Date(share.createdAt).toLocaleDateString("de-DE")}</span>
                  <span>Gültig bis: {new Date(share.expiresAt).toLocaleDateString("de-DE")}</span>
                  <span className="flex items-center gap-1">
                    <Eye style={{ width: 11, height: 11 }} />
                    {share.viewCount} Aufrufe
                  </span>
                </div>

                <AccessLogDrawer shareId={share.id} shareToken={share.token} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
