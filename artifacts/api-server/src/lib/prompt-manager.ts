import { db } from "./admin-db.js";
import { PROMPT_DEFAULTS_MAP } from "./prompt-defaults.js";

const cache = new Map<string, string>();

export function getPrompt(slug: string): string {
  if (cache.has(slug)) return cache.get(slug)!;

  const row = db.prepare("SELECT template FROM prompts WHERE slug = ?").get(slug) as
    | { template: string }
    | undefined;

  const template = row?.template ?? PROMPT_DEFAULTS_MAP.get(slug)?.template ?? "";
  if (!template) throw new Error(`Prompt nicht gefunden: ${slug}`);

  cache.set(slug, template);
  return template;
}

export function clearPromptCache(slug?: string): void {
  if (slug) cache.delete(slug);
  else cache.clear();
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [key, val]) => t.replaceAll(`{{${key}}}`, val),
    template,
  );
}
