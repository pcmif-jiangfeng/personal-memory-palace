import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { withTransaction } from "./transaction.ts";

const tokenLifetimeMs = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createEmailVerificationTokenInDatabase(
  database: DatabaseSync,
  userId: string,
  now = new Date(),
): string {
  const token = randomBytes(32).toString("base64url");
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + tokenLifetimeMs).toISOString();

  withTransaction(database, () => {
    const user = database.prepare("SELECT email_verified FROM users WHERE id = ?").get(userId);
    if (!user || user.email_verified !== 0) {
      throw new Error("User unavailable for email verification");
    }
    database.prepare(`
      INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        created_at = excluded.created_at
    `).run(userId, hashToken(token), expiresAt, createdAt);
  });

  return token;
}

export function verifyEmailVerificationTokenInDatabase(
  database: DatabaseSync,
  token: string,
  now = new Date(),
): boolean {
  const verifiedAt = now.toISOString();
  return withTransaction(database, () => {
    const row = database.prepare(`
      DELETE FROM email_verification_tokens
      WHERE token_hash = ? AND expires_at > ?
      RETURNING user_id
    `).get(hashToken(token), verifiedAt);
    if (!row) return false;
    const result = database.prepare(`
      UPDATE users SET email_verified = 1, updated_at = ?
      WHERE id = ? AND email_verified = 0
    `).run(verifiedAt, row.user_id);
    return result.changes === 1;
  });
}
