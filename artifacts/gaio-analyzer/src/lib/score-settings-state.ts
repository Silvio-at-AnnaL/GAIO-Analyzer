export const SCORE_SETTINGS_OPEN_KEY = "gaio.scoreSettings.open";

function readPreferences(): Record<string, unknown> {
  const raw = localStorage.getItem(SCORE_SETTINGS_OPEN_KEY);
  try {
    const value: unknown = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readScoreSettingsOpen(viewerId: number | undefined): string[] {
  if (viewerId === undefined) return [];
  try {
    const value = readPreferences()[String(viewerId)];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function writeScoreSettingsOpen(viewerId: number | undefined, items: string[]): void {
  if (viewerId === undefined) return;
  try {
    localStorage.setItem(SCORE_SETTINGS_OPEN_KEY, JSON.stringify({
      ...readPreferences(), [String(viewerId)]: items,
    }));
  } catch {
    // Storage can be disabled; the accordion still works in memory.
  }
}
