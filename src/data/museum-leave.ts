import type { DatabaseSync } from "node:sqlite";
import { writeAuditLogInDatabase } from "./audit-log.ts";
import { ApiError } from "../http/errors.ts";
import { withTransaction } from "./transaction.ts";

export function leaveMuseumInDatabase(database: DatabaseSync, userId: string, museumId: string) {
  return withTransaction(database, () => {
    const museum = database.prepare("SELECT owner_id FROM museums WHERE id=?").get(museumId);
    if (!museum) throw new ApiError("MEMBERSHIP_NOT_FOUND", 404);
    if (museum.owner_id === userId) throw new ApiError("OWNER_CANNOT_LEAVE", 403);
    const membership = database.prepare("SELECT status FROM museum_memberships WHERE museum_id=? AND user_id=?").get(museumId,userId);
    if (!membership) throw new ApiError("MEMBERSHIP_NOT_FOUND", 404);
    // Keep the relationship record, and make retrying a lost success response harmless.
    if (membership.status === "active") {
      database.prepare("UPDATE museum_memberships SET status='revoked',updated_at=? WHERE museum_id=? AND user_id=?")
        .run(new Date().toISOString(),museumId,userId);
      writeAuditLogInDatabase(database, {
        actorUserId: userId,
        museumId,
        action: "membership.leave",
        objectType: "membership",
        objectId: userId,
        diff: { status: { before: "active", after: "revoked" } },
      });
    }
    return { ok: true as const };
  });
}
