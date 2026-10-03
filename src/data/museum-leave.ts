import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { ApiError } from "../http/errors.ts";
import { withTransaction } from "./transaction.ts";
import { queueCollaborationNotificationInDatabase } from "./museum-notifications.ts";
import { invalidateOwnerTransfersInDatabase } from "./owner-transfer-requests.ts";

export function leaveMuseumInDatabase(database: DatabaseSync, userId: string, museumId: string) {
  return withTransaction(database, () => {
    const user = database.prepare("SELECT email_verified FROM users WHERE id=?").get(userId);
    if (!user) throw new ApiError("USER_REQUIRED", 401);
    if (user.email_verified !== 1) throw new ApiError("EMAIL_VERIFICATION_REQUIRED", 403);
    const museum = database.prepare("SELECT owner_id,status FROM museums WHERE id=?").get(museumId);
    if (!museum) throw new ApiError("MEMBERSHIP_NOT_FOUND", 404);
    if (museum.status !== "active") throw new ApiError("MUSEUM_NOT_FOUND", 404);
    if (museum.owner_id === userId) throw new ApiError("OWNER_CANNOT_LEAVE", 403);
    const membership = database
      .prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?")
      .get(museumId, userId);
    if (!membership) throw new ApiError("MEMBERSHIP_NOT_FOUND", 404);
    // Keep the relationship record, and make retrying a lost success response harmless.
    if (membership.status === "active") {
      invalidateOwnerTransfersInDatabase(database,museumId,userId);
      database
        .prepare(
          "UPDATE museum_memberships SET status='revoked',updated_at=? WHERE museum_id=? AND user_id=?",
        )
        .run(new Date().toISOString(), museumId, userId);
      const event = writeAuditLogInDatabase(database, {
        actorUserId: userId,
        museumId,
        action: "membership.leave",
        objectType: "membership",
        objectId: userId,
        diff: { status: { before: "active", after: "revoked" } },
      });
      queueCollaborationNotificationInDatabase(database, event.id, museumId, "leave", userId);
    }
    return { ok: true as const };
  });
}
