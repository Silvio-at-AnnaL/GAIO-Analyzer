import { useEffect, useState } from "react";
import { adminFetch } from "@/store/authStore";
import { useT } from "@/lib/LabelProvider";
import { searchUsageLevel, type PriceDraft, type SearchPlanSettings } from "@/lib/admin-usage";

const inputStyle = { background: "hsl(var(--input))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" };

export function ProviderPriceFields({ providerId, value, onChange }: {
  providerId: string; value: PriceDraft; onChange: (value: PriceDraft) => void;
}) {
  const t = useT();
  return <div className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-2">
      {(["input", "output"] as const).map(field => <label key={field} className="space-y-2 text-sm font-medium">
        <span>{t(`ai.price_${field}`)}</span>
        <input type="number" min="0" step="any" data-testid={`input-price-${field}-${providerId}`}
          value={value[field]} onChange={event => onChange({ ...value, [field]: event.target.value })}
          className="w-full px-3 py-2 rounded-md border" style={inputStyle} />
      </label>)}
    </div>
    <p className="text-xs text-muted-foreground">{t("ai.price_hint")}</p>
  </div>;
}

export function TavilyPlanFields({ settings, onChange }: {
  settings: SearchPlanSettings; onChange: (key: keyof SearchPlanSettings, value: string) => void;
}) {
  const t = useT();
  const plan = settings.search_plan ?? "free";
  const fields: { key: keyof SearchPlanSettings; label: string; integer?: boolean; optional?: boolean }[] = [];
  if (["package", "enterprise"].includes(plan)) fields.push({
    key: "search_monthly_price_usd", label: "ai.search_monthly_price", optional: plan === "enterprise",
  });
  if (["free", "package", "enterprise"].includes(plan)) fields.push({
    key: "search_included_credits", label: "ai.search_included_credits", integer: true, optional: plan === "enterprise",
  });
  if (plan !== "free") fields.push({ key: "search_credit_price_usd",
    label: plan === "package" ? "ai.search_overage_price" : "ai.search_credit_price", optional: plan !== "payg",
  });
  return <div className="space-y-4">
    <label className="block space-y-2 text-sm font-medium">
      <span>{t("ai.search_plan")}</span>
      <select data-testid="select-search-plan" value={plan} onChange={event => onChange("search_plan", event.target.value)}
        className="w-full px-3 py-2 rounded-md border" style={inputStyle}>
        {["free", "payg", "package", "enterprise"].map(value =>
          <option key={value} value={value}>{t(`ai.search_plan_${value}`)}</option>)}
      </select>
    </label>
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map(field => <label key={field.key} className="space-y-2 text-sm font-medium">
        <span>{t(field.label)}{field.optional ? ` ${t("ai.search_optional")}` : ""}</span>
        <input type="number" min="0" step={field.integer ? "1" : "any"} required={!field.optional}
          data-testid={`input-${field.key.replaceAll("_", "-")}`}
          value={settings[field.key] ?? (field.integer ? "1000" : "")}
          onChange={event => onChange(field.key, event.target.value)}
          className="w-full px-3 py-2 rounded-md border" style={inputStyle} />
      </label>)}
    </div>
  </div>;
}

export function TavilyUsageLine({ allowed, userId }: { allowed: boolean; userId?: number }) {
  const t = useT();
  const [usage, setUsage] = useState<{ used: number; included: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUsage(null);
    if (allowed) void (async () => {
      try {
        const response = await adminFetch("/api/admin/usage/summary?env=live");
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && Number.isFinite(data.searchMonth?.used) && Number.isFinite(data.searchMonth?.included)) {
          setUsage(data.searchMonth);
        }
      } catch { /* Usage is optional; do not show an error box. */ }
    })();
    return () => { cancelled = true; };
  }, [allowed, userId]);
  if (!allowed || !usage) return null;
  const level = searchUsageLevel(usage.used, usage.included);
  return <div data-testid="text-tavily-usage" data-level={level}
    className={`text-sm ${level === "red" ? "text-red-500" : level === "amber" ? "text-amber-500" : "text-muted-foreground"}`}>
    <p>{t("ai.search_month_usage", { used: new Intl.NumberFormat("de-DE").format(usage.used),
      included: new Intl.NumberFormat("de-DE").format(usage.included) })}</p>
    {level === "red" && <p>{t("ai.search_quota_exhausted")}</p>}
  </div>;
}
