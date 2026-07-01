import { useT } from "@/lib/LabelProvider";

export function FaqView() {
  const t = useT();

  const modules = [
    { modul: t("faq.mod1_name"), pruefung: t("faq.mod1_check"), wichtig: t("faq.mod1_why") },
    { modul: t("faq.mod2_name"), pruefung: t("faq.mod2_check"), wichtig: t("faq.mod2_why") },
    { modul: t("faq.mod3_name"), pruefung: t("faq.mod3_check"), wichtig: t("faq.mod3_why") },
    { modul: t("faq.mod4_name"), pruefung: t("faq.mod4_check"), wichtig: t("faq.mod4_why") },
    { modul: t("faq.mod5_name"), pruefung: t("faq.mod5_check"), wichtig: t("faq.mod5_why") },
    { modul: t("faq.mod6_name"), pruefung: t("faq.mod6_check"), wichtig: t("faq.mod6_why") },
  ];

  const weights = [
    { label: t("faq.weight_schema"),  pct: 20, color: "hsl(var(--chart-4))" },
    { label: t("faq.weight_content"), pct: 20, color: "hsl(var(--chart-1))" },
    { label: t("faq.weight_llm"),     pct: 20, color: "hsl(var(--chart-2))" },
    { label: t("faq.weight_tech"),    pct: 15, color: "hsl(var(--chart-3))" },
    { label: t("faq.weight_faq"),     pct: 15, color: "hsl(var(--chart-5))" },
    { label: t("faq.weight_heading"), pct: 10, color: "hsl(var(--muted-foreground))" },
  ];

  const scoreRanges = [
    { range: "0–40",   bewertung: t("faq.score_critical_label"),  bedeutung: t("faq.score_critical_desc"),  color: "hsl(0 84% 60%)" },
    { range: "41–60",  bewertung: t("faq.score_improving_label"), bedeutung: t("faq.score_improving_desc"), color: "hsl(35 92% 55%)" },
    { range: "61–75",  bewertung: t("faq.score_solid_label"),     bedeutung: t("faq.score_solid_desc"),     color: "hsl(43 96% 56%)" },
    { range: "76–90",  bewertung: t("faq.score_strong_label"),    bedeutung: t("faq.score_strong_desc"),    color: "hsl(142 71% 45%)" },
    { range: "91–100", bewertung: t("faq.score_excellent_label"), bedeutung: t("faq.score_excellent_desc"), color: "hsl(142 71% 38%)" },
  ];

  const sitemapRows: [string, string, string][] = [
    [t("faq.sitemap_row_purpose_label"),   t("faq.sitemap_row_purpose_xml"),    t("faq.sitemap_row_purpose_html")],
    [t("faq.sitemap_row_google_label"),    t("faq.sitemap_row_google_xml"),     t("faq.sitemap_row_google_html")],
    [t("faq.sitemap_row_links_label"),     t("faq.sitemap_row_links_xml"),      t("faq.sitemap_row_links_html")],
    [t("faq.sitemap_row_llm_train_label"), t("faq.sitemap_row_llm_train_xml"),  t("faq.sitemap_row_llm_train_html")],
    [t("faq.sitemap_row_rag_label"),       t("faq.sitemap_row_rag_xml"),        t("faq.sitemap_row_rag_html")],
    [t("faq.sitemap_row_scale_label"),     t("faq.sitemap_row_scale_xml"),      t("faq.sitemap_row_scale_html")],
  ];

  const priorityTiers = [
    {
      dot: "🔴",
      label: t("faq.score_critical_label"),
      color: "hsl(0 84% 60%)",
      bg: "hsl(0 84% 60% / 0.08)",
      border: "hsl(0 84% 60% / 0.3)",
      desc: t("faq.priority_critical_desc"),
    },
    {
      dot: "🟠",
      label: t("faq.priority_high_label"),
      color: "hsl(35 92% 55%)",
      bg: "hsl(35 92% 55% / 0.08)",
      border: "hsl(35 92% 55% / 0.3)",
      desc: t("faq.priority_high_desc"),
    },
    {
      dot: "🟡",
      label: t("faq.priority_low_label"),
      color: "hsl(43 96% 50%)",
      bg: "hsl(43 96% 50% / 0.08)",
      border: "hsl(43 96% 50% / 0.3)",
      desc: t("faq.priority_low_desc"),
    },
  ];

  return (
    <div className="max-w-3xl space-y-10 pb-12">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.faq")}</h1>
        <p className="text-muted-foreground mt-1">{t("faq.subtitle")}</p>
      </div>

      {/* Was analysiert dieses Tool? */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b border-border pb-2">{t("faq.section_what")}</h2>
        <p className="text-base leading-relaxed text-foreground/90">
          {t("faq.what_desc")}
        </p>
      </section>

      {/* Analyse-Module */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">{t("faq.section_modules")}</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-48">{t("faq.col_module")}</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t("faq.col_checked")}</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t("faq.col_why")}</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m, i) => (
                <tr key={i} className="border-b border-border last:border-0" style={{ background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.3)" }}>
                  <td className="px-4 py-3 font-medium align-top">{m.modul}</td>
                  <td className="px-4 py-3 text-muted-foreground align-top leading-relaxed" dangerouslySetInnerHTML={{ __html: m.pruefung }} />
                  <td className="px-4 py-3 text-muted-foreground align-top leading-relaxed">{m.wichtig}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ background: "#f8f9fa", borderLeft: "3px solid #dde0e8", borderRadius: "6px", padding: "14px 16px", marginTop: "8px" }}>
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            <sup>*</sup> {t("faq.sitemap_title")}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mb-3">
            {t("faq.sitemap_desc")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border border-border">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground whitespace-nowrap">{t("faq.sitemap_col_criterion")}</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">sitemap.xml</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-muted-foreground">/sitemap (HTML)</th>
                </tr>
              </thead>
              <tbody>
                {sitemapRows.map(([k, v1, v2], i) => (
                  <tr key={i} className="border-b border-border last:border-0" style={{ background: i % 2 === 1 ? "hsl(var(--muted) / 0.3)" : "transparent" }}>
                    <td className="px-2 py-1.5 font-medium align-top whitespace-nowrap">{k}</td>
                    <td className="px-2 py-1.5 text-muted-foreground align-top leading-relaxed">{v1}</td>
                    <td className="px-2 py-1.5 text-muted-foreground align-top leading-relaxed">{v2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground italic mt-3 leading-relaxed">
            {t("faq.sitemap_recommendation")}
          </p>
        </div>
      </section>

      {/* Score-Gewichtung */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">{t("faq.section_weights")}</h2>
        <div className="space-y-3">
          {weights.map((w) => (
            <div key={w.label} className="flex items-center gap-4">
              <div className="w-40 text-sm font-medium shrink-0">{w.label}</div>
              <div className="flex-1 h-6 rounded-md overflow-hidden bg-muted/40 relative">
                <div
                  className="h-full rounded-md transition-all"
                  style={{ width: `${w.pct * 5}%`, background: w.color, opacity: 0.85 }}
                />
              </div>
              <div className="w-10 text-sm font-bold text-right" style={{ color: w.color }}>{w.pct}%</div>
            </div>
          ))}
        </div>
      </section>

      {/* Score-Interpretation */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">{t("faq.section_scores")}</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-24">{t("faq.score_col_score")}</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-32">{t("faq.score_col_rating")}</th>
                <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">{t("faq.score_col_meaning")}</th>
              </tr>
            </thead>
            <tbody>
              {scoreRanges.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0" style={{ background: i % 2 === 0 ? "transparent" : "hsl(var(--muted) / 0.3)" }}>
                  <td className="px-4 py-3 font-bold font-mono" style={{ color: r.color }}>{r.range}</td>
                  <td className="px-4 py-3 font-semibold" style={{ color: r.color }}>{r.bewertung}</td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">{r.bedeutung}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Empfehlungs-Priorisierung */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold border-b border-border pb-2">{t("faq.section_priority")}</h2>
        <p className="text-sm text-muted-foreground">{t("faq.priority_desc")}</p>
        <div className="space-y-3">
          {priorityTiers.map((tier) => (
            <div
              key={tier.label}
              className="rounded-lg border px-4 py-3 flex gap-3 items-start"
              style={{ background: tier.bg, borderColor: tier.border }}
            >
              <span className="text-lg leading-none mt-0.5">{tier.dot}</span>
              <div>
                <p className="font-semibold text-sm" style={{ color: tier.color }}>{tier.label}</p>
                <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{tier.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Hinweise zur Genauigkeit */}
      <section className="space-y-3">
        <h2 className="text-xl font-semibold border-b border-border pb-2">{t("faq.section_accuracy")}</h2>
        <p className="text-base leading-relaxed text-muted-foreground">
          {t("faq.accuracy_desc")}
        </p>
      </section>
    </div>
  );
}
