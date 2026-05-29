import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { logger } from "./logger.js";

function resolveJwtSecret(): string {
  const env = process.env.ADMIN_JWT_SECRET ?? process.env.SESSION_SECRET;
  if (env) return env;
  const generated = randomBytes(64).toString("hex");
  logger.warn("Neither ADMIN_JWT_SECRET nor SESSION_SECRET is set — using ephemeral JWT secret. Sessions will not survive restarts.");
  return generated;
}

const JWT_SECRET = resolveJwtSecret();

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "8h" });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (password.length < 10)              errors.push("Mindestens 10 Zeichen erforderlich");
  if (!/[A-Z]/.test(password))           errors.push("Mindestens ein Großbuchstabe (A–Z) erforderlich");
  if (!/[a-z]/.test(password))           errors.push("Mindestens ein Kleinbuchstabe (a–z) erforderlich");
  if (!/[0-9]/.test(password))           errors.push("Mindestens eine Ziffer (0–9) erforderlich");
  if (!/[!@#$%^&*()\-_=+\[\]{}|;':",.<>?/~`]/.test(password))
    errors.push("Mindestens ein Sonderzeichen erforderlich");
  return { valid: errors.length === 0, errors };
}

export function generateTempPassword(): string {
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower   = "abcdefghjkmnpqrstuvwxyz";
  const digits  = "23456789";
  const special = "!@#$%&*-_=+?";
  const all     = upper + lower + digits + special;
  const arr: string[] = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    special[Math.floor(Math.random() * special.length)],
    ...Array.from({ length: 8 }, () => all[Math.floor(Math.random() * all.length)]),
  ];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join("");
}
