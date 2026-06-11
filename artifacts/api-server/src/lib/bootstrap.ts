import { readFileSync } from "node:fs";
import path from "node:path";

interface BootstrapConfig {
  database_url?: string;
  [key: string]: unknown;
}

let _cache: BootstrapConfig | null = null;

export function getBootstrapConfig(): BootstrapConfig {
  if (_cache) return _cache;
  const filePath = path.join(process.cwd(), "server", "bootstrap.json");
  try {
    _cache = JSON.parse(readFileSync(filePath, "utf8")) as BootstrapConfig;
  } catch {
    _cache = {};
  }
  return _cache;
}

export function getDatabaseUrl(): string {
  // Priority 1: Explicit DATABASE_URL secret
  // (set in Replit Secrets → always Neon)
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  // Priority 2: bootstrap.json
  const cfg = getBootstrapConfig();
  if (cfg.database_url?.trim()) {
    return cfg.database_url.trim();
  }

  // No database configured → fail loudly.
  // Never fall back to a hardcoded DB or to PGHOST/PGUSER/etc.
  throw new Error(
    "DATABASE_URL is not set (and no bootstrap.json database_url). " +
    "Refusing to start without an explicit connection string."
  );
}
