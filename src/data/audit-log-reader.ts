import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { readNullableString, readNumber, readString } from "./row-readers.ts";

export interface AuditLogFilter {
  page: number;
  objectType: string;
  objectId: string;
}

export interface OwnerAuditEntry {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  action: string;
  objectType: string;
  objectId: string;
  timestamp: string;
  diff: string | null;
}

export const auditPageSize = 25;

export function listMuseumAuditInDatabase(
  database: DatabaseSync,
  userId: string | null,
  museumId: string,
  filter: AuditLogFilter,
) {
  // Never accept a previously cached role, including when reading later pages.
  requireMuseumOwnerInDatabase(database, userId, museumId);
  if (
    !Number.isSafeInteger(filter.page) || filter.page < 1 || filter.page > 999999 ||
    typeof filter.objectType !== "string" || filter.objectType.length > 80 ||
    typeof filter.objectId !== "string" || filter.objectId.length > 160
  ) throw new ApiError("INVALID_AUDIT_FILTER", 400);
  const clauses = ["a.museum_id = ?"];
  const values = [museumId];
  if (filter.objectType) {
    clauses.push("a.object_type = ?");
    values.push(filter.objectType);
  }
  if (filter.objectId) {
    clauses.push("a.object_id = ?");
    values.push(filter.objectId);
  }
  const where = clauses.join(" AND ");
  const total = readNumber(database.prepare(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where}`).get(...values)!, "total");
  const entries: OwnerAuditEntry[] = database.prepare(`
    SELECT a.id, a.actor_user_id, u.display_name AS actor_name,
      a.action, a.object_type, a.object_id, a.timestamp, a.diff
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE ${where} ORDER BY a.timestamp DESC, a.id DESC LIMIT ? OFFSET ?
  `).all(...values, auditPageSize, (filter.page - 1) * auditPageSize).map(row => ({
    id: readString(row, "id"),
    actorUserId: readNullableString(row, "actor_user_id"),
    actorName: readNullableString(row, "actor_name"),
    action: readString(row, "action"),
    objectType: readString(row, "object_type"),
    objectId: readString(row, "object_id"),
    timestamp: readString(row, "timestamp"),
    diff: readNullableString(row, "diff"),
  }));
  return { entries, total, pageSize: auditPageSize };
}
