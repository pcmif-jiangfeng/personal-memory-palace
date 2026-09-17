import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { getOwnerPassword, getSessionSecret } from "../config.ts";

export const ownerSessionLifetimeSeconds = 60 * 60 * 24 * 30;
const ownerPasswordSalt = "personal-memory-palace-owner-v1";

function derivePassword(value: string): Buffer {
  return scryptSync(value, ownerPasswordSalt, 32);
}

function passwordVersion(): string {
  const password = getOwnerPassword();
  if (!password) return "unconfigured";
  return createHmac("sha256", getSessionSecret()).update(password).digest("base64url").slice(0, 16);
}

function signSession(payload: string): string {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function ownerPasswordConfigured(): boolean {
  return Boolean(getOwnerPassword());
}

export function isOwnerPasswordValid(password: string): boolean {
  const configured = getOwnerPassword();
  if (!configured) return false;
  return timingSafeEqual(derivePassword(password), derivePassword(configured));
}

export function createOwnerSessionToken(now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + ownerSessionLifetimeSeconds;
  const payload = `v1.${expiresAt}.${passwordVersion()}`;
  return `${payload}.${signSession(payload)}`;
}

export function verifyOwnerSessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  if (!constantTimeEqual(parts[2], passwordVersion())) return false;
  const payload = parts.slice(0, 3).join(".");
  return constantTimeEqual(parts[3], signSession(payload));
}
