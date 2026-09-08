import { getSetting, setSetting } from "./admin-db.js";

// Each tunable score registers a profile: a flat set of numeric params with defaults.
export interface ScoreParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
  help: string;
}

export interface ScoreProfile {
  slug: string;
  label: string;
  params: ScoreParamDef[];
}

export const SCORE_PROFILES: ScoreProfile[] = [
  {
    slug: "schema-org",
    label: "score.profile_schema_org",
    params: [
      { key: "breadth_saturation", label: "score.param_breadth_saturation_label", default: 14, min: 4, max: 30, step: 1, help: "score.param_breadth_saturation_help" },
      { key: "substance_saturation", label: "score.param_substance_saturation_label", default: 14, min: 4, max: 30, step: 1, help: "score.param_substance_saturation_help" },
      { key: "substance_k", label: "score.param_substance_k_label", default: 0.5, min: 0.1, max: 1.5, step: 0.05, help: "score.param_substance_k_help" },
      { key: "malus_per_hard_error", label: "score.param_malus_per_hard_error_label", default: 0.20, min: 0, max: 0.5, step: 0.05, help: "score.param_malus_per_hard_error_help" },
      { key: "malus_floor", label: "score.param_malus_floor_label", default: 0.40, min: 0.1, max: 1, step: 0.05, help: "score.param_malus_floor_help" },
    ],
  },
];

const cache = new Map<string, number>();

function settingKey(slug: string, key: string): string {
  return `score_param:${slug}:${key}`;
}

export async function getScoreParams(slug: string): Promise<Record<string, number>> {
  const profile = SCORE_PROFILES.find((p) => p.slug === slug);
  if (!profile) throw new Error(`Unbekanntes Score-Profil: ${slug}`);

  const out: Record<string, number> = {};
  for (const def of profile.params) {
    const ck = settingKey(slug, def.key);
    if (cache.has(ck)) {
      out[def.key] = cache.get(ck)!;
      continue;
    }
    const raw = await getSetting(ck);
    const val = raw !== null && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : def.default;
    cache.set(ck, val);
    out[def.key] = val;
  }
  return out;
}

export async function setScoreParam(slug: string, key: string, value: number): Promise<void> {
  const profile = SCORE_PROFILES.find((p) => p.slug === slug);
  const def = profile?.params.find((d) => d.key === key);
  if (!def) throw new Error(`Unbekannter Score-Parameter: ${slug}/${key}`);

  const clamped = Math.max(def.min, Math.min(def.max, value));
  await setSetting(settingKey(slug, key), String(clamped));
  cache.delete(settingKey(slug, key));
}

export async function resetScoreParams(slug: string): Promise<void> {
  const profile = SCORE_PROFILES.find((p) => p.slug === slug);
  if (!profile) return;

  for (const def of profile.params) {
    await setSetting(settingKey(slug, def.key), "");
    cache.delete(settingKey(slug, def.key));
  }
}