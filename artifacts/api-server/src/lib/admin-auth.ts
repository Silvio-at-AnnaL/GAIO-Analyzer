import jwt from "jsonwebtoken";
let signingSecret: string | null = null;

export class SessionSecretNotReadyError extends Error {
  constructor() {
    super("Session signing secret has not been initialized");
    this.name = "SessionSecretNotReadyError";
  }
}

export function setSessionSigningSecret(secret: string): void {
  if (!secret) throw new SessionSecretNotReadyError();
  signingSecret = secret;
}

export function isSessionSigningReady(): boolean {
  return signingSecret !== null;
}

export interface JwtPayload {
  userId: number;
  username: string;
  role: string;
}

export function signToken(payload: JwtPayload): string {
  if (!signingSecret) throw new SessionSecretNotReadyError();
  return jwt.sign(payload, signingSecret, { expiresIn: "8h" });
}

export function verifyToken(token: string): JwtPayload | null {
  if (!signingSecret) return null;
  try {
    return jwt.verify(token, signingSecret) as JwtPayload;
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
