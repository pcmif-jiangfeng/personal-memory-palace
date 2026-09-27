import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashUserPassword } from "../security/user-password.ts";
import { withTransaction } from "./transaction.ts";

const tokenLifetimeMs = 60 * 60 * 1000;
const resendCooldownMs = 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requestPasswordResetInDatabase(
  database: DatabaseSync,
  email: string,
  send: (email: string, token: string) => Promise<void>,
  now = new Date(),
): Promise<void> {
  const user = database.prepare("SELECT id, email FROM users WHERE email = ?").get(email) as
    | { id: string; email: string }
    | undefined;
  if (!user) return;

  const token = randomBytes(32).toString("base64url");
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + tokenLifetimeMs).toISOString();
  const cutoff = new Date(now.getTime() - resendCooldownMs).toISOString();
  const result = database.prepare(`
    INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      token_hash = excluded.token_hash,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
    WHERE password_reset_tokens.created_at <= ?
  `).run(user.id, hashToken(token), expiresAt, issuedAt, cutoff);
  if (result.changes === 0) return;
  await send(user.email, token);
}

export function resetPasswordInDatabase(
  database: DatabaseSync,
  token: string,
  newPassword: string,
  now = new Date(),
): boolean {
  const passwordHash = hashUserPassword(newPassword);
  const updatedAt = now.toISOString();
  return withTransaction(database, () => {
    const row = database.prepare(`
      DELETE FROM password_reset_tokens
      WHERE token_hash = ? AND expires_at > ?
      RETURNING user_id
    `).get(hashToken(token), updatedAt) as { user_id: string } | undefined;
    if (!row) return false;
    const updated = database.prepare(`
      UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
    `).run(passwordHash, updatedAt, row.user_id);
    if (updated.changes !== 1) throw new Error("Password reset User disappeared");
    database.prepare("DELETE FROM user_sessions WHERE user_id = ?").run(row.user_id);
    return true;
  });
}
