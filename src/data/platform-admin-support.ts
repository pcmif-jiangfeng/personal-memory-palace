import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getPlatformAdminUserId } from "../config.ts";
import { ApiError } from "../http/errors.ts";
import { requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { requirePlatformAdminInDatabase } from "./platform-admin.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { readString } from "./row-readers.ts";
import { withTransaction } from "./transaction.ts";

export const supportAccessSchemaSql = `
CREATE TABLE IF NOT EXISTS museum_support_access (
  id TEXT PRIMARY KEY,
  museum_id TEXT NOT NULL REFERENCES museums(id) ON DELETE CASCADE,
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK(purpose IN ('user_authorization','fault_handling','security_incident')),
  case_reference TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS museum_support_access_scope ON museum_support_access(museum_id,memory_id);
`;

function activeMemory(db: DatabaseSync, museumId: string, memoryId: string) {
  const row = db.prepare(`SELECT m.owner_id FROM museums m JOIN memories memory ON memory.museum_id=m.id
    WHERE m.id=? AND memory.id=? AND m.status='active' AND memory.trashed_at IS NULL`).get(museumId, memoryId);
  if (!row) throw new ApiError("MEMORY_NOT_FOUND", 404);
  return readString(row, "owner_id");
}

function issueAccess(db: DatabaseSync, actor: string, museumId: string, memoryId: string,
  purpose: "user_authorization" | "fault_handling" | "security_incident", caseReference: string | null, now: Date) {
  if (!Number.isFinite(now.getTime())) throw new ApiError("INVALID_SUPPORT_ACCESS", 400);
  const admin = getPlatformAdminUserId();
  if (!admin) throw new ApiError("SUPPORT_ADMIN_UNAVAILABLE", 503);
  requirePlatformAdminInDatabase(db, admin);
  const owner = activeMemory(db, museumId, memoryId);
  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + 30 * 60000).toISOString();
  db.prepare(`INSERT INTO museum_support_access
    (id,museum_id,memory_id,admin_user_id,owner_user_id,issued_by_user_id,purpose,case_reference,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, museumId, memoryId, admin, owner, actor, purpose, caseReference, now.toISOString(), expiresAt);
  writeAuditLogInDatabase(db, { actorUserId: actor, museumId, action: "support.accessGranted",
    objectType: "memory", objectId: memoryId, diff: { grantId: id, purpose, caseReference, expiresAt, adminUserId: admin } });
  return { grantId: id, memoryId, expiresAt };
}

export function grantOwnerSupportAccessInDatabase(db: DatabaseSync, userId: string | null,
  museumId: string, memoryId: string, confirm: boolean, now = new Date()) {
  return withTransaction(db, () => {
    const owner = requireMuseumOwnerInDatabase(db, userId, museumId);
    if (owner.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
    if (confirm !== true) throw new ApiError("SUPPORT_CONFIRMATION_REQUIRED", 400);
    return issueAccess(db, owner.userId, museumId, memoryId, "user_authorization", null, now);
  });
}

// Server-operator maintenance only. There is deliberately no HTTP incident self-approval endpoint.
export function grantIncidentSupportAccessInDatabase(db: DatabaseSync, userId: string | null,
  museumId: string, memoryId: string, purpose: string, caseReference: string, now = new Date()) {
  return withTransaction(db, () => {
    const actor = requirePlatformAdminInDatabase(db, userId);
    if ((purpose !== "fault_handling" && purpose !== "security_incident") ||
      typeof caseReference !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_./-]{2,127}$/.test(caseReference))
      throw new ApiError("INVALID_SUPPORT_INCIDENT", 400);
    return issueAccess(db, actor, museumId, memoryId, purpose, caseReference, now);
  });
}

export function revokeOwnerSupportAccessInDatabase(db: DatabaseSync, userId: string | null,
  museumId: string, grantId: string) {
  return withTransaction(db, () => {
    const owner = requireMuseumOwnerInDatabase(db, userId, museumId);
    const grant = db.prepare("SELECT memory_id,revoked_at FROM museum_support_access WHERE id=? AND museum_id=?").get(grantId, museumId);
    if (!grant) throw new ApiError("SUPPORT_ACCESS_NOT_FOUND", 404);
    if (grant.revoked_at === null) {
      db.prepare("UPDATE museum_support_access SET revoked_at=? WHERE id=?").run(new Date().toISOString(), grantId);
      writeAuditLogInDatabase(db, { actorUserId: owner.userId, museumId, action: "support.accessRevoked",
        objectType: "memory", objectId: readString(grant, "memory_id"), diff: { grantId } });
    }
    return { ok: true as const };
  });
}

export function readSupportMemoryInDatabase(db: DatabaseSync, userId: string | null,
  museumId: string, memoryId: string, grantId: string, now = new Date()) {
  return withTransaction(db, () => {
    const admin = requirePlatformAdminInDatabase(db, userId);
    if (!Number.isFinite(now.getTime())) throw new ApiError("INVALID_SUPPORT_ACCESS", 400);
    const grant = db.prepare(`SELECT g.purpose,g.case_reference FROM museum_support_access g
      JOIN museums m ON m.id=g.museum_id JOIN users owner ON owner.id=g.owner_user_id
      WHERE g.id=? AND g.museum_id=? AND g.memory_id=? AND g.admin_user_id=?
      AND g.revoked_at IS NULL AND g.created_at<=? AND g.expires_at>?
      AND m.status='active' AND m.owner_id=g.owner_user_id AND owner.email_verified=1`)
      .get(grantId, museumId, memoryId, admin, now.toISOString(), now.toISOString());
    if (!grant) throw new ApiError("SUPPORT_ACCESS_REQUIRED", 403);
    activeMemory(db, museumId, memoryId);
    // Fail closed if audit persistence fails. Never return content before this transaction commits.
    writeAuditLogInDatabase(db, { actorUserId: admin, museumId, action: "support.privateRead",
      objectType: "memory", objectId: memoryId, diff: { grantId, purpose: readString(grant, "purpose"),
        caseReference: typeof grant.case_reference === "string" ? grant.case_reference : null } });
    const memory = db.prepare("SELECT title,story FROM memories WHERE id=? AND museum_id=?").get(memoryId, museumId)!;
    // Only a named text diagnostic snapshot: no lists, gallery URLs, shares, keys or editing capability.
    return { memoryId, museumId, title: readString(memory, "title"), story: readString(memory, "story") };
  });
}
