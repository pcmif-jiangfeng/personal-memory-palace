import { randomBytes, scryptSync } from "node:crypto";

export function hashUserPassword(password: string): string {
  const salt = randomBytes(16);
  const digest = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}
