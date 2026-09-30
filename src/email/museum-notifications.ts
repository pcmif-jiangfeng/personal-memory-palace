import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readNumber, readString } from "../data/row-readers.ts";
import {
  getEmailConfiguration,
  sendTransactionalEmail,
  type EmailConfiguration,
} from "./transactional-email.ts";
import { ApiError } from "../http/errors.ts";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

export async function deliverMuseumNotifications(
  db: DatabaseSync,
  options: {
    museumId?: string;
    limit?: number;
    now?: Date;
    configuration?: EmailConfiguration;
    fetcher?: typeof fetch;
  } = {},
) {
  if (db.isTransaction) throw new Error("Email delivery must happen after commit");
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new TypeError("Invalid notification batch size");
  let configuration: EmailConfiguration;
  try {
    configuration = options.configuration ?? getEmailConfiguration();
  } catch (error) {
    if (error instanceof ApiError && error.code === "EMAIL_NOT_CONFIGURED")
      return { sent: 0, failed: 0, configured: false };
    throw error;
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid notification time");
  const rows = db
    .prepare(
      `SELECT * FROM museum_notifications WHERE status='pending'
    AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)
    AND (? IS NULL OR museum_id=?) ORDER BY created_at,id LIMIT ?`,
    )
    .all(
      now.toISOString(),
      now.toISOString(),
      options.museumId ?? null,
      options.museumId ?? null,
      limit,
    );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const id = readString(row, "id");
    const lease = randomUUID();
    const claimedAt = options.now ?? new Date();
    const claimed = db
      .prepare(
        `UPDATE museum_notifications SET lease_token=?,lease_until=?,attempts=attempts+1
      WHERE id=? AND status='pending' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)`,
      )
      .run(
        lease,
        new Date(claimedAt.getTime() + 120000).toISOString(),
        id,
        claimedAt.toISOString(),
        claimedAt.toISOString(),
      );
    if (!claimed.changes) continue;
    try {
      const body = readString(row, "body");
      await sendTransactionalEmail(
        {
          to: readString(row, "recipient_email"),
          subject: readString(row, "subject"),
          text: body,
          html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
        },
        configuration,
        (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Idempotency-Key", `museum-notification/${id}`);
          return (options.fetcher ?? fetch)(url, { ...init, headers });
        },
      );
      db.prepare(
        `UPDATE museum_notifications SET status='sent',sent_at=?,lease_token=NULL,lease_until=NULL
        WHERE id=? AND lease_token=? AND status='pending'`,
      ).run(new Date().toISOString(), id, lease);
      sent++;
    } catch {
      const retryDelay = Math.min(60, 2 ** Math.min(readNumber(row, "attempts"), 5)) * 60000;
      db.prepare(
        `UPDATE museum_notifications SET next_attempt_at=?,lease_token=NULL,lease_until=NULL
        WHERE id=? AND lease_token=? AND status='pending'`,
      ).run(new Date(now.getTime() + retryDelay).toISOString(), id, lease);
      failed++;
    }
  }
  return { sent, failed, configured: true };
}
