import type { DatabaseSync } from "node:sqlite";
import { queueMuseumNotificationInDatabase } from "./museum-notifications.ts";
import { readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export function queueMuseumDeletionNotificationInDatabase(
  db: DatabaseSync, eventKey: string, museumId: string,
  kind: "initiated" | "approachingExpiry" | "cancelled", deadline: string | null,
) {
  const museum = db.prepare("SELECT owner_id,name FROM museums WHERE id=?").get(museumId)!;
  const descriptions = {
    initiated: "博物馆已进入 30 天待删除期",
    approachingExpiry: "博物馆待删除期将在 3 天内结束",
    cancelled: "博物馆删除计划已取消",
  };
  queueMuseumNotificationInDatabase(db, {
    eventKey, museumId, kind: `deletion.${kind}`, recipients: [readString(museum, "owner_id")],
    subject: `个人记忆宫殿：${descriptions[kind]}`,
    body: `博物馆「${readString(museum, "name")}」：${descriptions[kind]}。\n${kind === "cancelled" ? "博物馆已恢复正常状态。" : `计划截止时间：${deadline}。你可以在截止前登录网站取消删除。`}\n此邮件任务不会删除博物馆或照片。`,
  });
}

// Bounded maintenance pass; each deletion cycle receives at most one reminder.
export function queueDueMuseumDeletionReminders(db: DatabaseSync, now = new Date(), limit = 100) {
  if (!Number.isFinite(now.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 1000)
    throw new TypeError("Invalid deletion reminder window");
  return withTransaction(db, () => {
    db.prepare(`UPDATE museum_notifications SET status='cancelled'
      WHERE status='pending' AND kind='deletion.approachingExpiry' AND EXISTS
        (SELECT 1 FROM museums m WHERE m.id=museum_id AND
          (m.status<>'pending_deletion' OR m.deletion_scheduled_at<=?))`).run(now.toISOString());
    const rows = db.prepare(`SELECT m.id,m.version,m.deletion_scheduled_at FROM museums m
      WHERE m.status='pending_deletion' AND m.deletion_scheduled_at>? AND m.deletion_scheduled_at<=?
      AND NOT EXISTS (SELECT 1 FROM museum_notifications n WHERE n.event_key=
        'deletion-reminder/' || m.id || '/' || m.version || '/' || m.deletion_scheduled_at)
      ORDER BY m.deletion_scheduled_at,m.id LIMIT ?`)
      .all(now.toISOString(), new Date(now.getTime() + 3 * 86400000).toISOString(), limit);
    for (const row of rows) {
      const id = readString(row, "id"); const deadline = readString(row, "deletion_scheduled_at");
      queueMuseumDeletionNotificationInDatabase(db, `deletion-reminder/${id}/${row.version}/${deadline}`, id, "approachingExpiry", deadline);
    }
    return { queuedMuseums: rows.length };
  });
}
