import type { DatabaseSync } from "node:sqlite";
import { createEmailVerificationTokenInDatabase } from "../data/email-verification.ts";

const resendCooldownMs = 60_000;

export async function resendVerificationEmail(
  database: DatabaseSync,
  email: string,
  send: (email: string, token: string) => Promise<void>,
  now = new Date(),
): Promise<void> {
  const row = database
    .prepare(
      `
    SELECT users.id, users.email, tokens.created_at
    FROM users
    LEFT JOIN email_verification_tokens AS tokens ON tokens.user_id = users.id
    WHERE users.email = ? AND users.email_verified = 0
  `,
    )
    .get(email) as { id: string; email: string; created_at: string | null } | undefined;
  if (!row) return;
  if (row.created_at && now.getTime() - Date.parse(row.created_at) < resendCooldownMs) return;
  const token = createEmailVerificationTokenInDatabase(database, row.id, now);
  await send(row.email, token);
}
