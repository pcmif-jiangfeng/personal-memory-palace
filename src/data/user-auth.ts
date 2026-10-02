import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { findUserByIdInDatabase, type User } from "./user-repository.ts";

export const userSessionLifetimeSeconds = 7 * 24 * 60 * 60;

type PublicUser = Pick<User, "id" | "email" | "displayName" | "emailVerified">;
type LoginResult =
  | { status: "invalid" }
  | { status: "unverified" | "authenticated"; user: PublicUser; sessionToken: string };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function passwordMatches(password: string, encoded: string): boolean {
  const [scheme, saltText, digestText] = encoded.split("$");
  if (scheme !== "scrypt" || !saltText || !digestText) return false;
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(digestText, "base64url");
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = scryptSync(password, salt, 32);
  return timingSafeEqual(actual, expected);
}

export function loginUserInDatabase(
  database: DatabaseSync,
  email: string,
  password: string,
  now = new Date(),
): LoginResult {
  const row = database.prepare("SELECT id FROM users WHERE email = ?").get(email.trim().toLowerCase()) as
    | { id: string }
    | undefined;
  const user = row ? findUserByIdInDatabase(database, row.id) : null;
  if (!user) {
    scryptSync(password, Buffer.alloc(16), 32);
    return { status: "invalid" };
  }
  if (!passwordMatches(password, user.passwordHash)) return { status: "invalid" };

  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + userSessionLifetimeSeconds * 1000).toISOString();
  database.prepare(`
    INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(sessionToken), user.id, expiresAt, now.toISOString());
  return {
    status: user.emailVerified ? "authenticated" : "unverified",
    sessionToken,
    user: { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerified },
  };
}

export function findSessionUserInDatabase(
  database: DatabaseSync,
  sessionToken: string | undefined,
  now = new Date(),
): PublicUser | null {
  if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return null;
  const row = database.prepare(`
    SELECT users.id FROM user_sessions
    JOIN users ON users.id = user_sessions.user_id
    WHERE user_sessions.token_hash = ? AND user_sessions.expires_at > ?
  `).get(hashToken(sessionToken), now.toISOString()) as { id: string } | undefined;
  if (!row) return null;
  const user = findUserByIdInDatabase(database, row.id);
  return user ? { id: user.id, email: user.email, displayName: user.displayName, emailVerified: user.emailVerified } : null;
}

export function findUserBySessionInDatabase(database: DatabaseSync, token: string | undefined, now = new Date()): PublicUser | null {
  const user = findSessionUserInDatabase(database, token, now);
  return user?.emailVerified ? user : null;
}

export function revokeUserSessionInDatabase(
  database: DatabaseSync,
  sessionToken: string | undefined,
): void {
  if (!sessionToken || !/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return;
  database.prepare("DELETE FROM user_sessions WHERE token_hash = ?").run(hashToken(sessionToken));
}
