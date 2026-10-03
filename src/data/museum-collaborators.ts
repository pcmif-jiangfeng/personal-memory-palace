import type { DatabaseSync } from "node:sqlite";
import { ApiError } from "../http/errors.ts";
import { requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { withTransaction } from "./transaction.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { readNumber, readString } from "./row-readers.ts";
import { queueCollaborationNotificationInDatabase } from "./museum-notifications.ts";
import { invalidateOwnerTransfersInDatabase } from "./owner-transfer-requests.ts";

export const collaboratorsPageSize = 25;

function requireActiveOwner(database: DatabaseSync, actorUserId: string | null, museumId: string) {
  const access = requireMuseumOwnerInDatabase(database, actorUserId, museumId);
  if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
  return access;
}

export function listMuseumCollaboratorsInDatabase(
  database: DatabaseSync,
  actorUserId: string | null,
  museumId: string,
  page = 1,
) {
  const owner = requireActiveOwner(database, actorUserId, museumId);
  if (!Number.isInteger(page) || page < 1 || page > 999999)
    throw new ApiError("INVALID_COLLABORATOR_PAGE", 400);
  const entries = database
    .prepare(
      `SELECT u.id,u.display_name FROM museum_memberships membership
    JOIN users u ON u.id=membership.user_id
    WHERE membership.museum_id=? AND membership.status='active' AND membership.user_id<>?
    ORDER BY membership.created_at ASC,u.id ASC LIMIT ? OFFSET ?`,
    )
    .all(museumId, owner.userId, collaboratorsPageSize, (page - 1) * collaboratorsPageSize)
    .map((row) => ({
      id: readString(row, "id"),
      displayName: readString(row, "display_name"),
    }));
  const total = readNumber(
    database
      .prepare(
        `SELECT COUNT(*) AS total FROM museum_memberships
    WHERE museum_id=? AND status='active' AND user_id<>?`,
      )
      .get(museumId, owner.userId)!,
    "total",
  );
  return { entries, total, page, pageSize: collaboratorsPageSize };
}

export function removeMuseumCollaboratorInDatabase(
  database: DatabaseSync,
  actorUserId: string | null,
  museumId: string,
  collaboratorUserId: string,
) {
  return withTransaction(database, () => {
    const owner = requireActiveOwner(database, actorUserId, museumId);
    if (collaboratorUserId === owner.userId) throw new ApiError("OWNER_CANNOT_BE_REMOVED", 403);
    const membership = database
      .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(museumId, collaboratorUserId);
    if (!membership) throw new ApiError("MEMBERSHIP_NOT_FOUND", 404);
    // Preserve the relationship and timestamp on retries; only a real transition is audited.
    if (membership.status === "active") {
      invalidateOwnerTransfersInDatabase(database,museumId,collaboratorUserId);
      database
        .prepare(
          "UPDATE museum_memberships SET status='revoked',updated_at=? WHERE museum_id=? AND user_id=?",
        )
        .run(new Date().toISOString(), museumId, collaboratorUserId);
      const event = writeAuditLogInDatabase(database, {
        actorUserId: owner.userId,
        museumId,
        action: "membership.remove",
        objectType: "membership",
        objectId: collaboratorUserId,
        diff: { status: { before: "active", after: "revoked" } },
      });
      queueCollaborationNotificationInDatabase(database, event.id, museumId, "removed", collaboratorUserId);
    }
    return { ok: true as const };
  });
}
