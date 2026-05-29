import pg from "pg";
import { logger } from "./logger.js";

// Return timestamp columns as strings (not Date objects) so all existing
// string-based comparisons and .slice() calls keep working unchanged.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP,  (v: string) => v);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v: string) => v);
pg.types.setTypeParser(pg.types.builtins.DATE,        (v: string) => v);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 8_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL pool error");
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = Record<string, any>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount };
}

export { pool };
