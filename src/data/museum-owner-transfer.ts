import type { DatabaseSync } from "node:sqlite";
import type { MuseumOwnerTransferInput } from "../domain/museum-owner-transfer.ts";
import { ApiError } from "../http/errors.ts";
import { requireMuseumOwnerInDatabase } from "./museum-access.ts";
import { findMuseumByIdInDatabase } from "./museum-repository.ts";
import { withTransaction } from "./transaction.ts";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { queueCollaborationNotificationInDatabase } from "./museum-notifications.ts";

export function transferMuseumOwnerInDatabase(
  database: DatabaseSync,
  actorUserId: string | null,
  museumId: string,
  input: MuseumOwnerTransferInput,
) {
  return withTransaction(database, () => {
    const access = requireMuseumOwnerInDatabase(database, actorUserId, museumId);
    if (access.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
    if (input.confirm !== true) throw new ApiError("TRANSFER_CONFIRMATION_REQUIRED", 400);
    if (input.oldOwnerDisposition !== "stay" && input.oldOwnerDisposition !== "leave")
      throw new ApiError("INVALID_OWNER_DISPOSITION", 400);
    if (!Number.isSafeInteger(input.version) || input.version < 1)
      throw new ApiError("INVALID_MUSEUM_VERSION", 400);
    const museum = findMuseumByIdInDatabase(database, museumId)!;
    if (museum.version !== input.version) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
    if (input.targetUserId === access.userId) throw new ApiError("INVALID_TRANSFER_TARGET", 400);
    const target = database
      .prepare(
        `SELECT u.id FROM museum_memberships membership
      JOIN users u ON u.id=membership.user_id WHERE membership.museum_id=? AND membership.user_id=?
      AND membership.status='active' AND membership.role='collaborator' AND u.email_verified=1`,
      )
      .get(museumId, input.targetUserId);
    if (!target) throw new ApiError("TRANSFER_TARGET_UNAVAILABLE", 409);
    const now = new Date().toISOString();
    // A single NOT NULL owner_id changes atomically; there is no unowned or two-Owner interval.
    const result = database
      .prepare(
        `UPDATE museums SET owner_id=?,version=version+1,updated_at=?,last_edited_by_user_id=?
      WHERE id=? AND owner_id=? AND version=?`,
      )
      .run(input.targetUserId, now, access.userId, museumId, access.userId, input.version);
    if (!result.changes) throw new ApiError("MUSEUM_VERSION_CONFLICT", 409);
    database.prepare("UPDATE museum_support_access SET revoked_at=? WHERE museum_id=? AND revoked_at IS NULL")
      .run(now, museumId);
    database
      .prepare("DELETE FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .run(museumId, input.targetUserId);
    if (input.oldOwnerDisposition === "stay") {
      database
        .prepare(
          `INSERT INTO museum_memberships (museum_id,user_id,role,status,created_at,updated_at)
        VALUES (?,?,'collaborator','active',?,?) ON CONFLICT(museum_id,user_id)
        DO UPDATE SET role='collaborator',status='active',updated_at=excluded.updated_at`,
        )
        .run(museumId, access.userId, now, now);
    } else {
      database
        .prepare(
          "UPDATE museum_memberships SET status='revoked',updated_at=? WHERE museum_id=? AND user_id=?",
        )
        .run(now, museumId, access.userId);
    }
    const event = writeAuditLogInDatabase(database, {
      actorUserId: access.userId,
      museumId,
      action: "museum.ownerTransfer",
      objectType: "museum",
      objectId: museumId,
      diff: {
        ownerId: { before: access.userId, after: input.targetUserId },
        oldOwnerDisposition: input.oldOwnerDisposition,
      },
    });
    queueCollaborationNotificationInDatabase(database, event.id, museumId, "ownerTransfer", input.targetUserId, access.userId);
    return {
      ok: true as const,
      museumId,
      ownerId: input.targetUserId,
      oldOwnerDisposition: input.oldOwnerDisposition,
    };
  });
}
