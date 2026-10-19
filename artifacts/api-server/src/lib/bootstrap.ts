import { readFileSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger.js";

interface BootstrapConfig {
  database_url?: string;
  [key: string]: unknown;
}

function getBootstrapConfig(): BootstrapConfig {
  const filePath = path.join(process.cwd(), "server", "bootstrap.json");
  try {
    const config: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error("Invalid bootstrap object");
    }
    return config as BootstrapConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("Bootstrap configuration is unreadable or invalid; ignoring file");
    }
    return {};
  }
}

export interface DatabaseConfig {
  url: string;
  source: "env" | "file";
}

export function resolveDatabaseConfig(): DatabaseConfig {
  // Priority 1: Explicit DATABASE_URL secret
  // (set in Replit Secrets → always Neon)
  if (process.env.DATABASE_URL?.trim()) {
    return { url: process.env.DATABASE_URL.trim(), source: "env" };
  }

  // Priority 2: bootstrap.json
  const cfg = getBootstrapConfig();
  if (typeof cfg.database_url === "string" && cfg.database_url.trim()) {
    return { url: cfg.database_url.trim(), source: "file" };
  }

  // No database configured → fail loudly.
  // Never fall back to a hardcoded DB or to PGHOST/PGUSER/etc.
  throw new Error(
    "DATABASE_URL is not set (and no bootstrap.json database_url). " +
    "Refusing to start without an explicit connection string."
  );
}
