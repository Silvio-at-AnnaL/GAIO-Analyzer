import { randomBytes } from "node:crypto";
import { query } from "./db.js";
import { setSessionSigningSecret } from "./admin-auth.js";

export async function initializeSessionSigningSecret(): Promise<void> {
  const key = "session_signing_secret";
  let result = await query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  if (!result.rows[0]) {
    const candidate = process.env.ADMIN_JWT_SECRET ?? process.env.SESSION_SECRET
      ?? randomBytes(64).toString("hex");
    await query(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [key, candidate],
    );
    // A competing instance may have inserted a different candidate. Always use the stored winner.
    result = await query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  }
  const stored = result.rows[0]?.value;
  if (!stored) throw new Error("Stored session signing secret is missing or empty");
  setSessionSigningSecret(stored);
}
