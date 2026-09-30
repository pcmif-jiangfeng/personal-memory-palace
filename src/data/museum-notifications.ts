import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { readString } from "./row-readers.ts";

export const museumNotificationSchemaSql = `
CREATE TABLE IF NOT EXISTS museum_notifications (
  id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL,
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(event_key,recipient_user_id)
);
CREATE INDEX IF NOT EXISTS museum_notifications_pending
  ON museum_notifications(status,next_attempt_at,lease_until);
`;

// Called inside the business transaction: an event and its notifications cannot diverge.
export function queueMuseumNotificationInDatabase(
  db: DatabaseSync,
  input: {
    eventKey: string;
    museumId: string;
    recipients: string[];
    kind: string;
    subject: string;
    body: string;
  },
) {
  if (!db.isTransaction) throw new Error("Museum notification requires a transaction");
  const now = new Date().toISOString();
  for (const userId of new Set(input.recipients)) {
    const user = db.prepare("SELECT email FROM users WHERE id=? AND email_verified=1").get(userId);
    if (!user) continue;
    db.prepare(`INSERT INTO museum_notifications
      (id,event_key,museum_id,recipient_user_id,recipient_email,kind,subject,body,next_attempt_at,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_key,recipient_user_id) DO NOTHING`)
      .run(randomUUID(), input.eventKey, input.museumId, userId, readString(user, "email"),
        input.kind, input.subject, input.body, now, now);
  }
}

export function queueCollaborationNotificationInDatabase(
  db: DatabaseSync,
  eventKey: string,
  museumId: string,
  kind: "join" | "leave" | "removed" | "ownerTransfer",
  affectedUserId: string,
  previousOwnerId?: string,
) {
  const museum = db.prepare("SELECT owner_id,name FROM museums WHERE id=?").get(museumId)!;
  const affected = db.prepare("SELECT display_name FROM users WHERE id=?").get(affectedUserId)!;
  const descriptions = {
    join: "已加入博物馆协作",
    leave: "已退出博物馆协作",
    removed: "已被移出博物馆协作",
    ownerTransfer: "已成为博物馆的新馆主",
  };
  queueMuseumNotificationInDatabase(db, {
    eventKey, museumId, kind: `collaboration.${kind}`,
    recipients: [readString(museum, "owner_id"), affectedUserId, ...(previousOwnerId ? [previousOwnerId] : [])],
    subject: `个人记忆宫殿：${descriptions[kind]}`,
    body: `博物馆「${readString(museum, "name")}」：${readString(affected, "display_name")}${descriptions[kind]}。\n这是已完成操作的通知，不包含私人展览内容。请登录网站查看当前权限。`,
  });
}
