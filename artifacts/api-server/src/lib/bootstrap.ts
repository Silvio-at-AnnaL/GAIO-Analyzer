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

  // Priority 3: Hardcoded Neon fallback
  // (never use Replit's PGHOST etc.)
  return "postgresql://neondb_owner:" +
    "npg_Mh5PlR3gkfyz@ep-steep-night-" +
    "alx00u4h.c-3.eu-central-1.aws." +
    "neon.tech/neondb?sslmode=require";
}
