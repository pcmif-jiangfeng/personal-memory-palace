import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type AuditLogValue =
  | string
  | number
  | boolean
  | null
  | AuditLogValue[]
  | { [field: string]: AuditLogValue };

export interface WriteAuditLogInput {
  actorUserId: string;
  museumId: string;
  action: string;
  objectType: string;
  objectId: string;
  diff?: { [field: string]: AuditLogValue };
}

function serializeDiff(diff: WriteAuditLogInput["diff"]): string | null {
  if (diff === undefined) return null;
  if (diff === null || typeof diff !== "object" || Array.isArray(diff)) {
    throw new TypeError("Audit diff must be a JSON object");
  }
  const ancestors = new Set<object>();
  function validateValue(value: unknown): void {
    if (value === null) return;
    if (typeof value === "object") {
      if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new TypeError("Audit diff must contain only plain JSON objects");
      }
      if (ancestors.has(value)) throw new TypeError("Audit diff must not contain cycles");
      ancestors.add(value);
      for (const child of Array.isArray(value) ? value : Object.values(value)) validateValue(child);
      ancestors.delete(value);
      return;
    }
    if (
      (typeof value === "number" && !Number.isFinite(value)) ||
      !["string", "number", "boolean"].includes(typeof value)
    ) {
      throw new TypeError("Audit diff must contain only JSON values");
    }
  }
  validateValue(diff);
  return JSON.stringify(diff);
}

// Trusted server-side callers supply the authenticated actor and authorized museum.
// Pass the business transaction's database; never capture requests, tokens or passwords as diff.
export function writeAuditLogInDatabase(
  database: DatabaseSync,
  input: WriteAuditLogInput,
): { id: string; timestamp: string } {
  for (const field of ["actorUserId", "museumId", "action", "objectType", "objectId"] as const) {
    if (typeof input[field] !== "string" || input[field].trim().length === 0) {
      throw new TypeError(`Audit ${field} is required`);
    }
  }
  const diff = serializeDiff(input.diff);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  database
    .prepare(`
    INSERT INTO audit_logs
      (id, actor_user_id, museum_id, action, object_type, object_id, timestamp, diff)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(id, input.actorUserId, input.museumId, input.action, input.objectType, input.objectId, timestamp, diff);
  return { id, timestamp };
}
