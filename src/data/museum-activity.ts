import type { DatabaseSync } from "node:sqlite";
import { museumActivityMessages, type MuseumActivityEntry } from "../domain/museum-activity.ts";
import { ApiError } from "../http/errors.ts";
import { requireMuseumAccessInDatabase } from "./museum-access.ts";
import { readNullableString, readNumber, readString } from "./row-readers.ts";

export const activityPageSize = 25;

export function listMuseumActivityInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
  page = 1,
) {
  const access = requireMuseumAccessInDatabase(database, userId, museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  if (!Number.isSafeInteger(page) || page < 1 || page > 999999)
    throw new ApiError("INVALID_ACTIVITY_PAGE", 400);
  const actions = Object.keys(museumActivityMessages);
  // Filter before counting/paging and never SELECT diff or credential-related events.
  // Require the object's type to match the action's reviewed content category.
  const where = `a.museum_id=? AND a.action IN (${actions.map(() => "?").join(",")})
    AND a.object_type=substr(a.action,1,instr(a.action,'.')-1)`;
  const total = readNumber(database.prepare(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where}`)
    .get(museumId, ...actions)!, "total");
  const entries: MuseumActivityEntry[] = database.prepare(`
    SELECT a.id, a.actor_name, a.action, a.timestamp
    FROM audit_logs a
    WHERE ${where} ORDER BY a.timestamp DESC,a.id DESC LIMIT ? OFFSET ?
  `).all(museumId, ...actions, activityPageSize, (page - 1) * activityPageSize).map(row => ({
    id: readString(row, "id"),
    actorName: readNullableString(row, "actor_name"),
    summary: museumActivityMessages[readString(row, "action")],
    timestamp: readString(row, "timestamp"),
  }));
  return { entries, total, pageSize: activityPageSize };
}
