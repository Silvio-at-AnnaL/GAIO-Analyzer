import pg from "pg";
import { logger } from "./logger.js";
import { resolveDatabaseConfig } from "./bootstrap.js";

export const databaseConfig = (() => {
  try {
    return resolveDatabaseConfig();
  } catch {
    logger.fatal("No explicit database connection configured: set DATABASE_URL or server/bootstrap.json database_url. Exiting.");
    process.exit(1);
  }
})();

// Return timestamp columns as strings (not Date objects) so all existing
// string-based comparisons and .slice() calls keep working unchanged.
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP,  (v: string) => v);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v: string) => v);
pg.types.setTypeParser(pg.types.builtins.DATE,        (v: string) => v);

const pool = new pg.Pool({
  connectionString: databaseConfig.url,
  ssl: databaseConfig.url
    ? { rejectUnauthorized: false }
    : undefined,
  max: 10,
  idleTimeoutMillis:    30_000,
  connectionTimeoutMillis: 8_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "Unexpected PostgreSQL pool error");
});

export async function connectWithRetry(
  connect: () => Promise<pg.PoolClient>,
  delayMs = 500,
): Promise<pg.PoolClient> {
  const startedAt = Date.now();
  try {
    return await connect();
  } catch (err) {
    logger.warn(
      { reason: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startedAt },
      "PostgreSQL connect failed — retrying once",
    );
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    return connect();
  }
}

export async function runQuery<T = Record<string, any>>(
  connect: () => Promise<pg.PoolClient>,
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const client = await connectWithRetry(connect);
  try {
    const result = await client.query(text, params);
    client.release();
    return { rows: result.rows as T[], rowCount: result.rowCount };
  } catch (err) {
    client.release(err as Error);
    throw err;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query<T = Record<string, any>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  return runQuery<T>(() => pool.connect(), text, params);
}

export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connectWithRetry(() => pool.connect());
  let releaseError: Error | undefined;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      logger.error({ err: rollbackError }, "Transaction rollback failed");
    }
    throw err;
  } finally {
    client.release(releaseError);
  }
}

export { pool };
