import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { InfoTooltip as Tooltip } from "@/components/ui/InfoTooltip";
import { Plus, X, Loader2, ChevronDown, ChevronUp, Pencil, Check, Sparkles, Globe, CheckCircle2, AlertTriangle } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useStartAnalysis, usePrefillQuestionnaire } from "@workspace/api-client-react";
import { normalizeUrl } from "@/lib/utils";
import { useT } from "@/lib/LabelProvider";

const MAX_VISIBLE_PAGES = 15;

export function DomainAnalyseView() {
  const {
    domainForm, setDomainForm,
    setAnalysisId, setAnalysisStatus, setActiveView,
    crawledPages, selectedPages, setSelectedPages,
  } = useAppStore();

  const startAnalysis = useStartAnalysis();
  const prefillMutation = usePrefillQuestionnaire();
  const t = useT();

  const [errors, setErrors] = useState<{ companyName?: string; url?: string }>({});
  const [showAllPages, setShowAllPages] = useState(false);
  const [phase2Visible, setPhase2Visible] = useState(false);
  const [prefillError, setPrefillError] = useState<string | null>(null);
  const [competitorVerified, setCompetitorVerified] = useState<Record<string, boolean>>({});

  const [editablePages, setEditablePages] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const [newUrlValue, setNewUrlValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const newUrlInputRef = useRef<HTMLInputElement>(null);
  const phase2Ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hasData =
      domainForm.competitors.some((c) => c.trim() !== "") ||
      domainForm.personas.trim() !== "";
    if (hasData) setPhase2Visible(true);
  }, []);

  useEffect(() => {
    if (crawledPages.length > 0) {
      setEditablePages([...crawledPages]);
      setSelectedPages([...crawledPages]);
    }
  }, [crawledPages]);

  useEffect(() => {
    if (editingIndex !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingIndex]);

  useEffect(() => {
    if (addingNew) {
      newUrlInputRef.current?.focus();
    }
  }, [addingNew]);

  useEffect(() => {
    if (phase2Visible) {
      setTimeout(() => {
        phase2Ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }, [phase2Visible]);

  const updateField = <K extends keyof typeof domainForm>(key: K, value: typeof domainForm[K]) => {
    setDomainForm({ ...domainForm, [key]: value });
  };

  const updateCompetitor = (index: number, value: string) => {
    const next = [...domainForm.competitors];
    next[index] = value;
    if (value.trim() !== "" && index === next.length - 1 && next.length < 10) {
      next.push("");
    }
    setDomainForm({ ...domainForm, competitors: next });
  };

  const removeCompetitor = (index: number) => {
    const next = domainForm.competitors.filter((_, i) => i !== index);
    setDomainForm({ ...domainForm, competitors: next.length > 0 ? next : [""] });
  };

  const validate = () => {
    const errs: { companyName?: string; url?: string } = {};
    if (!domainForm.companyName.trim()) errs.companyName = t("domain.error_company_required");
    if (!domainForm.url.trim()) errs.url = t("domain.error_url_required");
    else if (!domainForm.url.startsWith("http")) errs.url = t("domain.error_url_invalid");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const validatePhase1 = () => {
    const errs: { companyName?: string; url?: string } = {};
    if (!domainForm.companyName.trim()) errs.companyName = t("domain.error_company_required");
    if (!domainForm.url.trim()) errs.url = t("domain.error_url_required");
    else if (!domainForm.url.startsWith("http")) errs.url = t("domain.error_url_invalid");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handlePrefill = () => {
    if (!validatePhase1()) return;
    setPrefillError(null);

    prefillMutation.mutate(
      {
        data: {
          company_name: domainForm.companyName.trim(),
          url: domainForm.url.trim(),
        },
      },
      {
        onSuccess: (result) => {
          const competitorUrls = result.competitors.map((c) => c.url);
          const filledUrls = competitorUrls.length > 0 ? [...competitorUrls, ""] : [""];
          setDomainForm({
            ...domainForm,
            personas: result.personas || domainForm.personas,
            competitors: filledUrls,
          });
          const verifiedMap: Record<string, boolean> = {};
          result.competitors.forEach((c) => {
            verifiedMap[c.url] = c.verified;
          });
          setCompetitorVerified(verifiedMap);
          setPhase2Visible(true);
        },
        onError: () => {
          setPrefillError(t("domain.error_prefill_failed"));
          setPhase2Visible(true);
        },
      }
    );
  };

  const handleRevealManually = () => {
    setPrefillError(null);
    setPhase2Visible(true);
  };

  const togglePage = (url: string) => {
    const next = selectedPages.includes(url)
      ? selectedPages.filter((u) => u !== url)
      : [...selectedPages, url];
    setSelectedPages(next);
  };

  const allSelected = editablePages.length > 0 && selectedPages.length === editablePages.length;
  const toggleAll = () => {
    setSelectedPages(allSelected ? [] : [...editablePages]);
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditingValue(editablePages[index]);
  };

  const confirmEdit = () => {
    if (editingIndex === null) return;
    const oldUrl = editablePages[editingIndex];
    const newUrl = editingValue.trim();

    if (newUrl && newUrl !== oldUrl) {
      const next = [...editablePages];
      next[editingIndex] = newUrl;
      setEditablePages(next);
      setSelectedPages(selectedPages.map((u) => (u === oldUrl ? newUrl : u)));
    }

    setEditingIndex(null);
    setEditingValue("");
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditingValue("");
  };

  const confirmAddNew = () => {
    const url = newUrlValue.trim();
    if (url) {
      setEditablePages((prev) => [...prev, url]);
      setSelectedPages([...selectedPages, url]);
    }
    setAddingNew(false);
    setNewUrlValue("");
  };

  const cancelAddNew = () => {
    setAddingNew(false);
    setNewUrlValue("");
  };

  const visiblePages = showAllPages ? editablePages : editablePages.slice(0, MAX_VISIBLE_PAGES);

  const handleStart = () => {
    if (!validate()) return;

    const competitorUrls = domainForm.competitors.filter((c) => c.trim()).join("\n");

    const hasEditableList = editablePages.length > 0;
    const explicitUrls = hasEditableList && selectedPages.length > 0 ? selectedPages : null;

    startAnalysis.mutate(
      {
        data: {
          mode: "url",
          url: normalizeUrl(domainForm.url),
          questionnaire: {
            companyName: domainForm.companyName.trim() || null,
            competitors: competitorUrls || null,
            buyerPersonas: domainForm.personas.trim() || null,
          },
          explicitUrls,
        },
      },
      {
        onSuccess: (result) => {
          setAnalysisId(result.id);
          setAnalysisStatus("running");
          setActiveView(3);
        },
        onError: () => {
          setAnalysisStatus("failed");
        },
      },
    );
  };

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("nav.domain_analyse")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("domain.subtitle")}</p>
      </div>

      {/* Section: Unternehmen & Website */}
      <section className="space-y-4">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
          {t("domain.section_company")}
        </h2>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="companyName">{t("domain.label_company")}</Label>
            <Tooltip text={t("domain.tooltip_company")} />
          </div>
          <Input
            id="companyName"
            value={domainForm.companyName}
            onChange={(e) => updateField("companyName", e.target.value)}
            placeholder={t("welcome.placeholder_company")}
            data-testid="input-company-name"
          />
          {errors.companyName && (
            <p className="text-xs text-destructive">{errors.companyName}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="websiteUrl">{t("domain.label_url")}</Label>
            <Tooltip text={t("domain.tooltip_url")} />
          </div>
          <Input
            id="websiteUrl"
            type="url"
            value={domainForm.url}
            onChange={(e) => updateField("url", e.target.value)}
            onBlur={(e) => updateField("url", normalizeUrl(e.target.value))}
            placeholder={t("welcome.placeholder_url")}
            data-testid="input-url"
          />
          {errors.url && (
            <p className="text-xs text-destructive">{errors.url}</p>
          )}
        </div>

        {/* AI Pre-fill button — MODE A only */}
        {!phase2Visible && (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full border-primary/40 text-primary hover:bg-primary/5 hover:border-primary transition-colors"
              onClick={handlePrefill}
              disabled={prefillMutation.isPending}
              data-testid="button-ai-prefill"
            >
              {prefillMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t("domain.prefill_pending")}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  {t("domain.btn_prefill")}
                </>
              )}
            </Button>
            <p className="text-xs text-center text-muted-foreground">
              {t("domain.prefill_hint")}{" "}
              <button
                type="button"
                onClick={handleRevealManually}
                className="underline hover:text-foreground transition-colors"
                data-testid="button-manual-fill"
              >
                {t("domain.prefill_manual")}
              </button>
            </p>
          </div>
        )}

        {/* Switch back to KI mode — MODE B only */}
        {phase2Visible && (
          <p className="text-xs text-center text-muted-foreground">
            <button
              type="button"
              onClick={() => setPhase2Visible(false)}
              className="underline hover:text-foreground transition-colors"
              data-testid="button-switch-to-ai"
            >
              {t("domain.btn_switch_to_ai")}
            </button>
          </p>
        )}

        {/* Crawled pages selection */}
        {editablePages.length > 0 && (
          <div
            className="rounded-lg border border-border p-4 space-y-3"
            style={{ background: "hsl(var(--muted) / 0.3)" }}
          >
            <div>
              <p className="text-sm font-semibold">{t("domain.pages_title")}</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                {t("domain.pages_desc")}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {t("domain.pages_count", { selected: selectedPages.length, total: editablePages.length })}
              </span>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline font-medium"
              >
                {allSelected ? t("domain.pages_deselect_all") : t("domain.pages_select_all")}
              </button>
            </div>

            <div className="space-y-1 max-h-80 overflow-y-auto pr-1">
              {visiblePages.map((url, idx) => {
                const isEditing = editingIndex === idx;

                return (
                  <div
                    key={`${url}-${idx}`}
                    className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-muted/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedPages.includes(url)}
                      onChange={() => !isEditing && togglePage(url)}
                      className="mt-0.5 shrink-0 accent-primary"
                    />

                    {isEditing ? (
                      <div className="flex-1 flex items-center gap-1.5">
                        <input
                          ref={editInputRef}
                          type="url"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") confirmEdit();
                            if (e.key === "Escape") cancelEdit();
                          }}
                          className="flex-1 text-xs bg-background border border-border rounded px-2 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          type="button"
                          onClick={confirmEdit}
                          className="shrink-0 p-0.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-950 transition-colors"
                          aria-label={t("domain.aria_confirm")}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          aria-label={t("domain.aria_cancel")}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-start gap-1.5 min-w-0">
                        <span
                          className="flex-1 break-all text-foreground/80 leading-tight cursor-default"
                          style={{ fontFamily: "ui-monospace, monospace", fontSize: "0.75rem" }}
                        >
                          {url}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEdit(idx)}
                          className="shrink-0 mt-0.5 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
                          aria-label={t("domain.aria_edit_url")}
                          style={{ opacity: 0.5 }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {addingNew && (
                <div className="flex items-center gap-2 py-1.5 px-2 rounded bg-muted/30">
                  <input
                    type="checkbox"
                    checked
                    readOnly
                    className="mt-0.5 shrink-0 accent-primary opacity-50"
                  />
                  <div className="flex-1 flex items-center gap-1.5">
                    <input
                      ref={newUrlInputRef}
                      type="url"
                      value={newUrlValue}
                      onChange={(e) => setNewUrlValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmAddNew();
                        if (e.key === "Escape") cancelAddNew();
                      }}
                      placeholder="https://www.beispiel.de/seite"
                      className="flex-1 text-xs bg-background border border-border rounded px-2 py-0.5 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={confirmAddNew}
                      className="shrink-0 p-0.5 rounded text-green-600 hover:bg-green-50 dark:hover:bg-green-950 transition-colors"
                      aria-label={t("domain.pages_add_url")}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelAddNew}
                      className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      aria-label={t("domain.aria_cancel")}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {editablePages.length > MAX_VISIBLE_PAGES && (
              <button
                type="button"
                onClick={() => setShowAllPages((v) => !v)}
                className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
              >
                {showAllPages ? (
                  <>
                    <ChevronUp className="w-3 h-3" />
                    {t("domain.pages_show_less")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3 h-3" />
                    {t("domain.pages_show_more", { n: editablePages.length - MAX_VISIBLE_PAGES })}
                  </>
                )}
              </button>
            )}

            {!addingNew && (
              <button
                type="button"
                onClick={() => setAddingNew(true)}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("domain.pages_add_url")}
              </button>
            )}
          </div>
        )}
      </section>

      {/* Phase 2: Competitors + Personas */}
      {phase2Visible && (
        <div ref={phase2Ref} className="space-y-8">

          {prefillError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              {prefillError}
            </div>
          )}

          {prefillMutation.isSuccess && !prefillError && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 space-y-3">
              <div className="flex items-start gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                <p className="text-xs text-primary/90 leading-relaxed">
                  {t("domain.prefill_success")}
                </p>
              </div>

              {prefillMutation.data?.crawl_failed && (
                <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed pl-5">
                  {t(
                    prefillMutation.data.crawl_fail_reason === "tls_chain" ? "domain.prefill_crawl_failed_tls_chain" :
                    prefillMutation.data.crawl_fail_reason === "tls_other" ? "domain.prefill_crawl_failed_tls_other" :
                    prefillMutation.data.crawl_fail_reason === "dns"       ? "domain.prefill_crawl_failed_dns"       :
                    prefillMutation.data.crawl_fail_reason === "refused"   ? "domain.prefill_crawl_failed_refused"   :
                    prefillMutation.data.crawl_fail_reason === "timeout"   ? "domain.prefill_crawl_failed_timeout"   :
                    "domain.prefill_crawl_failed"
                  )}
                </p>
              )}

              {prefillMutation.data?.content_summary && (
                <div className="border-t border-primary/20 pt-3 pl-5 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("domain.prefill_products_label")}
                  </p>
                  <p className="text-xs text-foreground/70 leading-relaxed">
                    {prefillMutation.data.content_summary}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Section: Wettbewerber */}
          <section className="space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-1 flex items-center gap-1.5">
              {t("domain.section_competitors")}
              <Tooltip text={t("domain.tooltip_competitors")} />
            </h2>

            <div className="space-y-2">
              {domainForm.competitors.map((comp, i) => {
                const isValidUrl = comp.startsWith("http://") || comp.startsWith("https://");
                return (
                  <div key={i} className="flex gap-2 items-center">
                    <a
                      href={isValidUrl ? comp : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("domain.aria_open_website")}
                      tabIndex={isValidUrl ? 0 : -1}
                      className="shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                      style={{
                        opacity: isValidUrl ? 1 : 0.3,
                        pointerEvents: isValidUrl ? "auto" : "none",
                        cursor: isValidUrl ? "pointer" : "default",
                      }}
                    >
                      <Globe style={{ width: 18, height: 18 }} />
                    </a>
                    <Input
                      type="url"
                      value={comp}
                      onChange={(e) => updateCompetitor(i, e.target.value)}
                      onBlur={(e) => updateCompetitor(i, normalizeUrl(e.target.value))}
                      placeholder={t("domain.placeholder_competitor")}
                      data-testid={`input-competitor-${i}`}
                    />
                    {comp in competitorVerified && (
                      competitorVerified[comp] ? (
                        <CheckCircle2
                          className="shrink-0 w-4 h-4 text-green-500"
                          aria-label={t("domain.aria_url_verified")}
                        />
                      ) : (
                        <span
                          title={t("domain.tooltip_url_unverified")}
                          className="shrink-0 flex items-center"
                        >
                          <AlertTriangle className="w-4 h-4 text-amber-500" aria-label={t("domain.aria_url_unverified")} />
                        </span>
                      )
                    )}
                    {domainForm.competitors.length > 1 && (
                      <button
                        onClick={() => removeCompetitor(i)}
                        className="shrink-0 w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        aria-label={t("domain.aria_remove")}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
              {domainForm.competitors.length < 10 && domainForm.competitors.every((c) => c.trim() !== "") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDomainForm({ ...domainForm, competitors: [...domainForm.competitors, ""] })}
                  className="text-muted-foreground text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {t("domain.btn_add_competitor")}
                </Button>
              )}
            </div>
          </section>

          {/* Section: Zielgruppen */}
          <section className="space-y-4">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-1 flex items-center gap-1.5">
              {t("domain.section_personas")}
              <Tooltip text={t("domain.tooltip_personas")} />
            </h2>

            <Textarea
              value={domainForm.personas}
              onChange={(e) => updateField("personas", e.target.value)}
              placeholder={t("domain.placeholder_personas")}
              className="min-h-[96px]"
              data-testid="input-personas"
            />
          </section>

          {/* CTA */}
          <Button
            size="lg"
            className="w-full"
            onClick={handleStart}
            disabled={startAnalysis.isPending}
            data-testid="button-start-analysis"
          >
            {startAnalysis.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            {t("html.btn_start")}
          </Button>
        </div>
      )}
    </div>
  );
}
