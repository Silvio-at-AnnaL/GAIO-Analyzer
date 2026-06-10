import app from "./app";
import { logger } from "./lib/logger";
import { initializeDatabase } from "./lib/admin-db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

async function initWithRetry(attempt = 1): Promise<void> {
  try {
    await initializeDatabase();
    logger.info("Database initialized successfully");
  } catch (err: unknown) {
    logger.error({ err, attempt }, "Failed to initialize database");
    if (attempt < MAX_RETRIES) {
      logger.info({ attempt, nextIn: RETRY_DELAY_MS }, "Retrying database initialization");
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return initWithRetry(attempt + 1);
    }
    logger.error("Database initialization failed after all retries — server will remain running but DB-dependent routes will fail");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  void initWithRetry();
});
